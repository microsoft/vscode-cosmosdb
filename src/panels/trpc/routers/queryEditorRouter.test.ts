/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { vi } from 'vitest';
import * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../../../cosmosdb/NoSqlQueryConnection';
import { QuerySession, type QueryExecutionResult } from '../../../cosmosdb/session/QuerySession';
import { type QueryEditorRouterContext } from '../appRouter';
import { queryEditorRouterDef } from './queryEditorRouter';

const mocks = vi.hoisted(() => ({
    deleteDocument: vi.fn(),
    bulkDeleteDocuments: vi.fn(),
    confirm: vi.fn(),
    readContainer: vi.fn(),
    pickConnection: vi.fn(),
    openDocument: vi.fn(),
    readSchema: vi.fn(),
}));

vi.mock('../../../chat', () => ({}));
vi.mock('../../../cosmosdb/CosmosDBCredential', () => ({ getCosmosDBKeyCredential: () => undefined }));
vi.mock('../../../cosmosdb/getCosmosClient', () => ({}));
vi.mock('../../../cosmosdb/controlPlane', () => ({}));
vi.mock('../../../cosmosdb/NoSqlQueryConnection', () => ({ getNoSqlQueryConnection: mocks.pickConnection }));
vi.mock('../../../cosmosdb/session/DocumentSession', () => ({
    deleteDocument: mocks.deleteDocument,
    bulkDeleteDocuments: mocks.bulkDeleteDocuments,
    isDocumentId: (document: { id?: string }) => !!document.id,
}));
vi.mock('../../../cosmosdb/throughputBuckets', () => ({ getEnabledThroughputBuckets: async () => undefined }));
vi.mock('../../../cosmosdb/withClaimsChallengeHandling', () => ({ withClaimsChallengeHandling: mocks.readContainer }));
vi.mock('../../../services/SchemaService', () => ({
    SchemaService: { getInstance: () => ({ readSchema: mocks.readSchema }) },
}));
vi.mock('../../../services/SchemaFileStorage', () => ({}));
vi.mock('../../../services/StorageService', () => ({
    StorageNames: { Default: 'default' },
    StorageService: { get: () => ({ getItems: async () => [] }) },
}));
vi.mock('../../../utils/aiUtils', () => ({}));
vi.mock('../../../utils/dialogs/getConfirmation', () => ({ getConfirmationAsInSettings: mocks.confirm }));
vi.mock('../../../utils/survey', () => ({ promptAfterActionEventually: vi.fn() }));
vi.mock('../../../utils/vscodeUtils', () => ({}));
vi.mock('../../DocumentTab', () => ({ DocumentTab: { render: mocks.openDocument } }));
vi.mock('../../QueryEditorTab', () => ({ QueryEditorTab: { title: 'Query Editor' } }));
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

const connectionA: NoSqlQueryConnection = {
    endpoint: 'https://account.documents.azure.com',
    databaseId: 'db',
    containerId: 'A',
    credentials: [],
    isEmulator: false,
};
const documentId = { id: 'same', _rid: 'rid', partitionKey: 'shared' };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function createContext(): QueryEditorRouterContext {
    return {
        state: {
            connection: connectionA,
            connectionVersion: 0,
            isChangingConnection: false,
            isLastQueryAIGenerated: false,
            pendingRuns: new Map(),
        },
        sessions: new Map(),
        panel: { title: 'db/A' } as QueryEditorRouterContext['panel'],
        telemetryContext: {} as QueryEditorRouterContext['telemetryContext'],
        eventSink: {} as QueryEditorRouterContext['eventSink'],
        webviewName: 'cosmosDbQuery',
    };
}

function addSession(ctx: QueryEditorRouterContext) {
    const session = new QuerySession(ctx.state.connection!, 'SELECT * FROM c', {});
    ctx.sessions.set(session.id, session);
    return session;
}

describe('query editor connection ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.confirm.mockResolvedValue(true);
        mocks.readContainer.mockResolvedValue({ resource: { partitionKey: { paths: ['/pk'] } } });
        mocks.readSchema.mockResolvedValue(null);
        mocks.deleteDocument.mockResolvedValue(true);
        mocks.bulkDeleteDocuments.mockResolvedValue({
            valid: [],
            invalid: [],
            deleted: [],
            throttled: [],
            failed: [],
            aborted: false,
        });
    });

    for (const bulk of [false, true]) {
        const deleteItems = (caller: ReturnType<typeof queryEditorRouterDef.createCaller>, executionId: string) =>
            bulk
                ? caller.deleteDocuments({ documentIds: [documentId, { ...documentId, id: 'second' }], executionId })
                : caller.deleteDocument({ documentId, executionId });

        it(`rejects stale ${bulk ? 'bulk' : 'single'} deletes after A -> B -> A`, async () => {
            const ctx = createContext();
            const session = addSession(ctx);
            const caller = queryEditorRouterDef.createCaller(ctx);
            await caller.setConnection({ databaseId: 'db', containerId: 'B' });
            await expect(deleteItems(caller, session.id)).rejects.toThrow('no longer current');
            await caller.setConnection({ databaseId: 'db', containerId: 'A' });
            await expect(deleteItems(caller, session.id)).rejects.toThrow('no longer current');
            expect(session.isDisposed).toBe(true);
            expect(mocks.confirm).not.toHaveBeenCalled();
            expect(mocks.deleteDocument).not.toHaveBeenCalled();
            expect(mocks.bulkDeleteDocuments).not.toHaveBeenCalled();
        });

        it(`rechecks ${bulk ? 'bulk' : 'single'} deletes after confirmation`, async () => {
            const ctx = createContext();
            const session = addSession(ctx);
            const caller = queryEditorRouterDef.createCaller(ctx);
            const confirmation = deferred<boolean>();
            mocks.confirm.mockReturnValue(confirmation.promise);
            const deletion = deleteItems(caller, session.id);
            await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
            await caller.setConnection({ databaseId: 'db', containerId: 'B' });
            confirmation.resolve(true);
            await expect(deletion).rejects.toThrow('no longer current');
            expect(mocks.deleteDocument).not.toHaveBeenCalled();
            expect(mocks.bulkDeleteDocuments).not.toHaveBeenCalled();
        });

        it(`allows current ${bulk ? 'bulk' : 'single'} deletes using the session connection`, async () => {
            const ctx = createContext();
            const session = addSession(ctx);
            await deleteItems(queryEditorRouterDef.createCaller(ctx), session.id);
            expect(bulk ? mocks.bulkDeleteDocuments : mocks.deleteDocument).toHaveBeenCalledWith(
                connectionA,
                bulk ? [documentId, { ...documentId, id: 'second' }] : documentId,
            );
        });
    }

    it('preserves the old connection and session when validation fails', async () => {
        const ctx = createContext();
        const session = addSession(ctx);
        mocks.readContainer.mockRejectedValueOnce(new Error('Forbidden'));
        await expect(
            queryEditorRouterDef.createCaller(ctx).setConnection({ databaseId: 'db', containerId: 'B' }),
        ).rejects.toThrow('Forbidden');
        expect(ctx.state.connection).toBe(connectionA);
        expect(ctx.state.connectionVersion).toBe(0);
        expect(ctx.panel.title).toBe('db/A');
        expect(ctx.sessions.get(session.id)).toBe(session);
        expect(session.isDisposed).toBe(false);
        expect(ctx.state.isChangingConnection).toBe(false);
    });

    it('rejects overlapping switches and result actions until validation finishes', async () => {
        const ctx = createContext();
        const session = addSession(ctx);
        const caller = queryEditorRouterDef.createCaller(ctx);
        const read = deferred<{ resource: { partitionKey: { paths: string[] } } }>();
        mocks.readContainer.mockReturnValueOnce(read.promise);
        const switching = caller.setConnection({ databaseId: 'db', containerId: 'B' });
        await vi.waitFor(() => expect(mocks.readContainer).toHaveBeenCalled());
        expect(ctx.state.connection).toBe(connectionA);
        await expect(caller.setConnection({ databaseId: 'db', containerId: 'C' })).rejects.toThrow(
            'connection is changing',
        );
        await expect(caller.deleteDocument({ documentId, executionId: session.id })).rejects.toThrow(
            'connection is changing',
        );
        read.resolve({ resource: { partitionKey: { paths: ['/pk'] } } });
        await switching;
        expect(ctx.state.connection?.containerId).toBe('B');
        expect(ctx.state.connectionVersion).toBe(1);
        expect(mocks.deleteDocument).not.toHaveBeenCalled();
    });

    it('leaves the connection unchanged when the picker is cancelled', async () => {
        const ctx = createContext();
        const session = addSession(ctx);
        mocks.pickConnection.mockResolvedValueOnce(undefined);
        await queryEditorRouterDef.createCaller(ctx).connectToDatabase();
        expect(ctx.state.connection).toBe(connectionA);
        expect(ctx.sessions.get(session.id)).toBe(session);
        expect(ctx.state.connectionVersion).toBe(0);
    });

    it('invalidates sessions and settles waiting tools on disconnect', async () => {
        const ctx = createContext();
        const session = addSession(ctx);
        const resolve = vi.fn();
        ctx.state.pendingRuns.set('request', { resolve, executionId: session.id });
        await queryEditorRouterDef.createCaller(ctx).disconnectFromDatabase();
        expect(resolve).toHaveBeenCalledWith(undefined);
        expect(ctx.state.pendingRuns.size).toBe(0);
        expect(ctx.sessions.size).toBe(0);
        expect(session.isDisposed).toBe(true);
        expect(ctx.state.connection).toBeUndefined();
    });

    it('preserves ownership of stopped results until switching connections', async () => {
        const ctx = createContext();
        const session = addSession(ctx);
        const caller = queryEditorRouterDef.createCaller(ctx);
        await caller.stopQuery({ executionId: session.id });
        for (const mode of ['view', 'edit'] as const) {
            await caller.openDocument({ mode, documentId, executionId: session.id });
            expect(mocks.openDocument).toHaveBeenLastCalledWith(connectionA, mode, documentId, expect.any(Number));
        }
        await caller.deleteDocument({ documentId, executionId: session.id });
        expect(mocks.deleteDocument).toHaveBeenCalledWith(connectionA, documentId);
        await caller.setConnection({ databaseId: 'db', containerId: 'B' });
        await expect(caller.deleteDocument({ documentId, executionId: session.id })).rejects.toThrow(
            'no longer current',
        );
        expect(mocks.deleteDocument).toHaveBeenCalledOnce();
    });

    it('keeps the old state if candidate metadata cannot be loaded', async () => {
        const ctx = createContext();
        const session = addSession(ctx);
        mocks.readSchema.mockRejectedValueOnce(new Error('Schema unavailable'));
        await expect(
            queryEditorRouterDef.createCaller(ctx).setConnection({ databaseId: 'db', containerId: 'B' }),
        ).rejects.toThrow('Schema unavailable');
        expect(ctx.state.connection).toBe(connectionA);
        expect(ctx.state.connectionVersion).toBe(0);
        expect(ctx.sessions.get(session.id)).toBe(session);
        expect(ctx.panel.title).toBe('db/A');
        expect(ctx.state.isChangingConnection).toBe(false);
    });

    it('rejects session creation if the connection changes during the reload confirmation', async () => {
        const ctx = createContext();
        const session = addSession(ctx);
        const confirmation = deferred<void>();
        const warning = vi
            .spyOn(vscode.window, 'showWarningMessage')
            .mockImplementationOnce(async (_message, _options, ...items) => {
                await confirmation.promise;
                return items[0];
            });
        const caller = queryEditorRouterDef.createCaller(ctx);
        const creation = caller.createQuerySession({
            query: 'SELECT * FROM c',
            options: { sessionId: session.id },
            connectionVersion: 0,
        });
        await vi.waitFor(() => expect(warning).toHaveBeenCalled());
        await caller.setConnection({ databaseId: 'db', containerId: 'B' });
        confirmation.resolve();
        await expect(creation).rejects.toThrow('no longer current');
        expect(ctx.sessions.size).toBe(0);
    });

    it('rejects old results when connecting to another account with the same database and container names', async () => {
        const ctx = createContext();
        const session = addSession(ctx);
        mocks.pickConnection.mockResolvedValueOnce({ ...connectionA, endpoint: 'https://other.documents.azure.com' });
        const caller = queryEditorRouterDef.createCaller(ctx);
        await caller.connectToDatabase();
        await expect(caller.deleteDocument({ documentId, executionId: session.id })).rejects.toThrow(
            'no longer current',
        );
        expect(mocks.deleteDocument).not.toHaveBeenCalled();
    });

    for (const operation of ['runQuery', 'nextPage', 'prevPage', 'firstPage'] as const) {
        it(`drops ${operation} responses completing after a switch`, async () => {
            const ctx = createContext();
            const session = addSession(ctx);
            const result = deferred<QueryExecutionResult>();
            const method = operation === 'runQuery' ? 'run' : operation;
            vi.spyOn(session, method).mockReturnValueOnce(result.promise);
            const caller = queryEditorRouterDef.createCaller(ctx);
            const execution = caller[operation]({ executionId: session.id });
            await vi.waitFor(() => expect(session[method]).toHaveBeenCalled());
            await caller.setConnection({ databaseId: 'db', containerId: 'B' });
            result.resolve({ executionId: session.id, startTime: 0, endTime: 1, currentPage: 1, result: null });
            expect(await execution).toBeUndefined();
            await expect(caller[operation]({ executionId: session.id })).rejects.toThrow('no longer current');
        });
    }

    it('rejects stale session creation and result-based opens, but permits adding a new item', async () => {
        const ctx = createContext();
        const session = addSession(ctx);
        const caller = queryEditorRouterDef.createCaller(ctx);
        await caller.setConnection({ databaseId: 'db', containerId: 'B' });
        await expect(
            caller.createQuerySession({ query: 'SELECT * FROM c', options: {}, connectionVersion: 0 }),
        ).rejects.toThrow('no longer current');
        for (const mode of ['view', 'edit'] as const) {
            await expect(caller.openDocument({ mode, documentId, executionId: session.id })).rejects.toThrow(
                'no longer current',
            );
            await expect(caller.openDocument({ mode, documentId })).rejects.toThrow('no longer current');
        }
        expect(mocks.openDocument).not.toHaveBeenCalled();
        await caller.openDocument({ mode: 'add' });
        expect(mocks.openDocument.mock.calls[0][0]).toBe(ctx.state.connection);
        const created = await caller.createQuerySession({
            query: 'SELECT * FROM c',
            options: {},
            connectionVersion: 1,
        });
        expect(ctx.sessions.get(created!.executionId)?.connection).toBe(ctx.state.connection);
    });
});
