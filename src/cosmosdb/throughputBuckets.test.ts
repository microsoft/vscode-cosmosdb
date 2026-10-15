/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FeatureClient } from '@azure/arm-features';
import { createHttpHeaders, type PipelineResponse } from '@azure/core-rest-pipeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeatureClient, PRESERVE_API_VERSION_HEADER } from '../utils/azureClients';
import { ArmTestMetadata, armTestSubscription, createArmTestClient, createArmTestContext } from './armTestUtils';
import { type NoSqlQueryConnection } from './NoSqlQueryConnection';
import { getEnabledThroughputBuckets } from './throughputBuckets';
import {
    isThroughputBucketsFeatureRegistered,
    MAX_THROUGHPUT_BUCKETS,
    parseEnabledThroughputBuckets,
} from './throughputBucketsFeature';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));
vi.mock('../utils/azureClients', () => ({
    createFeatureClient: vi.fn(),
    PRESERVE_API_VERSION_HEADER: 'x-vscode-cosmosdb-preserve-api-version',
}));

describe('getEnabledThroughputBuckets', () => {
    const client = createArmTestClient();
    const featureClient = new FeatureClient({ getToken: () => Promise.resolve(null) }, 'sub-1');
    const context = createArmTestContext();
    const connection: NoSqlQueryConnection = {
        databaseId: 'db / one',
        containerId: 'container #1',
        endpoint: 'https://account.documents.azure.com',
        credentials: [],
        isEmulator: false,
        azureMetadata: new ArmTestMetadata(client),
    };

    function respond(status: number, bodyAsText?: string) {
        return vi
            .spyOn(client.pipeline, 'sendRequest')
            .mockImplementation((_httpClient, request) =>
                Promise.resolve({ request, status, headers: createHttpHeaders(), bodyAsText }),
            );
    }

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.mocked(createFeatureClient).mockResolvedValue(featureClient);
        vi.spyOn(featureClient.features, 'get').mockResolvedValue({
            name: 'Microsoft.DocumentDB/ThroughputBucketing',
            properties: { state: 'Registered' },
        });
    });

    it('uses the public pipeline and preserves the preview version on the sovereign endpoint', async () => {
        const send = respond(200, JSON.stringify({ properties: { resource: { throughputBuckets: [{ id: 2 }] } } }));
        const metadata = new ArmTestMetadata(client, {
            ...armTestSubscription,
            environment: {
                ...armTestSubscription.environment,
                resourceManagerEndpointUrl: 'https://management.usgovcloudapi.net/',
            },
        });

        await expect(getEnabledThroughputBuckets({ ...connection, azureMetadata: metadata }, context)).resolves.toEqual(
            [false, true, false, false, false],
        );
        expect(send).toHaveBeenCalledOnce();
        const [httpClient, request] = send.mock.calls[0];
        expect(httpClient.sendRequest).toBeTypeOf('function');
        expect(request.url).toBe(
            'https://management.usgovcloudapi.net/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account/sqlDatabases/db%20%2F%20one/containers/container%20%231/throughputSettings/default?api-version=2025-05-01-preview',
        );
        expect(request.method).toBe('GET');
        expect(request.headers.get(PRESERVE_API_VERSION_HEADER)).toBe('true');
    });

    it('falls back to shared database throughput only after a container 404', async () => {
        const send = respond(200, JSON.stringify({ properties: { resource: { throughputBuckets: [{ id: 3 }] } } }));
        send.mockImplementationOnce((_httpClient, request): Promise<PipelineResponse> =>
            Promise.resolve({ request, status: 404, headers: createHttpHeaders() }),
        );
        await expect(getEnabledThroughputBuckets(connection, context)).resolves.toEqual([
            false,
            false,
            true,
            false,
            false,
        ]);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[1][1].url).toContain('/sqlDatabases/db%20%2F%20one/throughputSettings/default?');
    });

    it.each([403, 500])('enables all buckets on HTTP %s without falling back to the database', async (status) => {
        const send = respond(status);
        await expect(getEnabledThroughputBuckets(connection, context)).resolves.toEqual(Array(5).fill(true));
        expect(send).toHaveBeenCalledOnce();
    });

    it('enables all buckets on invalid JSON', async () => {
        respond(200, 'not-json');
        await expect(getEnabledThroughputBuckets(connection, context)).resolves.toEqual(Array(5).fill(true));
    });

    it('disables all buckets when neither throughput resource exists', async () => {
        const send = respond(404);
        await expect(getEnabledThroughputBuckets(connection, context)).resolves.toEqual(Array(5).fill(false));
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('hides the selector when the feature is not registered', async () => {
        vi.mocked(featureClient.features.get).mockResolvedValue({ properties: { state: 'NotRegistered' } });
        const send = respond(200);
        await expect(getEnabledThroughputBuckets(connection, context)).resolves.toBeUndefined();
        expect(send).not.toHaveBeenCalled();
    });
});

describe('isThroughputBucketsFeatureRegistered', () => {
    it('returns true for the registered Throughput Buckets feature', () => {
        expect(
            isThroughputBucketsFeatureRegistered({
                name: 'Microsoft.DocumentDB/ThroughputBucketing',
                properties: { state: 'Registered' },
            }),
        ).toBe(true);
    });

    it('matches the feature name and state case-insensitively', () => {
        expect(
            isThroughputBucketsFeatureRegistered({
                name: 'microsoft.documentdb/throughputbucketing',
                properties: { state: 'REGISTERED' },
            }),
        ).toBe(true);
    });

    it.each(['NotRegistered', 'Pending', 'Registering', 'Unregistered'])(
        'returns false when the feature state is %s',
        (state) => {
            expect(
                isThroughputBucketsFeatureRegistered({
                    name: 'Microsoft.DocumentDB/ThroughputBucketing',
                    properties: { state },
                }),
            ).toBe(false);
        },
    );

    it('returns false for unrelated registered features', () => {
        expect(
            isThroughputBucketsFeatureRegistered({
                name: 'Microsoft.DocumentDB/EnablePriorityBasedExecution',
                properties: { state: 'Registered' },
            }),
        ).toBe(false);
    });
});

describe('parseEnabledThroughputBuckets', () => {
    const enabled = (...ids: number[]): boolean[] =>
        Array.from({ length: MAX_THROUGHPUT_BUCKETS }, (_, index) => ids.includes(index + 1));

    it('marks configured buckets as enabled and the rest as disabled', () => {
        const body = {
            properties: {
                resource: {
                    throughput: 400,
                    throughputBuckets: [
                        { id: 1, maxThroughputPercentage: 50 },
                        { id: 3, maxThroughputPercentage: 30 },
                    ],
                },
            },
        };

        expect(parseEnabledThroughputBuckets(body)).toEqual(enabled(1, 3));
    });

    it('reports all buckets disabled when none are configured', () => {
        const body = { properties: { resource: { throughput: 400, throughputBuckets: [] } } };

        expect(parseEnabledThroughputBuckets(body)).toEqual(enabled());
    });

    it('ignores bucket ids outside the supported range', () => {
        const body = {
            properties: {
                resource: {
                    throughputBuckets: [{ id: 0 }, { id: 2 }, { id: 6 }, { id: 2.5 }, { id: '4' }],
                },
            },
        };

        expect(parseEnabledThroughputBuckets(body)).toEqual(enabled(2));
    });

    it.each([undefined, null, {}, { properties: {} }, { properties: { resource: {} } }, 'not-json'])(
        'reports all buckets disabled for malformed body %p',
        (body) => {
            expect(parseEnabledThroughputBuckets(body)).toEqual(enabled());
        },
    );

    it('honours a custom maximum bucket count', () => {
        const body = { properties: { resource: { throughputBuckets: [{ id: 2 }, { id: 3 }] } } };

        expect(parseEnabledThroughputBuckets(body, 3)).toEqual([false, true, true]);
    });
});
