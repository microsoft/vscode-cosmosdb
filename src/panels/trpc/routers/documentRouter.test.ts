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

    it('restores pending cleanup when the document view reloads', async () => {
        const context = createContext();
        context.state.pendingPartitionKeyCleanup = {
            sourceIdentifier: oldIdentifier,
            sourceEtag: 'loaded-etag',
            destination: writeResult,
            message: 'Stored cleanup phase',
        };

        const result = await documentRouterDef.createCaller(context).getInitialState();

        expect(result.cleanupRequiredMessage).toBe('Stored cleanup phase');
    });

    it('restores pending cleanup from the destination when the source disappeared', async () => {
        const context = createContext();
        context.state.pendingPartitionKeyCleanup = {
            sourceIdentifier: oldIdentifier,
            sourceEtag: 'loaded-etag',
            destination: writeResult,
            message: 'Stored cleanup phase',
        };
        documentSessionMocks.readDocument
            .mockRejectedValueOnce(new Error('Item not found or request timed out'))
            .mockResolvedValueOnce({ documentContent, partitionKey: writeResult.partitionKey });
        documentSessionMocks.deleteDocument.mockRejectedValueOnce({ statusCode: 404 });
        const caller = documentRouterDef.createCaller(context);

        const initialState = await caller.getInitialState();
        const cleanupResult = await caller.retryPartitionKeyCleanup();

        expect(initialState).toMatchObject({
            documentId: oldIdentifier,
            documentContent,
            documentPartitionKey: writeResult.partitionKey,
            cleanupRequiredMessage: 'Stored cleanup phase',
        });
        expect(cleanupResult).toMatchObject({ success: true, cleanupRequired: false, documentContent });
        expect(context.state.documentId).toEqual(newIdentifier);
        expect(context.state.pendingPartitionKeyCleanup).toBeUndefined();
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

    it('refreshes the destination after cleanup succeeds', async () => {
        const context = createContext();
        const currentDestination = {
            documentContent: { ...documentContent, _etag: 'current-etag', version: 2 },
            partitionKey: writeResult.partitionKey,
        };
        documentSessionMocks.deleteDocument.mockRejectedValueOnce(new Error('Service unavailable'));
        documentSessionMocks.readDocument.mockResolvedValue(currentDestination);
        const caller = documentRouterDef.createCaller(context);
        await caller.saveDocument({ documentText: JSON.stringify(documentContent) });

        const result = await caller.retryPartitionKeyCleanup();

        expect(documentSessionMocks.readDocument).toHaveBeenCalledWith(
            context.connection,
            newIdentifier,
            undefined,
            writeResult.partitionKey,
        );
        expect(result).toMatchObject({ success: true, cleanupRequired: false, ...currentDestination });
        expect(context.state.documentEtag).toBe('current-etag');
        expect(context.state.pendingPartitionKeyCleanup).toBeUndefined();
    });

    it('keeps cleanup recoverable when the destination cannot be confirmed', async () => {
        const context = createContext();
        documentSessionMocks.deleteDocument.mockRejectedValueOnce(new Error('Service unavailable'));
        documentSessionMocks.readDocument.mockResolvedValue(undefined);
        const caller = documentRouterDef.createCaller(context);
        await caller.saveDocument({ documentText: JSON.stringify(documentContent) });

        const result = await caller.retryPartitionKeyCleanup();

        expect(result).toMatchObject({
            success: false,
            cleanupRequired: true,
            message: expect.stringContaining('could not be refreshed'),
        });
        expect(context.state.documentId).toEqual(oldIdentifier);
        expect(context.state.pendingPartitionKeyCleanup).toBeDefined();
    });

    it('uses the latest source etag when cleanup overwrite is confirmed', async () => {
        const context = createContext();
        const currentSource = {
            documentContent: { ...documentContent, pk: 'old', _etag: 'current-source-etag' },
            partitionKey: writeResult.partitionKey,
        };
        documentSessionMocks.deleteDocument
            .mockRejectedValueOnce(new Error('Service unavailable'))
            .mockRejectedValueOnce({ statusCode: 412 })
            .mockResolvedValueOnce(true);
        documentSessionMocks.readDocument.mockResolvedValueOnce(currentSource).mockResolvedValueOnce({
            documentContent,
            partitionKey: writeResult.partitionKey,
        });
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            items.find((item) => item.title === 'Overwrite'),
        );
        const caller = documentRouterDef.createCaller(context);
        await caller.saveDocument({ documentText: JSON.stringify(documentContent) });

        const result = await caller.retryPartitionKeyCleanup();

        expect(result).toMatchObject({ success: true, cleanupRequired: false });
        expect(documentSessionMocks.deleteDocument).toHaveBeenLastCalledWith(
            context.connection,
            oldIdentifier,
            undefined,
            'current-source-etag',
        );
    });

    it('removes the destination and restores the source when cleanup changes are discarded', async () => {
        const context = createContext();
        const currentSource = {
            documentContent: { ...documentContent, pk: 'old', _etag: 'current-source-etag' },
            partitionKey: writeResult.partitionKey,
        };
        documentSessionMocks.deleteDocument
            .mockRejectedValueOnce(new Error('Service unavailable'))
            .mockRejectedValueOnce({ statusCode: 412 })
            .mockResolvedValueOnce(true);
        documentSessionMocks.readDocument.mockResolvedValue(currentSource);
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            items.find((item) => item.title === 'Discard Changes and Refresh'),
        );
        const caller = documentRouterDef.createCaller(context);
        await caller.saveDocument({ documentText: JSON.stringify(documentContent) });

        const result = await caller.retryPartitionKeyCleanup();

        expect(result).toMatchObject({
            success: true,
            cleanupRequired: false,
            documentContent: currentSource.documentContent,
        });
        expect(documentSessionMocks.deleteDocument).toHaveBeenLastCalledWith(
            context.connection,
            newIdentifier,
            undefined,
            documentContent._etag,
        );
        expect(context.state.documentId).toEqual(oldIdentifier);
        expect(context.state.documentEtag).toBe('current-source-etag');
        expect(context.state.pendingPartitionKeyCleanup).toBeUndefined();
    });

    it('keeps cleanup pending when source conflict resolution is canceled', async () => {
        const context = createContext();
        documentSessionMocks.deleteDocument
            .mockRejectedValueOnce(new Error('Service unavailable'))
            .mockRejectedValueOnce({ statusCode: 412 });
        documentSessionMocks.readDocument.mockResolvedValue({
            documentContent: { ...documentContent, pk: 'old', _etag: 'current-source-etag' },
            partitionKey: writeResult.partitionKey,
        });
        vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
        const caller = documentRouterDef.createCaller(context);
        await caller.saveDocument({ documentText: JSON.stringify(documentContent) });

        const result = await caller.retryPartitionKeyCleanup();

        expect(result).toMatchObject({ success: false, cleanupRequired: true });
        expect(documentSessionMocks.deleteDocument).toHaveBeenCalledTimes(2);
        expect(context.state.pendingPartitionKeyCleanup).toBeDefined();
        expect(context.state.documentId).toEqual(oldIdentifier);
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

    it.each([{ statusCode: '412' }, { code: '412' }])(
        'recognizes a string precondition failure shape: %o',
        async (preconditionFailure) => {
            const context = createContext();
            context.state.documentEtag = 'loaded-etag';
            const serverDocument = { ...documentContent, pk: 'old', _etag: 'server-etag' };
            documentSessionMocks.readDocument.mockResolvedValue({
                documentContent: serverDocument,
                partitionKey: writeResult.partitionKey,
            });
            documentSessionMocks.replaceDocument.mockRejectedValue(preconditionFailure);
            vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
                items.find((item) => item.title === 'Discard Changes and Refresh'),
            );

            const result = await documentRouterDef
                .createCaller(context)
                .saveDocument({ documentText: JSON.stringify(documentContent) });

            expect(result).toMatchObject({ success: true, discarded: true, documentContent: serverDocument });
        },
    );

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

    it('keeps the loaded etag when a stale partition-key move is not confirmed', async () => {
        const context = createContext();
        context.state.documentEtag = 'loaded-etag';
        documentSessionMocks.extractPartitionKeyFromDocument.mockResolvedValue('new');
        documentSessionMocks.readDocument.mockResolvedValue({
            documentContent: { ...documentContent, pk: 'old', _etag: 'server-etag' },
            partitionKey: writeResult.partitionKey,
        });
        confirmationMocks.getConfirmationAsInSettings.mockResolvedValue(false);
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            items.find((item) => item.title === 'Overwrite'),
        );

        await documentRouterDef.createCaller(context).saveDocument({ documentText: JSON.stringify(documentContent) });

        expect(context.state.documentEtag).toBe('loaded-etag');
        expect(documentSessionMocks.createDocument).not.toHaveBeenCalled();
        expect(documentSessionMocks.deleteDocument).not.toHaveBeenCalled();
    });

    it('keeps the loaded etag when partition-key confirmation throws', async () => {
        const context = createContext();
        context.state.documentEtag = 'loaded-etag';
        documentSessionMocks.extractPartitionKeyFromDocument.mockResolvedValue('new');
        documentSessionMocks.readDocument.mockResolvedValue({
            documentContent: { ...documentContent, pk: 'old', _etag: 'server-etag' },
            partitionKey: writeResult.partitionKey,
        });
        confirmationMocks.getConfirmationAsInSettings.mockRejectedValue(new Error('Canceled'));
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            items.find((item) => item.title === 'Overwrite'),
        );

        await expect(
            documentRouterDef.createCaller(context).saveDocument({ documentText: JSON.stringify(documentContent) }),
        ).rejects.toThrow('Canceled');

        expect(context.state.documentEtag).toBe('loaded-etag');
        expect(documentSessionMocks.createDocument).not.toHaveBeenCalled();
        expect(documentSessionMocks.deleteDocument).not.toHaveBeenCalled();
    });
});
