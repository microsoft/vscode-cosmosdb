/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTRPCClient } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { describe, expect, it, vi } from 'vitest';
import { type QueryEditorAppRouter, type QueryEditorEvent } from '../../../api/types';
import { QueryEditorContextProvider } from './QueryEditorContextProvider';

function createProvider() {
    let onEvent: ((event: QueryEditorEvent) => void) | undefined;
    const createQuerySession = vi.fn().mockReturnValue({ executionId: 'execution-1' });
    const reportActiveQueryExecuted = vi.fn();
    const client = createTRPCClient<QueryEditorAppRouter>({
        links: [
            () =>
                ({ op }) =>
                    observable((observer) => {
                        if (op.type === 'subscription') {
                            onEvent = (event) => observer.next({ result: { data: event } });
                            return;
                        }

                        let data: unknown;
                        switch (op.path) {
                            case 'queryEditor.prepareQuery':
                                data = { cleanQuery: 'SELECT * FROM c' };
                                break;
                            case 'queryEditor.createQuerySession':
                                data = createQuerySession(op.input);
                                break;
                            case 'queryEditor.reportActiveQueryStarted':
                                data = true;
                                break;
                            case 'queryEditor.reportActiveQueryExecuted':
                                reportActiveQueryExecuted(op.input);
                                break;
                        }
                        observer.next({ result: { data } });
                        observer.complete();
                    }),
        ],
    });
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
        const connection = { endpoint: 'https://localhost', databaseId: 'db', containerId: 'container' };
        emit({
            type: 'runActiveQueryRequested',
            requestId: 'request-1',
            query: 'SELECT * FROM c',
            connection,
        });
        await vi.waitFor(() => expect(reportActiveQueryExecuted).toHaveBeenCalledOnce());

        expect(createQuerySession).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ isLlmTool: true, expectedConnection: connection }),
        );
        expect(reportActiveQueryExecuted).toHaveBeenCalledWith({
            executionId: 'execution-1',
            requestId: 'request-1',
        });

        await provider.runQuery('SELECT * FROM c', {});
        expect(createQuerySession).toHaveBeenCalledTimes(2);
        expect(createQuerySession.mock.lastCall?.[0]).not.toHaveProperty('isLlmTool');
        provider.dispose();
    });
});
