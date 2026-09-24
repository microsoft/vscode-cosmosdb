/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TrpcClient } from '@cosmosdb/webview-rpc/react';
import { describe, expect, it, vi } from 'vitest';
import { type QueryEditorAppRouter, type QueryEditorEvent } from '../../../api/types';
import { QueryEditorContextProvider } from './QueryEditorContextProvider';

function createProvider() {
    let onEvent: ((event: QueryEditorEvent) => void) | undefined;
    const createQuerySession = vi.fn().mockResolvedValue({ executionId: 'execution-1' });
    const reportActiveQueryExecuted = vi.fn().mockResolvedValue(undefined);
    const client = {
        queryEditor: {
            init: { mutate: vi.fn().mockResolvedValue(undefined) },
            prepareQuery: { mutate: vi.fn().mockResolvedValue({ cleanQuery: 'SELECT * FROM c' }) },
            updateQueryHistory: { mutate: vi.fn().mockResolvedValue(undefined) },
            createQuerySession: { mutate: createQuerySession },
            runQuery: { mutate: vi.fn().mockResolvedValue(undefined) },
            reportActiveQueryExecuted: { mutate: reportActiveQueryExecuted },
            events: {
                subscribe: (_input: undefined, handlers: { onData: (event: QueryEditorEvent) => void }) => {
                    onEvent = handlers.onData;
                    return { unsubscribe: vi.fn() };
                },
            },
        },
    } as unknown as TrpcClient<QueryEditorAppRouter>;
    const provider = new QueryEditorContextProvider(vi.fn(), vi.fn(), client);
    return {
        provider,
        createQuerySession,
        reportActiveQueryExecuted,
        emit: (event: QueryEditorEvent) => {
            expect(onEvent).toBeDefined();
            onEvent!(event);
        },
    };
}

describe('query execution origin', () => {
    it('marks tool-created sessions and leaves subsequent manual runs unmarked', async () => {
        const { provider, emit, createQuerySession, reportActiveQueryExecuted } = createProvider();
        emit({
            type: 'runActiveQueryRequested',
            query: 'SELECT * FROM c',
        });
        await vi.waitFor(() => expect(reportActiveQueryExecuted).toHaveBeenCalledOnce());

        expect(createQuerySession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ isLlmTool: true }));
        expect(reportActiveQueryExecuted).toHaveBeenCalledWith({
            executionId: 'execution-1',
        });

        await provider.runQuery('SELECT * FROM c', {});
        expect(createQuerySession).toHaveBeenCalledTimes(2);
        expect(createQuerySession.mock.lastCall?.[0]).not.toHaveProperty('isLlmTool');
        provider.dispose();
    });
});
