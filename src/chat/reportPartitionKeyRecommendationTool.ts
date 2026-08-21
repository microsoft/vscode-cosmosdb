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
    'summary and, for each container, the recommended partition key with a short rationale plus optional alternatives ' +
    'and keys to avoid. This is the only way the wizard receives the recommendation.';

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
                    rationale: { type: 'string', description: 'Why this key is recommended (short text).' },
                    alternatives: {
                        type: 'array',
                        description: 'Viable alternative keys, each with a short note.',
                        items: {
                            type: 'object',
                            properties: {
                                partitionKey: { type: 'string' },
                                reason: { type: 'string' },
                            },
                            required: ['partitionKey', 'reason'],
                            additionalProperties: { not: {} },
                        },
                    },
                    avoid: {
                        type: 'array',
                        description: 'Keys to avoid, each with the reason it is a poor fit.',
                        items: {
                            type: 'object',
                            properties: {
                                partitionKey: { type: 'string' },
                                reason: { type: 'string' },
                            },
                            required: ['partitionKey', 'reason'],
                            additionalProperties: { not: {} },
                        },
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
                const toolResult = await callWithTelemetryAndErrorHandling(
                    'cosmosDB.ai.tool.reportPartitionKeyRecommendation',
                    async (actionContext) => {
                        actionContext.errorHandling.suppressDisplay = true;
                        actionContext.telemetry.properties.outcome = 'error';

                        const parsed = PartitionKeyRecommendationSchema.safeParse(options.input);
                        if (!parsed.success) {
                            actionContext.telemetry.properties.outcome = 'invalidInput';
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    l10n.t('The recommendation was not in the expected shape and could not be shown.'),
                                ),
                            ]);
                        }

                        const tab = DataModelingWizardTab.getActiveTab();
                        if (!tab) {
                            actionContext.telemetry.properties.outcome = 'noWizard';
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
