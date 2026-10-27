/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type QueryGenerationRequest } from '../../../dataModeling/queryGeneration';
import { createBlankContainer, type DataModel } from './dataModel';
import { queryGenerationKey, useQueryGeneration } from './useQueryGeneration';

const client = vi.hoisted(() => ({
    dataModeling: { generateQuery: { mutate: vi.fn() }, acknowledgeQuery: { mutate: vi.fn() } },
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));

function setup() {
    const container = createBlankContainer('Orders');
    container.properties = [
        { id: 'customer', name: 'customer/id', type: 'string', role: 'filter', pkCandidate: false },
    ];
    container.reads = [
        { id: 'read', pattern: 'Get customer orders', query: '', filters: [], qps: 10 },
        { id: 'other', pattern: 'Other query', query: 'SELECT * FROM c', filters: [], qps: 5 },
    ];
    const otherContainer = { ...container, id: 'other-container', entity: 'Other' };
    const hook = renderHook(() => {
        const [model, setModel] = useState<DataModel>({
            containers: [container, otherContainer],
            activeContainerId: container.id,
        });
        return { ...useQueryGeneration(model, setModel), model, setModel };
    });
    const generate = async (readId = 'read') => {
        await act(() => hook.result.current.generate(container.id, readId));
        return client.dataModeling.generateQuery.mutate.mock.lastCall![0] as QueryGenerationRequest;
    };
    return { ...hook, container, generate };
}

beforeEach(() => {
    vi.clearAllMocks();
    client.dataModeling.generateQuery.mutate.mockResolvedValue(undefined);
    client.dataModeling.acknowledgeQuery.mutate.mockResolvedValue(undefined);
});

describe('Data Modeler query generation state', () => {
    it('updates only the pinned row and filters, retaining QPS and navigation', async () => {
        const { result, container, generate } = setup();
        const request = await generate();
        act(() =>
            result.current.setModel((model) => ({
                ...model,
                activeContainerId: 'other-container',
                containers: model.containers.map((item) =>
                    item.id === container.id
                        ? { ...item, reads: item.reads.map((read) => ({ ...read, qps: 99 })) }
                        : item,
                ),
            })),
        );
        const sql = 'SELECT *\nFROM c WHERE c.customer.id = @id';
        act(() => result.current.receive({ requestId: request.requestId, query: sql }));
        expect(result.current.model.activeContainerId).toBe('other-container');
        expect(result.current.model.containers[0].reads[0]).toMatchObject({
            query: sql,
            filters: ['customer/id'],
            qps: 99,
        });
        expect(result.current.model.containers[0].reads[1].query).toBe('SELECT * FROM c');
        expect(result.current.model.containers[1].reads[0].query).toBe('');
        expect(client.dataModeling.acknowledgeQuery.mutate).toHaveBeenCalledWith({
            requestId: request.requestId,
            outcome: 'applied',
        });
    });

    it.each(['description', 'query', 'filters', 'schema', 'remove', 'reset'])(
        'rejects results after %s changes',
        async (change) => {
            const { result, generate } = setup();
            const request = await generate();
            act(() =>
                result.current.setModel((model) => {
                    const container = structuredClone(model.containers[0]);
                    if (change === 'description') container.reads[0].pattern = 'New description';
                    if (change === 'query') container.reads[0].query = 'SELECT c.id FROM c';
                    if (change === 'filters') container.reads[0].filters = ['id'];
                    if (change === 'schema') container.properties[0].name = 'newField';
                    if (change === 'remove') container.reads = [];
                    return {
                        ...model,
                        containers: change === 'reset' ? [] : [container, ...model.containers.slice(1)],
                    };
                }),
            );
            const before = result.current.model;
            act(() => result.current.receive({ requestId: request.requestId, query: 'SELECT * FROM c' }));
            expect(result.current.model).toBe(before);
            expect(client.dataModeling.acknowledgeQuery.mutate).toHaveBeenCalledWith({
                requestId: request.requestId,
                outcome: 'stale',
            });
        },
    );

    it('rejects superseded requests and duplicate tool results', async () => {
        const { result, generate } = setup();
        const first = await generate();
        const second = await generate();
        act(() => result.current.receive({ requestId: first.requestId, query: 'SELECT * FROM c' }));
        expect(result.current.model.containers[0].reads[0].query).toBe('');
        act(() => result.current.receive({ requestId: second.requestId, query: 'SELECT c.id FROM c' }));
        act(() => result.current.receive({ requestId: second.requestId, query: 'SELECT * FROM c' }));
        expect(result.current.model.containers[0].reads[0].query).toBe('SELECT c.id FROM c');
        expect(client.dataModeling.acknowledgeQuery.mutate).toHaveBeenLastCalledWith({
            requestId: second.requestId,
            outcome: 'stale',
        });
    });

    it('handles concurrent rows without losing an earlier update', async () => {
        const { result, generate } = setup();
        const first = await generate();
        const second = await generate('other');
        act(() => {
            result.current.receive({ requestId: first.requestId, query: 'SELECT c.id FROM c' });
            result.current.receive({ requestId: second.requestId, query: 'SELECT c.customer FROM c' });
        });
        expect(result.current.model.containers[0].reads.map((read) => read.query)).toEqual([
            'SELECT c.id FROM c',
            'SELECT c.customer FROM c',
        ]);
    });

    it('shows launch and agent failures while preserving the query', async () => {
        const { result, container, generate } = setup();
        client.dataModeling.generateQuery.mutate.mockRejectedValueOnce(new Error('Copilot unavailable'));
        await generate();
        const key = queryGenerationKey(container.id, 'read');
        expect(result.current.statuses[key].message).toContain('Copilot unavailable');
        expect(result.current.statuses[key].opening).toBe(false);
        const request = await generate();
        act(() => result.current.receive({ requestId: request.requestId, error: 'Missing schema' }));
        expect(result.current.statuses[key].message).toContain('Missing schema');
        expect(result.current.model.containers[0].reads[0].query).toBe('');
    });

    it('lets the agent retry invalid SQL and rejects results after subscription loss', async () => {
        const { result, generate } = setup();
        const request = await generate();
        act(() => result.current.receive({ requestId: request.requestId, query: 'SELECT FROM' }));
        expect(client.dataModeling.acknowledgeQuery.mutate).toHaveBeenLastCalledWith({
            requestId: request.requestId,
            outcome: 'invalidQuery',
        });
        act(() => result.current.receive({ requestId: request.requestId, query: 'SELECT * FROM c' }));
        expect(result.current.model.containers[0].reads[0].query).toBe('SELECT * FROM c');
        const next = await generate();
        act(() => result.current.subscriptionFailed());
        act(() => result.current.receive({ requestId: next.requestId, query: 'SELECT c.id FROM c' }));
        expect(result.current.model.containers[0].reads[0].query).toBe('SELECT * FROM c');
    });
});
