/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as pipeline from '@azure/core-rest-pipeline';
import * as https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCosmosHttpClient } from './createCosmosHttpClient';

vi.mock('@azure/core-rest-pipeline', { spy: true });

describe('VS Code-managed Cosmos HTTP transport', () => {
    const sendRequest = vi.fn<pipeline.HttpClient['sendRequest']>();
    let agent: https.Agent;

    beforeEach(() => {
        agent = new https.Agent();
        sendRequest.mockReset();
        sendRequest.mockImplementation(async (request) => ({
            request,
            status: 200,
            headers: pipeline.createHttpHeaders(),
        }));
        vi.mocked(pipeline.createDefaultHttpClient).mockReturnValue({ sendRequest });
    });

    afterEach(() => {
        agent.destroy();
        vi.mocked(pipeline.createDefaultHttpClient).mockReset();
    });

    it.each(['http://account.example.com', 'https://account.example.com'])(
        'clears the final Node agent option for %s even when Cosmos supplies a default agent',
        async (url) => {
            const request = pipeline.createPipelineRequest({ url });
            request.agent = agent;
            await createCosmosHttpClient().sendRequest(request);

            expect(sendRequest).toHaveBeenCalledExactlyOnceWith(request);
            expect(request.requestOverrides).toEqual({
                minVersion: 'TLSv1.2',
                rejectUnauthorized: true,
                agent: undefined,
            });
            expect(Object.hasOwn(request.requestOverrides ?? {}, 'agent')).toBe(true);
            expect(request.agent).toBe(agent);
        },
    );

    it('preserves other request overrides without mutating their source object', async () => {
        const request = pipeline.createPipelineRequest({ url: 'https://account.example.com' });
        const overrides = { ca: 'test-ca', minVersion: 'TLSv1.3', servername: 'account.example.com' };
        request.requestOverrides = overrides;

        await createCosmosHttpClient().sendRequest(request);

        expect(request.requestOverrides).toEqual({ rejectUnauthorized: true, ...overrides, agent: undefined });
        expect(request.requestOverrides).not.toBe(overrides);
        expect(overrides).not.toHaveProperty('agent');
    });

    it('defers every request including discovered regional endpoints to VS Code', async () => {
        const client = createCosmosHttpClient();
        const primary = pipeline.createPipelineRequest({ url: 'https://account.example.com' });
        const regional = pipeline.createPipelineRequest({ url: 'https://account-west.example.com' });
        primary.agent = agent;
        regional.agent = agent;

        await client.sendRequest(primary);
        await client.sendRequest(regional);

        expect(sendRequest).toHaveBeenCalledTimes(2);
        expect(primary.requestOverrides).toEqual({
            minVersion: 'TLSv1.2',
            rejectUnauthorized: true,
            agent: undefined,
        });
        expect(regional.requestOverrides).toEqual(primary.requestOverrides);
    });

    it.each([true, false])('applies strictSSL=%s without restoring an agent', async (strictSSL) => {
        const request = pipeline.createPipelineRequest({ url: 'https://account.example.com' });
        await createCosmosHttpClient(strictSSL).sendRequest(request);

        expect(request.requestOverrides).toMatchObject({ rejectUnauthorized: strictSSL, agent: undefined });
    });

    it('preserves an explicit per-request TLS choice', async () => {
        const request = pipeline.createPipelineRequest({ url: 'https://account.example.com' });
        request.requestOverrides = { rejectUnauthorized: true };
        await createCosmosHttpClient(false).sendRequest(request);

        expect(request.requestOverrides?.rejectUnauthorized).toBe(true);
    });

    it('preserves method, body, headers, cancellation, and the transport response', async () => {
        const controller = new AbortController();
        const request = pipeline.createPipelineRequest({
            url: 'https://account.example.com/dbs',
            method: 'POST',
            body: '{"test":true}',
            headers: pipeline.createHttpHeaders({ authorization: 'test-auth' }),
            abortSignal: controller.signal,
        });
        const response = { request, status: 201, headers: pipeline.createHttpHeaders(), bodyAsText: '{"id":"test"}' };
        sendRequest.mockResolvedValue(response);
        const result = await createCosmosHttpClient().sendRequest(request);

        expect(result).toBe(response);
        expect(request.method).toBe('POST');
        expect(request.body).toBe('{"test":true}');
        expect(request.headers.get('authorization')).toBe('test-auth');
        expect(request.abortSignal).toBe(controller.signal);
    });

    it('propagates transport failures without retrying or falling back', async () => {
        const error = new Error('proxy refused the connection');
        sendRequest.mockRejectedValue(error);
        const request = pipeline.createPipelineRequest({ url: 'https://account.example.com' });

        await expect(createCosmosHttpClient().sendRequest(request)).rejects.toBe(error);
        expect(sendRequest).toHaveBeenCalledOnce();
    });
});
