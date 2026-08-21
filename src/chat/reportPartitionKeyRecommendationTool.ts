/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
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
    'strategy. This is the only way the wizard receives the recommendation.';

/** Input for the report tool — the structured recommendation. */
export type ReportPartitionKeyRecommendationInput = PartitionKeyRecommendation;

/**
 * Tool input schema. Keep in sync with the `inputSchema` in package.json.
 */
export const REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_INPUT_SCHEMA = {
    type: 'object' as const,
    properties: {
        summary: {
            type: 'string',
            description: 'One or two sentences summarizing the recommendation across all containers.',
        },
        containers: {
            type: 'array',
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
                                    description: 'Best-practice score 0–100 (higher is better).',
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
                                    description: 'Relative skew 0 (best) – 100 (worst) for the bar width.',
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
                                            description: 'Rough RU cost, e.g. "3 RU" or "50–100× RU".',
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
                },
                required: ['entity', 'partitionKey', 'rationale'],
                additionalProperties: { not: {} },
            },
        },
    },
    required: ['summary', 'containers'],
    additionalProperties: { not: {} },
};

/**
 * Registers the cosmosdb_reportPartitionKeyRecommendation tool with the VS Code
 * Language Model API. The tool forwards the structured recommendation to the
 * open Data Modeling wizard's Result page over its event stream.
 */
export function registerReportPartitionKeyRecommendationTool(context: vscode.ExtensionContext): void {
    const tool = vscode.lm.registerTool<ReportPartitionKeyRecommendationInput>(
        REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME,
        {
            prepareInvocation(
                _options: vscode.LanguageModelToolInvocationPrepareOptions<ReportPartitionKeyRecommendationInput>,
                _token: vscode.CancellationToken,
            ): vscode.PreparedToolInvocation {
                return {
                    invocationMessage: l10n.t('Sending the partition-key recommendation to the Data Modeling wizard…'),
                };
            },

            async invoke(
                options: vscode.LanguageModelToolInvocationOptions<ReportPartitionKeyRecommendationInput>,
                _token: vscode.CancellationToken,
            ): Promise<vscode.LanguageModelToolResult> {
                // Troubleshooting: confirm the LLM actually invoked the tool and inspect the raw input.
                console.log(`[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] invoke() called`);
                console.log(
                    `[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] raw input:`,
                    JSON.stringify(options.input, null, 2),
                );
                ext.outputChannel.info(`[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] invoke() called`);

                const toolResult = await callWithTelemetryAndErrorHandling(
                    'cosmosDB.ai.tool.reportPartitionKeyRecommendation',
                    async (actionContext) => {
                        actionContext.errorHandling.suppressDisplay = true;
                        actionContext.telemetry.properties.outcome = 'error';

                        const parsed = PartitionKeyRecommendationSchema.safeParse(options.input);
                        if (!parsed.success) {
                            actionContext.telemetry.properties.outcome = 'invalidInput';
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

                        const openTabCount = DataModelingWizardTab.openTabs.size;
                        const tab = DataModelingWizardTab.getActiveTab();
                        console.log(
                            `[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] open wizard tabs: ${openTabCount}, ` +
                                `active tab found: ${!!tab}`,
                        );
                        if (!tab) {
                            actionContext.telemetry.properties.outcome = 'noWizard';
                            console.warn(
                                `[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] No open Data Modeling wizard to receive the recommendation.`,
                            );
                            ext.outputChannel.warn(
                                '[Report Partition Key Tool] No open Data Modeling wizard to receive the recommendation.',
                            );
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    l10n.t('No Data Modeling wizard is open to display the recommendation.'),
                                ),
                            ]);
                        }

                        tab.reportRecommendation(parsed.data);
                        console.log(
                            `[${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME}] reportRecommendation() called with ` +
                                `${parsed.data.containers.length} container(s); event emitted to sink.`,
                        );

                        actionContext.telemetry.properties.outcome = 'success';
                        actionContext.telemetry.measurements.containerCount = parsed.data.containers.length;
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
