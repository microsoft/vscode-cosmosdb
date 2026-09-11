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
const wizardDrawerTabs = new Set<{ getId(): string }>();

vi.mock('../panels/DataModelingWizardTab', () => ({
    DataModelingWizardTab: {
        findById: vi.fn((tabId: string) => Array.from(wizardTabs).find((tab) => tab.getId() === tabId)),
    },
}));

vi.mock('../panels/DataModelingWizardDrawerTab', () => ({
    DataModelingWizardDrawerTab: {
        findById: vi.fn((tabId: string) => Array.from(wizardDrawerTabs).find((tab) => tab.getId() === tabId)),
    },
}));

import packageJson from '../../package.json';
import { captureRegisteredTool } from './queryEditorToolTestUtils';
import {
    findDataModelingWizardTab,
    formatRecommendationForChat,
    registerReportPartitionKeyRecommendationTool,
    REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_INPUT_SCHEMA,
    REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_DESCRIPTION,
} from './reportPartitionKeyRecommendationTool';

const scoredCandidate = {
    partitionKey: '/customerId',
    verdict: 'recommended',
    score: 95,
    assessments: [{ label: 'Query alignment', status: 'pass', detail: 'Customer reads are targeted.' }],
};

it('keeps the registered tool schema and description in sync with the manifest', () => {
    const manifest = packageJson.contributes.languageModelTools.find(
        (tool) => tool.name === 'cosmosdb_reportPartitionKeyRecommendation',
    );
    expect(manifest?.inputSchema).toEqual(REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_INPUT_SCHEMA);
    expect(manifest?.modelDescription).toBe(REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_DESCRIPTION);
});

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
        expect(text).toContain('`/customerId` — recommended (95/100)');
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

    it('selects the originating drawer when the recommendation request came from a drawer wizard', () => {
        const drawerTab = { getId: () => 'wizard-drawer' };
        wizardDrawerTabs.add(drawerTab);

        expect(findDataModelingWizardTab('wizard-drawer')).toBe(drawerTab);

        wizardDrawerTabs.clear();
    });
});

describe('cosmosdb_reportPartitionKeyRecommendation', () => {
    afterEach(() => {
        wizardTabs.clear();
        wizardDrawerTabs.clear();
    });

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
                            candidates: [scoredCandidate],
                        },
                    ],
                },
            },
            {} as never,
        );

        expect(firstTab.reportRecommendation).toHaveBeenCalledOnce();
        expect(firstTab.reportRecommendation).toHaveBeenCalledWith({
            summary: 'Use customerId.',
            containers: [
                {
                    entity: 'Orders',
                    partitionKey: '/customerId',
                    rationale: 'Customer operations are co-located.',
                    candidates: [scoredCandidate],
                },
            ],
        });
        expect(secondTab.reportRecommendation).not.toHaveBeenCalled();
    });

    it('delivers a recommendation to the drawer that originated the request', async () => {
        const drawerTab = { getId: () => 'd7b9f7d4-84dc-4c95-8f7a-003d7f43be31', reportRecommendation: vi.fn() };
        wizardDrawerTabs.add(drawerTab);

        const tool = captureRegisteredTool(registerReportPartitionKeyRecommendationTool);
        await tool.invoke(
            {
                input: {
                    wizardTabId: drawerTab.getId(),
                    summary: 'Use customerId.',
                    containers: [
                        {
                            entity: 'Orders',
                            partitionKey: '/customerId',
                            rationale: 'Customer operations are co-located.',
                            candidates: [scoredCandidate],
                        },
                    ],
                },
            },
            {} as never,
        );

        expect(drawerTab.reportRecommendation).toHaveBeenCalledOnce();
    });

    it('preserves model-supplied scores, verdicts, candidate order, and container analysis', async () => {
        const tab = {
            getId: () => '1c70d73d-9d5d-415a-93f3-630d3e581d63',
            reportRecommendation: vi.fn(),
        };
        wizardTabs.add(tab);
        const recommendation = {
            summary: 'Favor the supplied workload analysis.',
            containers: [
                {
                    entity: 'Orders',
                    partitionKey: '/customerId',
                    rationale: 'Customer operations are co-located.',
                    candidates: [
                        { ...scoredCandidate, score: 89.25 },
                        { ...scoredCandidate, partitionKey: '/id', verdict: 'alternative', score: 92.5 },
                        { ...scoredCandidate, partitionKey: '/status', verdict: 'avoid', score: 20 },
                    ],
                    queryRouting: {
                        headline: 'Customer reads are single-partition.',
                        routes: [],
                        analysis: 'Retain customerId in read predicates.',
                    },
                    documentIdStrategy: { tag: 'Order identifier', recommendation: 'Use the order identifier as id.' },
                    alternatives: [{ partitionKey: '/id', reason: 'Unique order identifiers.' }],
                    avoid: [{ partitionKey: '/status', reason: 'Too few distinct values.' }],
                },
            ],
        };
        const tool = captureRegisteredTool(registerReportPartitionKeyRecommendationTool);
        await tool.invoke({ input: { wizardTabId: tab.getId(), ...recommendation } }, {} as never);

        expect(tab.reportRecommendation).toHaveBeenCalledWith(recommendation);
    });

    it('accepts a simple recommendation without candidate scores', async () => {
        const tab = {
            getId: () => '1c70d73d-9d5d-415a-93f3-630d3e581d63',
            reportRecommendation: vi.fn(),
        };
        wizardTabs.add(tab);
        const recommendation = {
            summary: 'Use customerId.',
            containers: [{ entity: 'Orders', partitionKey: '/customerId', rationale: 'Customer-scoped workload.' }],
        };
        const tool = captureRegisteredTool(registerReportPartitionKeyRecommendationTool);
        await tool.invoke({ input: { wizardTabId: tab.getId(), ...recommendation } }, {} as never);

        expect(tab.reportRecommendation).toHaveBeenCalledWith(recommendation);
    });

    it.each([
        { ...scoredCandidate, score: undefined },
        { ...scoredCandidate, score: '95' },
        { ...scoredCandidate, score: Number.NaN },
        { ...scoredCandidate, verdict: undefined },
        { ...scoredCandidate, verdict: 'best' },
        { ...scoredCandidate, assessments: undefined },
        { ...scoredCandidate, assessments: [{ label: 'Query match', status: 'unknown', detail: 'Invalid status.' }] },
        {
            partitionKey: '/customerId',
            priorityScores: { read: 95, write: 80, storage: 70 },
            rationale: 'Component scores are no longer the tool contract.',
            assessments: [],
        },
    ])('rejects malformed scored candidates %j', async (candidate) => {
        const tab = {
            getId: () => '1c70d73d-9d5d-415a-93f3-630d3e581d63',
            reportRecommendation: vi.fn(),
            reportRecommendationError: vi.fn(),
        };
        wizardTabs.add(tab);
        const tool = captureRegisteredTool(registerReportPartitionKeyRecommendationTool);
        await tool.invoke(
            {
                input: {
                    wizardTabId: tab.getId(),
                    summary: '',
                    containers: [
                        {
                            entity: 'Orders',
                            partitionKey: '/customerId',
                            rationale: '',
                            candidates: [candidate],
                        },
                    ],
                },
            },
            {} as never,
        );
        expect(tab.reportRecommendation).not.toHaveBeenCalled();
        expect(tab.reportRecommendationError).toHaveBeenCalledOnce();
    });

    it('reports an invalid recommendation to the originating wizard', async () => {
        const wizardTab = {
            getId: () => '8d9c4b36-4f8d-44a4-9d86-a4811cc6ac3f',
            reportRecommendationError: vi.fn(),
        };
        wizardTabs.add(wizardTab);

        const tool = captureRegisteredTool(registerReportPartitionKeyRecommendationTool);
        await tool.invoke(
            {
                input: {
                    wizardTabId: wizardTab.getId(),
                    summary: 'Use customerId.',
                    containers: [{ entity: 'Orders', partitionKey: '/customerId' }],
                },
            },
            {} as never,
        );

        expect(wizardTab.reportRecommendationError).toHaveBeenCalledWith(
            'The recommendation was not in the expected shape and could not be shown.',
        );
    });
});
