/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';
import { ext } from '../extensionVariables';
import { DataModelingWizardDrawerTab } from '../panels/DataModelingWizardDrawerTab';
import { DataModelingWizardTab } from '../panels/DataModelingWizardTab';
import {
    type PartitionKeyRecommendation,
    PartitionKeyRecommendationSchema,
} from '../panels/trpc/routers/dataModelingEventsRouter';

/**
 * Tool name for the report-partition-key-recommendation tool.
 * Keep in sync with the `name` in package.json `contributes.languageModelTools`.
 */
export const REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME = 'cosmosdb_reportPartitionKeyRecommendation';

/**
 * Tool description. Keep in sync with the `modelDescription` in package.json.
 */
export const REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_DESCRIPTION =
    'Displays a partition-key recommendation on the Result page of the open Cosmos DB Data Modeling wizard. ' +
    'Call this once after analyzing the data model the wizard sent, passing a structured recommendation: an overall ' +
    'summary and, for each container, the recommended partition key with a short rationale, scored candidate keys ' +
    '(with per-rule assessments), a hot-partition risk comparison, a query-routing analysis, and a document-id ' +
    'strategy. Include relevant absolute-rule guardrails as the final section. ' +
    'If required information or guidance is missing, or you are unsure which recommendation is supported, ' +
    'send only wizardTabId and error explaining the blocker instead of inventing a recommendation. ' +
    'Pass the wizardTabId supplied with the analysis request so the recommendation reaches its originating wizard.';

const ReportPartitionKeyRecommendationSchema = z.union([
    PartitionKeyRecommendationSchema.extend({
        wizardTabId: z.string().uuid(),
        containers: PartitionKeyRecommendationSchema.shape.containers.min(1),
        error: z.never().optional(),
    }),
    z.object({ wizardTabId: z.string().uuid(), error: z.string().trim().min(1) }).strict(),
]);

/** Input for the report tool — either a recommendation or an explicit failure, scoped to its originating wizard. */
export type ReportPartitionKeyRecommendationInput = z.infer<typeof ReportPartitionKeyRecommendationSchema>;

/** Finds the wizard that originated a recommendation request, if it is still open. */
export function findDataModelingWizardTab(
    wizardTabId: string,
): DataModelingWizardTab | DataModelingWizardDrawerTab | undefined {
    return DataModelingWizardTab.findById(wizardTabId) ?? DataModelingWizardDrawerTab.findById(wizardTabId);
}

function findOriginatingWizard(input: unknown): DataModelingWizardTab | DataModelingWizardDrawerTab | undefined {
    if (
        typeof input !== 'object' ||
        input === null ||
        !('wizardTabId' in input) ||
        typeof input.wizardTabId !== 'string'
    ) {
        return undefined;
    }

    return findDataModelingWizardTab(input.wizardTabId);
}

/**
 * Formats a complete recommendation for the Chat fallback when its originating
 * Data Modeling wizard has been closed before the tool is invoked.
 */
export function formatRecommendationForChat(recommendation: PartitionKeyRecommendation): string {
    const sections = [
        l10n.t('The Data Modeling wizard is no longer open. Show this complete recommendation in the chat response.'),
        `## ${l10n.t('Summary')}\n${recommendation.summary}`,
    ];

    for (const container of recommendation.containers) {
        const lines = [
            `## ${container.entity}`,
            `${l10n.t('Recommended partition key:')} \`${container.partitionKey}\``,
            `${l10n.t('Rationale:')} ${container.rationale}`,
        ];

        if (container.candidates?.length) {
            lines.push(
                `### ${l10n.t('Candidate keys')}`,
                ...container.candidates.flatMap((candidate) => [
                    `- \`${candidate.partitionKey}\` — ${candidate.verdict} (${candidate.score}/100)`,
                    ...candidate.assessments.map(
                        (assessment) => `  - ${assessment.label} (${assessment.status}): ${assessment.detail}`,
                    ),
                ]),
            );
        }

        if (container.hotPartitionRisk?.length) {
            lines.push(
                `### ${l10n.t('Hot-partition risk')}`,
                ...container.hotPartitionRisk.map((risk) => `- \`${risk.partitionKey}\`: ${risk.risk} (${risk.pct}%)`),
            );
        }

        if (container.queryRouting) {
            lines.push(
                `### ${l10n.t('Query routing')}`,
                container.queryRouting.headline,
                ...container.queryRouting.routes.map(
                    (route) =>
                        `- ${route.pattern}: ${route.routing} partition; ${route.filters}; ${route.qps}; ${route.estCost}`,
                ),
                container.queryRouting.analysis,
            );
        }

        if (container.documentIdStrategy) {
            lines.push(
                `### ${l10n.t('Document ID strategy')} (${container.documentIdStrategy.tag})`,
                container.documentIdStrategy.recommendation,
            );
        }

        if (container.guardrails?.length) {
            lines.push(
                `### ${l10n.t('Absolute rules (guardrails)')}`,
                ...container.guardrails.map(({ rule, detail }) => `- ${rule}: ${detail}`),
            );
        }

        sections.push(lines.join('\n'));
    }

    return sections.join('\n\n');
}

/**
 * Tool input schema. Keep in sync with the `inputSchema` in package.json.
 */
export const REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_INPUT_SCHEMA = {
    type: 'object' as const,
    properties: {
        wizardTabId: {
            type: 'string',
            description: 'The wizardTabId included in the partition-key analysis request.',
        },
        error: {
            type: 'string',
            minLength: 1,
            pattern: '\\S',
            description:
                'Why a recommendation cannot be provided and what information or guidance is needed. Send with wizardTabId only; omit summary and containers.',
        },
        summary: {
            type: 'string',
            description: 'One or two sentences summarizing the recommendation across all containers.',
        },
        containers: {
            type: 'array',
            minItems: 1,
            description: 'Per-container recommendation.',
            items: {
                type: 'object',
                properties: {
                    entity: { type: 'string', description: 'Name of the container this recommendation applies to.' },
                    partitionKey: {
                        type: 'string',
                        description:
                            'Recommended partition-key path, e.g. "/customerId" or a hierarchical "/tenantId, /userId".',
                    },
                    rationale: {
                        type: 'string',
                        description: 'Why this key is recommended (short text; may name the workload pattern).',
                    },
                    candidates: {
                        type: 'array',
                        description: 'Scored partition-key candidates, ordered best first.',
                        items: {
                            type: 'object',
                            properties: {
                                partitionKey: { type: 'string', description: 'Candidate partition-key path.' },
                                verdict: {
                                    type: 'string',
                                    enum: ['recommended', 'alternative', 'avoid'],
                                    description: 'Ranking verdict for this candidate.',
                                },
                                score: {
                                    type: 'number',
                                    description: 'Best-practice score 0-100 (higher is better).',
                                },
                                assessments: {
                                    type: 'array',
                                    description: 'Per-rule breakdown explaining the score.',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            label: {
                                                type: 'string',
                                                description: 'Short rule name, e.g. "Query match", "Cardinality".',
                                            },
                                            status: {
                                                type: 'string',
                                                enum: ['pass', 'warn', 'fail', 'info'],
                                                description: 'How the candidate fares on this rule.',
                                            },
                                            detail: { type: 'string', description: 'One-line explanation.' },
                                        },
                                        required: ['label', 'status', 'detail'],
                                        additionalProperties: { not: {} },
                                    },
                                },
                            },
                            required: ['partitionKey', 'verdict', 'score', 'assessments'],
                            additionalProperties: { not: {} },
                        },
                    },
                    hotPartitionRisk: {
                        type: 'array',
                        description: 'Hot-partition risk comparison across candidates.',
                        items: {
                            type: 'object',
                            properties: {
                                partitionKey: { type: 'string' },
                                risk: {
                                    type: 'string',
                                    enum: ['low', 'medium', 'high', 'severe'],
                                    description: 'Risk band for this candidate.',
                                },
                                pct: {
                                    type: 'number',
                                    description: 'Relative skew 0 (best) - 100 (worst) for the bar width.',
                                },
                            },
                            required: ['partitionKey', 'risk', 'pct'],
                            additionalProperties: { not: {} },
                        },
                    },
                    queryRouting: {
                        type: 'object',
                        description: 'How the container reads route under the recommended key.',
                        properties: {
                            headline: {
                                type: 'string',
                                description: 'e.g. "1/3 reads single-partition with /conversationId".',
                            },
                            routes: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        pattern: { type: 'string', description: 'Read pattern description.' },
                                        filters: { type: 'string', description: 'Attribute(s) it filters on.' },
                                        qps: { type: 'string', description: 'Peak QPS as displayed, e.g. "200/s".' },
                                        routing: {
                                            type: 'string',
                                            enum: ['single', 'cross'],
                                            description: 'Single-partition or cross-partition.',
                                        },
                                        estCost: {
                                            type: 'string',
                                            description: 'Rough RU cost, e.g. "3 RU" or "50-100x RU".',
                                        },
                                    },
                                    required: ['pattern', 'filters', 'qps', 'routing', 'estCost'],
                                    additionalProperties: { not: {} },
                                },
                            },
                            analysis: {
                                type: 'string',
                                description: 'Analysis of cross-partition reads and how to resolve them.',
                            },
                        },
                        required: ['headline', 'routes', 'analysis'],
                        additionalProperties: { not: {} },
                    },
                    documentIdStrategy: {
                        type: 'object',
                        description: 'Document-id strategy guidance.',
                        properties: {
                            tag: {
                                type: 'string',
                                description: 'Short access-pattern tag, e.g. "Query-driven access".',
                            },
                            recommendation: { type: 'string', description: 'The recommendation text.' },
                        },
                        required: ['tag', 'recommendation'],
                        additionalProperties: { not: {} },
                    },
                    guardrails: {
                        type: 'array',
                        description:
                            'Relevant absolute constraints and evidence of compliance for the recommended key, displayed as the last section. Never claim compliance without evidence.',
                        items: {
                            type: 'object',
                            properties: {
                                rule: { type: 'string', minLength: 1, description: 'Name of the absolute rule.' },
                                detail: {
                                    type: 'string',
                                    minLength: 1,
                                    description:
                                        'Applicable limit, scope, supporting evidence, and any rejected alternative.',
                                },
                            },
                            required: ['rule', 'detail'],
                            additionalProperties: { not: {} },
                        },
                    },
                },
                required: ['entity', 'partitionKey', 'rationale'],
                additionalProperties: { not: {} },
            },
        },
    },
    required: ['wizardTabId'],
    oneOf: [
        { required: ['summary', 'containers'], not: { required: ['error'] } },
        { required: ['error'], not: { anyOf: [{ required: ['summary'] }, { required: ['containers'] }] } },
    ],
    additionalProperties: { not: {} },
};

/**
 * Registers the cosmosdb_reportPartitionKeyRecommendation tool with the VS Code
 * Language Model API. The tool forwards the structured recommendation to the
 * open Data Modeling wizard's Result page over its event stream, or returns it
 * to Chat when the wizard has been closed. Explicit failures use the wizard's error event instead.
 */
export function registerReportPartitionKeyRecommendationTool(context: vscode.ExtensionContext): void {
    const tool = vscode.lm.registerTool<ReportPartitionKeyRecommendationInput>(
        REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME,
        {
            prepareInvocation(
                options: vscode.LanguageModelToolInvocationPrepareOptions<ReportPartitionKeyRecommendationInput>,
                _token: vscode.CancellationToken,
            ): vscode.PreparedToolInvocation {
                return {
                    invocationMessage:
                        options.input.error !== undefined
                            ? l10n.t('Reporting that a recommendation could not be provided…')
                            : l10n.t('Sending the partition-key recommendation to the Data Modeling wizard…'),
                };
            },

            async invoke(
                options: vscode.LanguageModelToolInvocationOptions<ReportPartitionKeyRecommendationInput>,
                _token: vscode.CancellationToken,
            ): Promise<vscode.LanguageModelToolResult> {
                console.log(`[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] invoke() called`);
                ext.outputChannel.info(`[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] invoke() called`);

                const toolResult = await callWithTelemetryAndErrorHandling(
                    'cosmosDB.ai.tool.reportPartitionKeyRecommendation',
                    async (actionContext) => {
                        actionContext.errorHandling.suppressDisplay = true;
                        actionContext.telemetry.properties.outcome = 'error';

                        const parsed = ReportPartitionKeyRecommendationSchema.safeParse(options.input);
                        if (!parsed.success) {
                            actionContext.telemetry.properties.outcome = 'invalidInput';
                            findOriginatingWizard(options.input)?.reportRecommendationError(
                                l10n.t('The recommendation was not in the expected shape and could not be shown.'),
                            );
                            console.error(
                                `[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] input failed schema validation:`,
                                parsed.error.issues,
                            );
                            ext.outputChannel.warn(
                                `[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] input failed schema validation: ` +
                                    JSON.stringify(parsed.error.issues),
                            );
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    l10n.t('The recommendation was not in the expected shape and could not be shown.'),
                                ),
                            ]);
                        }

                        if (parsed.data.error !== undefined) {
                            const { wizardTabId, error } = parsed.data;
                            actionContext.valuesToMask.push(error);
                            actionContext.telemetry.properties.outcome = 'recommendationFailed';
                            const tab = findDataModelingWizardTab(wizardTabId);
                            tab?.reportRecommendationError(error);
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    tab
                                        ? l10n.t('Recommendation failed: {reason}', { reason: error })
                                        : l10n.t(
                                              'The Data Modeling wizard is no longer open. Recommendation failed: {reason}',
                                              { reason: error },
                                          ),
                                ),
                            ]);
                        }

                        const { wizardTabId, ...recommendation } = parsed.data;
                        const tab = findDataModelingWizardTab(wizardTabId);
                        console.log(
                            `[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] originating wizard tab found: ${!!tab}`,
                        );
                        ext.outputChannel.info(
                            `[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] invoke: originating wizard tab found=${!!tab}, ` +
                                `container(s)=${recommendation.containers.length}.`,
                        );
                        if (!tab) {
                            actionContext.telemetry.properties.outcome = 'noWizard';
                            console.warn(
                                `[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] No open Data Modeling wizard to receive the recommendation.`,
                            );
                            ext.outputChannel.warn(
                                '[Report Partition Key Tool] No open Data Modeling wizard to receive the recommendation. ' +
                                    'Returning the recommendation to Chat instead.',
                            );
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(formatRecommendationForChat(recommendation)),
                            ]);
                        }

                        tab.reportRecommendation(recommendation);
                        console.log(
                            `[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] reportRecommendation() called with ` +
                                `${recommendation.containers.length} container(s); event emitted to hub.`,
                        );

                        actionContext.telemetry.properties.outcome = 'success';
                        actionContext.telemetry.measurements.containerCount = recommendation.containers.length;
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t('The recommendation is now shown on the Data Modeling wizard Result page.'),
                            ),
                        ]);
                    },
                );

                return (
                    toolResult ??
                    new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(l10n.t('Could not display the recommendation.')),
                    ])
                );
            },
        },
    );

    context.subscriptions.push(tool);
}
