/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TokenCredential } from '@azure/core-auth';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { LogsQueryClient } from '@azure/monitor-query-logs';
import { describe, expect, it, vi } from 'vitest';
import { logWindow, probeCdbLogs } from './logs';

describe('Log Analytics SDK resource route', () => {
    it.each(['/', ''])(
        'normalizes the Cosmos ARM ID with leading prefix "%s" on the Log Analytics route',
        async (prefix) => {
            const resource = `${prefix}subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account`;
            const requests: { url: string; body: unknown }[] = [];
            const getToken = vi
                .fn<TokenCredential['getToken']>()
                .mockResolvedValue({ token: 'test-token', expiresOnTimestamp: Date.now() + 3600000 });
            const client = new LogsQueryClient(
                { getToken },
                {
                    retryOptions: { maxRetries: 0 },
                    httpClient: {
                        sendRequest: async (request) => {
                            requests.push({ url: request.url, body: request.body });
                            return {
                                request,
                                status: 200,
                                headers: createHttpHeaders(),
                                bodyAsText: JSON.stringify({
                                    tables: [{ name: 'PrimaryResult', columns: [], rows: [] }],
                                }),
                            };
                        },
                    },
                },
            );
            await expect(probeCdbLogs(client, resource, logWindow())).resolves.toEqual({ available: true });
            expect(requests).toHaveLength(1);
            const url = new URL(requests[0].url);
            expect(url.origin).toBe('https://api.loganalytics.io');
            expect(url.pathname).toBe(`/v1/${resource.replace(/^\/+/, '')}/query`);
            expect(getToken.mock.calls[0]?.[0]).toContain('https://api.loganalytics.io/.default');
        },
    );
});
