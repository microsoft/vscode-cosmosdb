/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));

vi.mock('../extensionVariables', () => ({
    ext: { outputChannel: { info: vi.fn(), warn: vi.fn() } },
}));

vi.mock('../panels/DataModelingWizardTab', () => ({
    DataModelingWizardTab: { getActiveTab: vi.fn(), openTabs: new Set() },
}));

import { formatRecommendationForChat } from './reportPartitionKeyRecommendationTool';

describe('formatRecommendationForChat', () => {
    it('includes the complete recommendation when the Data Modeling wizard is unavailable', () => {
        const text = formatRecommendationForChat({
            summary: 'Use customerId to keep customer operations co-located.',
            containers: [
                {
                    entity: 'Orders',
                    partitionKey: '/customerId',
                    rationale: 'Most reads and writes are scoped to a customer.',
                    candidates: [
                        {
                            partitionKey: '/customerId',
                            verdict: 'recommended',
                            score: 95,
                            assessments: [
                                { label: 'Query match', status: 'pass', detail: 'Customer reads are targeted.' },
                            ],
                        },
                    ],
                    hotPartitionRisk: [{ partitionKey: '/customerId', risk: 'low', pct: 10 }],
                    queryRouting: {
                        headline: 'All common reads are single-partition.',
                        routes: [
                            {
                                pattern: 'List orders',
                                filters: 'customerId',
                                qps: '100/s',
                                routing: 'single',
                                estCost: '3 RU',
                            },
                        ],
                        analysis: 'Keep customerId in every read predicate.',
                    },
                    documentIdStrategy: {
                        tag: 'Customer order',
                        recommendation: 'Use the order identifier as id.',
                    },
                },
            ],
        });

        expect(text).toContain('The Data Modeling wizard is no longer open.');
        expect(text).toContain('Use customerId to keep customer operations co-located.');
        expect(text).toContain('Recommended partition key: `/customerId`');
        expect(text).toContain('Query match (pass): Customer reads are targeted.');
        expect(text).toContain('Hot-partition risk');
        expect(text).toContain('List orders: single partition; customerId; 100/s; 3 RU');
        expect(text).toContain('Use the order identifier as id.');
    });
});
