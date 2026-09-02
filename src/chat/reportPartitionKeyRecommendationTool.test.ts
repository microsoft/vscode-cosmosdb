/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_event: string, callback: (context: unknown) => unknown): Promise<unknown> =>
            callback({
                telemetry: { properties: {} as Record<string, string>, measurements: {} as Record<string, number> },
                errorHandling: { suppressDisplay: false },
            }),
    ),
}));

vi.mock('../extensionVariables', () => ({
    ext: { outputChannel: { info: vi.fn(), warn: vi.fn() } },
}));

const wizardTabs = new Set<{ getId(): string }>();

vi.mock('../panels/DataModelingWizardTab', () => ({
    DataModelingWizardTab: {
        findById: vi.fn((tabId: string) => Array.from(wizardTabs).find((tab) => tab.getId() === tabId)),
    },
}));

import { captureRegisteredTool } from './queryEditorToolTestUtils';
import {
    findDataModelingWizardTab,
    formatRecommendationForChat,
    registerReportPartitionKeyRecommendationTool,
} from './reportPartitionKeyRecommendationTool';

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

describe('findDataModelingWizardTab', () => {
    it('selects the wizard that originated the recommendation when multiple tabs are open', () => {
        const firstTab = { getId: () => 'wizard-a' };
        const secondTab = { getId: () => 'wizard-b' };
        wizardTabs.add(firstTab);
        wizardTabs.add(secondTab);

        expect(findDataModelingWizardTab('wizard-a')).toBe(firstTab);
        expect(findDataModelingWizardTab('wizard-b')).toBe(secondTab);
        expect(findDataModelingWizardTab('wizard-missing')).toBeUndefined();

        wizardTabs.clear();
    });
});

describe('cosmosdb_reportPartitionKeyRecommendation', () => {
    afterEach(() => wizardTabs.clear());

    it('delivers a recommendation only to the wizard that originated the request', async () => {
        const firstTab = { getId: () => '1c70d73d-9d5d-415a-93f3-630d3e581d63', reportRecommendation: vi.fn() };
        const secondTab = { getId: () => 'b85e997b-e945-46e2-a02a-4c763b251b18', reportRecommendation: vi.fn() };
        wizardTabs.add(firstTab);
        wizardTabs.add(secondTab);

        const tool = captureRegisteredTool(registerReportPartitionKeyRecommendationTool);
        await tool.invoke(
            {
                input: {
                    wizardTabId: firstTab.getId(),
                    summary: 'Use customerId.',
                    containers: [
                        {
                            entity: 'Orders',
                            partitionKey: '/customerId',
                            rationale: 'Customer operations are co-located.',
                        },
                    ],
                },
            },
            {} as never,
        );

        expect(firstTab.reportRecommendation).toHaveBeenCalledOnce();
        expect(secondTab.reportRecommendation).not.toHaveBeenCalled();
    });
});
