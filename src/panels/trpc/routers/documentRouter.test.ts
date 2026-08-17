/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type DocumentWriteResult } from '../../../cosmosdb/session/DocumentSession';
import { type DocumentRouterContext } from '../appRouter';
import { documentRouterDef } from './documentRouter';

const documentSessionMocks = vi.hoisted(() => ({
    buildNewDocumentTemplate: vi.fn(),
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
    extractPartitionKeyFromDocument: vi.fn(),
    readDocument: vi.fn(),
    replaceDocument: vi.fn(),
}));

const confirmationMocks = vi.hoisted(() => ({
    getConfirmationAsInSettings: vi.fn(),
}));

vi.mock('../../../cosmosdb/session/DocumentSession', () => documentSessionMocks);
vi.mock('../../../services/SchemaService', () => ({ SchemaService: { getInstance: vi.fn() } }));
vi.mock('../../../utils/dialogs/getConfirmation', () => confirmationMocks);
vi.mock('../../../utils/survey', () => ({ promptAfterActionEventually: vi.fn() }));
vi.mock('../../../utils/vscodeUtils', () => ({ showNewFile: vi.fn() }));
vi.mock('@vscode/l10n', () => ({ t: (message: string) => message }));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_eventName: string, callback: (context: unknown) => Promise<unknown>) =>
            callback({
                errorHandling: { rethrow: false, suppressDisplay: false },
                telemetry: { measurements: {}, properties: {} },
                valuesToMask: [],
            }),
    ),
}));

const oldIdentifier = { id: 'item', _rid: 'old-rid', partitionKey: 'old' };
const newIdentifier = { id: 'item', _rid: 'new-rid', partitionKey: 'new' };
const documentContent = {
    id: 'item',
    pk: 'new',
    _rid: 'new-rid',
    _ts: 1,
    _self: 'dbs/database/colls/container/docs/new-rid',
    _etag: 'etag',
    _attachments: 'attachments/',
};
const writeResult: DocumentWriteResult = {
    documentContent,
    identifier: newIdentifier,
    partitionKey: { paths: ['/pk'] },
};

function createContext(): DocumentRouterContext {
    return {
        connection: {} as DocumentRouterContext['connection'],
        panel: { title: 'item.json' } as DocumentRouterContext['panel'],
        state: {
            documentId: { ...oldIdentifier },
            isDirty: true,
            mode: 'edit',
            partitionKeyDefinition: { paths: ['/pk'] },
        },
        telemetryContext: {} as DocumentRouterContext['telemetryContext'],
        webviewName: 'cosmosDbDocument',
    };
}

describe('documentRouter partition key updates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        confirmationMocks.getConfirmationAsInSettings.mockResolvedValue(true);
        documentSessionMocks.extractPartitionKeyFromDocument.mockResolvedValue('new');
        documentSessionMocks.createDocument.mockResolvedValue(writeResult);
        documentSessionMocks.deleteDocument.mockResolvedValue(true);
        documentSessionMocks.readDocument.mockResolvedValue({
            documentContent,
            partitionKey: writeResult.partitionKey,
        });
    });

    it('keeps the original item when destination creation fails', async () => {
        const context = createContext();
        documentSessionMocks.createDocument.mockRejectedValue(new Error('Conflict'));

        await expect(
            documentRouterDef.createCaller(context).saveDocument({ documentText: JSON.stringify(documentContent) }),
        ).rejects.toThrow('Conflict');

        expect(documentSessionMocks.deleteDocument).not.toHaveBeenCalled();
        expect(context.state.documentId).toEqual(oldIdentifier);
        expect(context.state.isDirty).toBe(true);
    });

    it('reports a recoverable duplicate when source deletion fails', async () => {
        const context = createContext();
        documentSessionMocks.deleteDocument.mockRejectedValue(new Error('Service unavailable'));

        const result = await documentRouterDef
            .createCaller(context)
            .saveDocument({ documentText: JSON.stringify(documentContent) });

        expect(result).toMatchObject({
            success: false,
            cleanupRequired: true,
            message: expect.stringContaining('Both items'),
        });
        expect(context.state.documentId).toEqual(oldIdentifier);
        expect(context.state.isDirty).toBe(true);
    });

    it('reports a recoverable duplicate when source deletion does not complete', async () => {
        const context = createContext();
        documentSessionMocks.deleteDocument.mockResolvedValue(false);

        const result = await documentRouterDef
            .createCaller(context)
            .saveDocument({ documentText: JSON.stringify(documentContent) });

        expect(result).toMatchObject({ success: false, cleanupRequired: true });
        expect(context.state.documentId).toEqual(oldIdentifier);
        expect(context.state.isDirty).toBe(true);
    });

    it('retries cleanup without recreating the destination', async () => {
        const context = createContext();
        documentSessionMocks.deleteDocument.mockRejectedValueOnce(new Error('Service unavailable'));
        const caller = documentRouterDef.createCaller(context);
        await caller.saveDocument({ documentText: JSON.stringify(documentContent) });

        const result = await caller.retryPartitionKeyCleanup();

        expect(result).toMatchObject({ success: true, cleanupRequired: false, documentContent });
        expect(documentSessionMocks.createDocument).toHaveBeenCalledTimes(1);
        expect(documentSessionMocks.deleteDocument).toHaveBeenCalledTimes(2);
        expect(context.state.documentId).toEqual(newIdentifier);
        expect(context.state.pendingPartitionKeyCleanup).toBeUndefined();
    });

    it('does not recreate the destination when save is repeated before cleanup', async () => {
        const context = createContext();
        documentSessionMocks.deleteDocument.mockRejectedValue(new Error('Service unavailable'));
        const caller = documentRouterDef.createCaller(context);
        await caller.saveDocument({ documentText: JSON.stringify(documentContent) });

        const result = await caller.saveDocument({ documentText: JSON.stringify(documentContent) });

        expect(result).toMatchObject({ success: false, cleanupRequired: true });
        expect(documentSessionMocks.createDocument).toHaveBeenCalledTimes(1);
        expect(documentSessionMocks.deleteDocument).toHaveBeenCalledTimes(1);
    });

    it('treats a missing source as successful idempotent cleanup', async () => {
        const context = createContext();
        documentSessionMocks.deleteDocument
            .mockRejectedValueOnce(new Error('Request timed out'))
            .mockRejectedValueOnce({ statusCode: 404 });
        const caller = documentRouterDef.createCaller(context);
        await caller.saveDocument({ documentText: JSON.stringify(documentContent) });

        const result = await caller.retryPartitionKeyCleanup();

        expect(result).toMatchObject({ success: true, cleanupRequired: false });
        expect(context.state.documentId).toEqual(newIdentifier);
    });

    it('treats a retry with no pending cleanup as an idempotent success', async () => {
        const context = createContext();
        context.state.documentId = newIdentifier;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const result = await documentRouterDef.createCaller(context).retryPartitionKeyCleanup();

        expect(result).toMatchObject({
            success: true,
            cleanupRequired: false,
            documentContent,
            partitionKey: writeResult.partitionKey,
        });
        expect(warn).toHaveBeenCalledWith('[Document] Partition key cleanup retry requested with no pending cleanup.');
        expect(documentSessionMocks.readDocument).toHaveBeenCalledWith(
            context.connection,
            newIdentifier,
            undefined,
            context.state.partitionKeyDefinition,
        );
        expect(documentSessionMocks.createDocument).not.toHaveBeenCalled();
        expect(documentSessionMocks.deleteDocument).not.toHaveBeenCalled();
    });

    it('creates the destination before deleting the source and updates state after both succeed', async () => {
        const context = createContext();
        context.signal = AbortSignal.abort();

        const result = await documentRouterDef
            .createCaller(context)
            .saveDocument({ documentText: JSON.stringify(documentContent) });

        expect(documentSessionMocks.createDocument.mock.invocationCallOrder[0]).toBeLessThan(
            documentSessionMocks.deleteDocument.mock.invocationCallOrder[0],
        );
        expect(documentSessionMocks.deleteDocument).toHaveBeenCalledWith(
            context.connection,
            oldIdentifier,
            undefined,
            undefined,
        );
        expect(documentSessionMocks.createDocument).toHaveBeenCalledWith(
            context.connection,
            documentContent,
            undefined,
            context.state.partitionKeyDefinition,
        );
        expect(result).toMatchObject({ success: true, documentContent });
        expect(context.state.documentId).toEqual(newIdentifier);
        expect(context.panel.title).toBe('item.json');
    });
});

describe('documentRouter concurrent updates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        documentSessionMocks.extractPartitionKeyFromDocument.mockResolvedValue('old');
        documentSessionMocks.replaceDocument.mockResolvedValue(writeResult);
    });

    it('conditions an update on the etag loaded by the editor', async () => {
        const context = createContext();
        context.state.documentEtag = 'loaded-etag';

        await documentRouterDef.createCaller(context).saveDocument({ documentText: JSON.stringify(documentContent) });

        expect(documentSessionMocks.replaceDocument).toHaveBeenCalledWith(
            context.connection,
            documentContent,
            oldIdentifier,
            undefined,
            context.state.partitionKeyDefinition,
            'loaded-etag',
        );
        expect(context.state.documentEtag).toBe('etag');
    });

    it('discards local changes and refreshes when the loaded etag is stale', async () => {
        const context = createContext();
        context.state.documentEtag = 'loaded-etag';
        const serverDocument = { ...documentContent, pk: 'old', _etag: 'server-etag', value: 'server' };
        documentSessionMocks.readDocument.mockResolvedValue({
            documentContent: serverDocument,
            partitionKey: writeResult.partitionKey,
        });
        documentSessionMocks.replaceDocument.mockRejectedValue({ statusCode: 412 });
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            items.find((item) => item.title === 'Discard Changes and Refresh'),
        );

        const result = await documentRouterDef
            .createCaller(context)
            .saveDocument({ documentText: JSON.stringify(documentContent) });

        expect(result).toMatchObject({ success: true, discarded: true, documentContent: serverDocument });
        expect(documentSessionMocks.replaceDocument).toHaveBeenCalledTimes(1);
        expect(context.state.documentEtag).toBe('server-etag');
    });

    it('uses the latest etag after the user chooses overwrite', async () => {
        const context = createContext();
        context.state.documentEtag = 'loaded-etag';
        documentSessionMocks.readDocument.mockResolvedValue({
            documentContent: { ...documentContent, pk: 'old', _etag: 'server-etag' },
            partitionKey: writeResult.partitionKey,
        });
        documentSessionMocks.replaceDocument
            .mockRejectedValueOnce({ statusCode: 412 })
            .mockResolvedValueOnce(writeResult);
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            items.find((item) => item.title === 'Overwrite'),
        );

        await documentRouterDef.createCaller(context).saveDocument({ documentText: JSON.stringify(documentContent) });

        expect(documentSessionMocks.replaceDocument).toHaveBeenCalledWith(
            context.connection,
            documentContent,
            oldIdentifier,
            undefined,
            context.state.partitionKeyDefinition,
            'server-etag',
        );
    });

    it('handles a conflict that occurs after the preflight read', async () => {
        const context = createContext();
        context.state.documentEtag = 'loaded-etag';
        const serverDocument = { ...documentContent, pk: 'old', _etag: 'server-etag', value: 'server' };
        documentSessionMocks.readDocument.mockResolvedValue({
            documentContent: serverDocument,
            partitionKey: writeResult.partitionKey,
        });
        documentSessionMocks.replaceDocument.mockRejectedValue({ statusCode: 412 });
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            items.find((item) => item.title === 'Discard Changes and Refresh'),
        );

        const result = await documentRouterDef
            .createCaller(context)
            .saveDocument({ documentText: JSON.stringify(documentContent) });

        expect(result).toMatchObject({ success: true, discarded: true, documentContent: serverDocument });
        expect(documentSessionMocks.replaceDocument).toHaveBeenCalledTimes(1);
        expect(context.state.documentEtag).toBe('server-etag');
    });

    it('conditions partition-key source deletion on the latest etag', async () => {
        const context = createContext();
        context.state.documentEtag = 'loaded-etag';
        documentSessionMocks.extractPartitionKeyFromDocument.mockResolvedValue('new');
        documentSessionMocks.readDocument.mockResolvedValue({
            documentContent: { ...documentContent, pk: 'old', _etag: 'server-etag' },
            partitionKey: writeResult.partitionKey,
        });
        documentSessionMocks.createDocument.mockResolvedValue(writeResult);
        documentSessionMocks.deleteDocument.mockResolvedValue(true);
        confirmationMocks.getConfirmationAsInSettings.mockResolvedValue(true);
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            items.find((item) => item.title === 'Overwrite'),
        );

        await documentRouterDef.createCaller(context).saveDocument({ documentText: JSON.stringify(documentContent) });

        expect(documentSessionMocks.deleteDocument).toHaveBeenCalledWith(
            context.connection,
            oldIdentifier,
            undefined,
            'server-etag',
        );
    });
});
