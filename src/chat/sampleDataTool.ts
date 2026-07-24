/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getSchemaFromDocuments, type NoSQLDocument } from '@cosmosdb/schema-analyzer/json';
import { callWithTelemetryAndErrorHandling, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getCosmosClient } from '../cosmosdb/getCosmosClient';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { ext } from '../extensionVariables';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { SchemaService } from '../services/SchemaService';
import { getActiveQueryEditor, getConnectionFromQueryTab } from './chatUtils';

/**
 * The sampling query used to infer container schema.
 * Uses TOP 10 to minimize RU cost while getting enough documents for schema diversity.
 * % 2 filter is a cheap way to get non-sequential documents which can help discover more properties in some cases.
 * Orders by _ts DESC to get the most recent documents, which are more likely to reflect the current schema.
 */
const SAMPLE_QUERY = 'SELECT TOP 10 * FROM c WHERE c._ts % 2 = 0 ORDER BY c._ts DESC';

/**
 * Tool name constant for the sample data schema tool.
 */
export const SAMPLE_DATA_TOOL_NAME = 'cosmosdb_sampleContainerSchema';

/**
 * Confirmation message shown to the user before sampling the container schema.
 */
export const SAMPLE_DATA_CONFIRMATION_MESSAGE =
    'To generate an accurate query, Copilot needs to sample your container schema by reading a few documents. ' +
    'This will consume a small number of Request Units (RUs). ' +
    `Query: ${SAMPLE_QUERY}`;

/**
 * Tool description for the sample data schema tool.
 * Keep in sync with the description in package.json contributes.languageModelTools.
 */
export const SAMPLE_DATA_TOOL_DESCRIPTION =
    'Samples a few documents from the active Cosmos DB container to infer its schema (property names and types). ' +
    'Runs a cheap, read-only query. Use this when the container schema is unknown, to avoid guessing property names or ' +
    'casing. If the schema is already available (e.g. containerSchema from cosmosdb_getQueryEditorContext), you do not ' +
    'need to call this.';

/**
 * Tool input schema. No parameters are required.
 */
export const SAMPLE_DATA_TOOL_INPUT_SCHEMA = {
    type: 'object' as const,
    properties: {},
    additionalProperties: false,
};

/**
 * Result returned by the sample data tool.
 */
export interface SampleSchemaResult {
    databaseId: string;
    containerId: string;
    sampleQuery: string;
    documentCount: number;
    schema: Record<string, unknown>;
    requestCharge?: number;
}

/**
 * Executes the sample query against the given connection and returns the documents and RUs.
 */
async function fetchSampleDocuments(
    connection: NoSqlQueryConnection,
): Promise<{ documents: NoSQLDocument[]; requestCharge?: number }> {
    const client = getCosmosClient(connection);
    const container = client.database(connection.databaseId).container(connection.containerId);
    const response = await container.items
        .query<Record<string, unknown>>(SAMPLE_QUERY, {
            maxItemCount: 10,
            maxDegreeOfParallelism: 1,
            bufferItems: false,
        })
        .fetchAll();
    return {
        documents: (response.resources ?? []) as NoSQLDocument[],
        requestCharge: response.requestCharge,
    };
}

/**
 * Gets the active query editor tab, if available.
 */
function getActiveTab(): QueryEditorTab | undefined {
    const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
    if (activeQueryEditors.length === 0) {
        return undefined;
    }
    return getActiveQueryEditor(activeQueryEditors);
}

/**
 * Samples the container schema and persists it via `SchemaService` (the schema analyzer).
 *
 * Persistence is unconditional: the sampled schema is always written back to the analyzer so
 * subsequent generations can read it via `cosmosdb_getQueryEditorContext` without re-sampling.
 * The returned `SampleSchemaResult.schema` is the size-bounded version produced by
 * `SchemaService.getSimplifiedSchema`, so the LLM context stays small regardless of the raw
 * container shape. If persistence fails, we fall back to the one-shot inferred schema built from
 * the just-sampled documents.
 */
export async function sampleAndPersistContainerSchema(connection: NoSqlQueryConnection): Promise<SampleSchemaResult> {
    const { documents, requestCharge } = await fetchSampleDocuments(connection);
    const result = {
        databaseId: connection.databaseId,
        containerId: connection.containerId,
        sampleQuery: SAMPLE_QUERY,
        documentCount: documents.length,
        schema: {},
        requestCharge,
    };

    if (documents.length === 0) {
        return result;
    }

    const isSchemaBasedOnQueries = vscode.workspace
        .getConfiguration('cosmosDB.queryEditor')
        .get<boolean>('generateSchemaBasedOnQueries', false);

    result.schema = getSchemaFromDocuments(documents) as Record<string, unknown>;

    // Always persist the sampled schema into the schema analyzer (`SchemaService`) — even when the
    // "generate schema based on queries" setting is off — so later query generation can read it back
    // via `cosmosdb_getQueryEditorContext` instead of re-sampling (which costs RUs and re-prompts the
    // user). Sampling only runs after explicit consent, and only the schema STRUCTURE is stored, never
    // raw document values. The setting still governs the running-document-count bookkeeping.
    try {
        await SchemaService.getInstance().mergeDocumentsIntoSchema(connection, documents, {
            source: 'aiSample',
            suppressNotification: true,
            confirmAll: true,
            updateFromQueriesEnabled: isSchemaBasedOnQueries,
        });
        const simplified = await SchemaService.getInstance().getSimplifiedSchema(connection);
        if (simplified) {
            result.schema = simplified.schema as Record<string, unknown>;
        }
    } catch (saveError) {
        ext.outputChannel.warn(
            l10n.t('[Sample Schema Tool] Failed to persist schema: {0}', parseError(saveError).message),
        );
    }

    return result;
}

/**
 * Registers the cosmosdb_sampleContainerSchema tool with the VS Code Language Model API.
 */
export function registerSampleDataTool(context: vscode.ExtensionContext): void {
    const tool = vscode.lm.registerTool(SAMPLE_DATA_TOOL_NAME, {
        prepareInvocation(
            _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
            _token: vscode.CancellationToken,
        ): vscode.PreparedToolInvocation {
            return {
                invocationMessage: l10n.t('Sampling container schema…'),
                confirmationMessages: {
                    title: l10n.t('Allow Copilot to sample your container schema to generate an accurate query?'),
                    message: new vscode.MarkdownString(
                        l10n.t(
                            'To generate an accurate query, Copilot needs to sample your container schema by reading a few documents. This will consume a small number of Request Units (RUs).',
                        ) +
                            '\n\n' +
                            '**' +
                            l10n.t('Query:') +
                            `** \`${SAMPLE_QUERY}\``,
                    ),
                },
            };
        },

        async invoke(
            _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
            token: vscode.CancellationToken,
        ): Promise<vscode.LanguageModelToolResult> {
            const toolResult = await callWithTelemetryAndErrorHandling(
                'cosmosDB.ai.tool.sampleContainerSchema',
                async (actionContext) => {
                    // The tool returns its own LanguageModelToolResult on every path, so suppress the
                    // default error UI; `outcome` starts pessimistic and is narrowed as we progress.
                    actionContext.errorHandling.suppressDisplay = true;
                    actionContext.telemetry.properties.outcome = 'error';

                    const tab = getActiveTab();
                    const connection = tab ? getConnectionFromQueryTab(tab) : undefined;
                    if (connection) {
                        actionContext.valuesToMask.push(connection.databaseId, connection.containerId);
                    }
                    if (!connection) {
                        actionContext.telemetry.properties.outcome = 'noEditor';
                        ext.outputChannel.warn(l10n.t('[Sample Schema Tool] No active Cosmos DB connection.'));
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t(
                                    'No active Cosmos DB connection. Please open a query editor and connect to a container first.',
                                ),
                            ),
                        ]);
                    }

                    if (token.isCancellationRequested) {
                        actionContext.telemetry.properties.outcome = 'cancelled';
                        ext.outputChannel.info(l10n.t('[Sample Schema Tool] Operation cancelled by user.'));
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(l10n.t('Operation cancelled.')),
                        ]);
                    }

                    try {
                        const sample = await sampleAndPersistContainerSchema(connection);
                        actionContext.telemetry.properties.outcome =
                            sample.documentCount > 0 ? 'success' : 'noDocuments';
                        actionContext.telemetry.measurements.documentCount = sample.documentCount;
                        if (typeof sample.requestCharge === 'number') {
                            actionContext.telemetry.measurements.requestCharge = sample.requestCharge;
                        }
                        const properties = (sample.schema as { properties?: Record<string, unknown> } | undefined)?.properties;
                        actionContext.telemetry.measurements.schemaPropertyCount = Object.keys(properties ?? sample.schema ?? {}).length;
                        ext.outputChannel.info(
                            l10n.t(
                                '[Sample Schema Tool] Sampled {0} documents from {1}/{2}, cost: {3} RUs',
                                sample.documentCount,
                                sample.databaseId,
                                sample.containerId,
                                (sample.requestCharge ?? 0).toFixed(2),
                            ),
                        );

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(JSON.stringify(sample, null, 2)),
                        ]);
                    } catch (error) {
                        actionContext.telemetry.properties.outcome = 'error';
                        const message = parseError(error).message;
                        actionContext.valuesToMask.push(message);
                        ext.outputChannel.error(l10n.t('[Sample Schema Tool] Failed to sample data: {0}', message));
                        const baseMessage = l10n.t(
                            'Unable to sample the container schema. Query generation will continue without schema information, which may affect accuracy.',
                        );
                        void vscode.window.showErrorMessage(
                            message ? `${baseMessage} ${l10n.t('Error: {0}', message)}` : baseMessage,
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(l10n.t('Failed to sample data: {0}', message)),
                        ]);
                    }
                },
            );

            return (
                toolResult ??
                new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(l10n.t('Failed to sample data.'))])
            );
        },
    });

    context.subscriptions.push(tool);
}
