/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MonitorClient, type MetricsListOptionalParams, type Response as MetricsResponse } from '@azure/arm-monitor';
import { vi } from 'vitest';

export async function withMetrics<T>(
    response: MetricsResponse | ((options?: MetricsListOptionalParams) => MetricsResponse),
    action: (client: MonitorClient) => Promise<T>,
): Promise<T> {
    const client = new MonitorClient(
        {
            getToken: async () => {
                throw new Error('Network access is forbidden in CODA conformance.');
            },
        },
        'fixture',
    );
    const list = vi
        .spyOn(client.metrics, 'list')
        .mockImplementation(async (_resource, options) =>
            typeof response === 'function' ? response(options) : response,
        );
    try {
        return await action(client);
    } finally {
        list.mockRestore();
    }
}

export function metricResponse(
    name: string,
    series: readonly (readonly (number | undefined)[])[],
    aggregation: 'maximum' | 'total' | 'count' = 'maximum',
): MetricsResponse {
    return {
        timespan: '',
        value: [
            {
                id: 'fixture',
                type: 'Microsoft.Insights/metrics',
                name: { value: name },
                unit: 'Count',
                timeseries: series.map((values, partition) => ({
                    metadatavalues: [{ name: { value: 'PhysicalPartitionId' }, value: `${partition}` }],
                    data: values.map((value, index) => ({
                        timeStamp: new Date(Date.UTC(2026, 0, 1, index)),
                        [aggregation]: value,
                    })),
                })),
            },
        ],
    };
}
