/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTRPCClient, TRPCClientError } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { describe, expect, it, vi } from 'vitest';
import { type QueryEditorAppRouter, type QueryEditorEvent } from '../../../api/types';
import { QueryEditorContextProvider } from './QueryEditorContextProvider';
import { defaultState, dispatch, type DispatchAction } from './QueryEditorState';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function setup(initDelay?: Promise<void>) {
    let emitEvent: (event: QueryEditorEvent) => void = () => {
        throw new Error('Query Editor event subscription is not ready');
    };
    const routes = {
        init: {
            mutate: vi.fn().mockImplementation(async () => {
                await initDelay;
                return {
                    connectionVersion: 0,
                    connectionState: { connectionVersion: 0, dbName: 'db', containerName: 'A' },
                    queryHistory: [],
                    isSurveyCandidate: false,
                    isAIFeaturesEnabled: false,
                    isSchemaBasedOnQueries: false,
                };
            }),
        },
        setConnection: { mutate: vi.fn() },
        disconnectFromDatabase: { mutate: vi.fn() },
        prepareQuery: { mutate: vi.fn().mockResolvedValue({ cleanQuery: 'SELECT * FROM c' }) },
        updateQueryHistory: { mutate: vi.fn().mockResolvedValue({ queryHistory: ['SELECT * FROM c'] }) },
        createQuerySession: { mutate: vi.fn().mockResolvedValue({ executionId: 'A' }) },
        reportActiveQueryStarted: { mutate: vi.fn().mockResolvedValue(true) },
        reportActiveQueryExecuted: { mutate: vi.fn().mockResolvedValue(undefined) },
        runQuery: { mutate: vi.fn().mockResolvedValue(undefined) },
        nextPage: { mutate: vi.fn() },
        deleteDocument: { mutate: vi.fn().mockResolvedValue({ deleted: true }) },
        refreshThroughputBuckets: { mutate: vi.fn() },
    };
    const procedures = new Map<string, (input: unknown) => unknown>();
    for (const [name, route] of Object.entries(routes)) {
        if ('mutate' in route) procedures.set(`queryEditor.${name}`, route.mutate);
    }
    const client = createTRPCClient<QueryEditorAppRouter>({
        links: [
            () =>
                ({ op }) =>
                    observable((observer) => {
                        if (op.type === 'subscription') {
                            emitEvent = (event) => observer.next({ result: { data: event } });
                            return;
                        }
                        const procedure = procedures.get(op.path);
                        if (!procedure) throw new Error(`Unexpected test procedure: ${op.path}`);
                        void Promise.resolve(procedure(op.input)).then(
                            (data: unknown) => {
                                observer.next({ result: { data } });
                                observer.complete();
                            },
                            (error: unknown) =>
                                observer.error(
                                    TRPCClientError.from(error instanceof Error ? error : new Error(String(error))),
                                ),
                        );
                    }),
        ],
    });
    let state = { ...defaultState };
    const dispatchAction = vi.fn((action: DispatchAction) => {
        state = dispatch(state, action);
    });
    const provider = new QueryEditorContextProvider(dispatchAction, vi.fn(), client);
    if (!initDelay) await vi.waitUntil(() => state.isConnected);
    return {
        routes,
        provider,
        dispatchAction,
        getState: () => state,
        emitEvent: (event: QueryEditorEvent) => emitEvent(event),
    };
}

describe('query execution origin', () => {
    it('marks tool-created sessions and leaves subsequent manual runs unmarked', async () => {
        const { provider, emitEvent, routes } = await setup();
        const connection = { endpoint: 'https://localhost', databaseId: 'db', containerId: 'container' };
        emitEvent({
            type: 'runActiveQueryRequested',
            requestId: 'request-1',
            query: 'SELECT * FROM c',
            connection,
        });
        await vi.waitFor(() => expect(routes.reportActiveQueryExecuted.mutate).toHaveBeenCalledOnce());

        expect(routes.createQuerySession.mutate).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ isLlmTool: true, expectedConnection: connection, connectionVersion: 0 }),
        );
        expect(routes.reportActiveQueryExecuted.mutate).toHaveBeenCalledWith({
            executionId: 'A',
            requestId: 'request-1',
        });

        await provider.runQuery('SELECT * FROM c', {});
        expect(routes.createQuerySession.mutate).toHaveBeenCalledTimes(2);
        expect(routes.createQuerySession.mutate.mock.lastCall?.[0]).not.toHaveProperty('isLlmTool');
        provider.dispose();
    });
});

describe('query editor connection transitions', () => {
    for (const target of ['B', 'A', 'disconnected']) {
        it(`ignores a pending throughput refresh after switching to ${target}`, async () => {
            const { provider, routes, getState, dispatchAction, emitEvent } = await setup();
            const response = deferred<boolean[]>();
            routes.refreshThroughputBuckets.mutate.mockReturnValue(response.promise);
            emitEvent({ type: 'throughputBucketsRefreshRequested' });
            expect(routes.refreshThroughputBuckets.mutate).toHaveBeenCalledOnce();
            const currentBuckets = [false, true, false, false, false];
            routes.setConnection.mutate.mockResolvedValue({
                connectionVersion: 1,
                dbName: 'db',
                containerName: 'B',
                throughputBuckets: currentBuckets,
            });
            await provider.setConnection('db', 'B');
            if (target === 'A') {
                routes.setConnection.mutate.mockResolvedValue({
                    connectionVersion: 2,
                    dbName: 'db',
                    containerName: 'A',
                    throughputBuckets: currentBuckets,
                });
                await provider.setConnection('db', 'A');
            } else if (target === 'disconnected') {
                routes.disconnectFromDatabase.mutate.mockResolvedValue({ connectionVersion: 2, disconnected: true });
                await provider.disconnectFromDatabase();
            }
            dispatchAction.mockClear();
            const previousBuckets = getState().throughputBuckets;

            response.resolve([true, false, false, false, false]);
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(getState().throughputBuckets).toEqual(previousBuckets);
            expect(dispatchAction).not.toHaveBeenCalled();
            provider.dispose();
        });
    }

    it('applies a throughput refresh for the current generation', async () => {
        const { provider, routes, getState, emitEvent } = await setup();
        const buckets = [true, false, true, false, false];
        routes.refreshThroughputBuckets.mutate.mockResolvedValue(buckets);
        emitEvent({ type: 'throughputBucketsRefreshRequested' });
        await vi.waitFor(() => expect(getState().throughputBuckets).toEqual(buckets));
        provider.dispose();
    });

    for (const target of ['B', 'A', 'disconnected']) {
        it(`ignores schema events from an old generation after switching to ${target}`, async () => {
            const { provider, routes, getState, dispatchAction, emitEvent } = await setup();
            const currentSchema = { type: 'object', properties: { current: { type: 'string' } } };
            routes.setConnection.mutate.mockResolvedValue({
                connectionVersion: 1,
                dbName: 'db',
                containerName: 'B',
                containerSchema: currentSchema,
            });
            await provider.setConnection('db', 'B');
            if (target === 'A') {
                routes.setConnection.mutate.mockResolvedValue({
                    connectionVersion: 2,
                    dbName: 'db',
                    containerName: 'A',
                    containerSchema: currentSchema,
                });
                await provider.setConnection('db', 'A');
            } else if (target === 'disconnected') {
                routes.disconnectFromDatabase.mutate.mockResolvedValue({ connectionVersion: 2, disconnected: true });
                await provider.disconnectFromDatabase();
            }
            dispatchAction.mockClear();
            const previousSchema = getState().containerSchema;

            emitEvent({ type: 'schemaUpdated', connectionVersion: 0, containerSchema: { type: 'string' } });
            emitEvent({ type: 'schemaUpdated', connectionVersion: 0, containerSchema: null });

            expect(getState().containerSchema).toEqual(previousSchema);
            expect(dispatchAction).not.toHaveBeenCalled();
            provider.dispose();
        });
    }

    it('applies schema updates and removal for the current generation', async () => {
        const { provider, getState, emitEvent } = await setup();
        const schema = { type: 'object', properties: { current: { type: 'string' } } };
        emitEvent({ type: 'schemaUpdated', connectionVersion: 0, containerSchema: schema });
        expect(getState().containerSchema).toEqual(schema);
        emitEvent({ type: 'schemaUpdated', connectionVersion: 0, containerSchema: null });
        expect(getState().containerSchema).toBeNull();
        provider.dispose();
    });

    it('waits for initialization before changing connections', async () => {
        const init = deferred<void>();
        const { provider, routes, getState } = await setup(init.promise);
        routes.setConnection.mutate.mockResolvedValue({ connectionVersion: 1, dbName: 'db', containerName: 'B' });
        const switching = provider.setConnection('db', 'B');
        expect(routes.setConnection.mutate).not.toHaveBeenCalled();
        init.resolve();
        await switching;
        expect(getState()).toMatchObject({ containerName: 'B', isConnected: true, isChangingConnection: false });
    });

    for (const failure of [false, true]) {
        it(`preserves old results when a connection change ${failure ? 'fails' : 'is cancelled'}`, async () => {
            const { provider, routes, getState, dispatchAction } = await setup();
            dispatchAction({ type: 'executionStarted', executionId: 'A', startExecutionTime: 10 });
            if (failure) routes.setConnection.mutate.mockRejectedValue(new Error('Unavailable'));
            else routes.setConnection.mutate.mockResolvedValue(undefined);
            await provider.setConnection('db', 'B');
            expect(getState()).toMatchObject({
                containerName: 'A',
                currentExecutionId: 'A',
                isConnected: true,
                isChangingConnection: false,
            });
        });
    }

    it('keeps execution and selection when the host reports an unchanged connection', async () => {
        const { provider, routes, getState, dispatchAction } = await setup();
        dispatchAction({ type: 'executionStarted', executionId: 'A', startExecutionTime: 10 });
        dispatchAction({
            type: 'updateQueryResult',
            executionId: 'A',
            currentPage: 1,
            result: {
                documents: [{ id: 'first' }],
                iteration: 1,
                metadata: {},
                indexMetrics: '',
                requestCharge: 0,
                roundTrips: 1,
                hasMoreResults: false,
                query: 'SELECT * FROM c',
            },
        });
        dispatchAction({ type: 'setSelectedRows', selectedRows: [0] });
        routes.setConnection.mutate.mockResolvedValue(undefined);
        const previousState = getState();
        dispatchAction.mockClear();

        await provider.setConnection('db', 'A');

        expect(getState()).toEqual(previousState);
        expect(dispatchAction).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'databaseConnected' }));
        await provider.runQuery('SELECT * FROM c', {});
        expect(routes.createQuerySession.mutate).toHaveBeenCalledWith(
            expect.objectContaining({ connectionVersion: 0 }),
        );
    });

    it('blocks overlapping switches and resets only after a successful response', async () => {
        const { provider, routes, getState, dispatchAction } = await setup();
        dispatchAction({ type: 'executionStarted', executionId: 'old', startExecutionTime: 10 });
        const response = deferred<{ connectionVersion: number; dbName: string; containerName: string }>();
        routes.setConnection.mutate.mockReturnValue(response.promise);
        const switchConnection = provider.setConnection('db', 'B');
        await vi.waitFor(() => expect(routes.setConnection.mutate).toHaveBeenCalledOnce());
        expect(getState().isChangingConnection).toBe(true);
        expect(getState().containerName).toBe('A');
        await provider.setConnection('db', 'C');
        expect(routes.setConnection.mutate).toHaveBeenCalledOnce();
        response.resolve({ connectionVersion: 1, dbName: 'db', containerName: 'B' });
        await switchConnection;
        expect(getState()).toMatchObject({
            containerName: 'B',
            currentExecutionId: '',
            isExecuting: false,
            isChangingConnection: false,
        });
        await provider.runQuery('SELECT * FROM c', {});
        expect(routes.createQuerySession.mutate).toHaveBeenCalledWith(
            expect.objectContaining({ connectionVersion: 1 }),
        );
    });

    it('does not disconnect or clear results when disconnect fails', async () => {
        const { provider, routes, getState, dispatchAction } = await setup();
        dispatchAction({ type: 'executionStarted', executionId: 'A', startExecutionTime: 10 });
        routes.disconnectFromDatabase.mutate.mockRejectedValue(new Error('Transport failure'));
        await provider.disconnectFromDatabase();
        expect(getState()).toMatchObject({
            isConnected: true,
            containerName: 'A',
            currentExecutionId: 'A',
            isChangingConnection: false,
        });
    });

    it('does not reactivate an old execution when session creation responds after switching', async () => {
        const { provider, routes, getState } = await setup();
        const session = deferred<{ executionId: string }>();
        routes.createQuerySession.mutate.mockReturnValue(session.promise);
        const running = provider.runQuery('SELECT * FROM c', {});
        await vi.waitFor(() => expect(routes.createQuerySession.mutate).toHaveBeenCalled());
        routes.setConnection.mutate.mockResolvedValue({ connectionVersion: 1, dbName: 'db', containerName: 'B' });
        await provider.setConnection('db', 'B');
        session.resolve({ executionId: 'old' });
        await running;
        expect(routes.runQuery.mutate).not.toHaveBeenCalled();
        expect(getState()).toMatchObject({ containerName: 'B', currentExecutionId: '', isExecuting: false });
    });

    it('does not let an old pagination error stop a new query', async () => {
        const { provider, routes, getState, dispatchAction } = await setup();
        dispatchAction({ type: 'executionStarted', executionId: 'A', startExecutionTime: 10 });
        const page = deferred<undefined>();
        routes.nextPage.mutate.mockReturnValue(page.promise);
        provider.nextPage('A');
        routes.setConnection.mutate.mockResolvedValue({ connectionVersion: 1, dbName: 'db', containerName: 'B' });
        await provider.setConnection('db', 'B');
        dispatchAction({ type: 'executionStarted', executionId: 'B', startExecutionTime: 20 });
        page.reject(new Error('Old query failed'));
        await vi.waitFor(() =>
            expect(dispatchAction).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'executionStopped', executionId: 'A' }),
            ),
        );
        expect(getState()).toMatchObject({ currentExecutionId: 'B', isExecuting: true });
    });

    it('forwards the result execution ID without substituting the current connection', async () => {
        const { provider, routes } = await setup();
        routes.setConnection.mutate.mockResolvedValue({ connectionVersion: 1, dbName: 'db', containerName: 'B' });
        await provider.setConnection('db', 'B');
        const document = { id: 'same', _rid: 'rid', partitionKey: 'shared' };
        await provider.deleteDocument(document, 'A');
        expect(routes.deleteDocument.mutate).toHaveBeenCalledWith({ documentId: document, executionId: 'A' });
    });
});
