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
import { stripSchemaStatistics } from '../services/schemaStatistics';
import { getConnectionFromQueryTab } from './chatUtils';
import { getContainerSampleContext, takeContainerSampleContext } from './containerSampleContext';

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
    'Samples a few documents from a Cosmos DB container to infer its schema (property names and types). ' +
    'Runs a cheap, read-only query. Use this when the container schema is unknown, to avoid guessing property names or ' +
    'casing. Pass the sampleContextId returned by cosmosdb_getQueryEditorContext so the confirmed container is the one ' +
    'sampled even if the active editor changes. If the schema is already available (e.g. containerSchema from ' +
    'cosmosdb_getQueryEditorContext), you do not need to call this.';

/** Input for the sample data schema tool. */
interface SampleContainerSchemaInput {
    /** The sampleContextId returned by cosmosdb_getQueryEditorContext. */
    sampleContextId: string;
}

/**
 * Tool input schema. `sampleContextId` is required.
 * Keep in sync with the `inputSchema` in package.json `contributes.languageModelTools`.
 */
export const SAMPLE_DATA_TOOL_INPUT_SCHEMA = {
    type: 'object' as const,
    properties: {
        sampleContextId: {
            type: 'string',
            description: 'The sampleContextId returned by cosmosdb_getQueryEditorContext.',
        },
    },
    required: ['sampleContextId'],
    additionalProperties: { not: {} },
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
 *
 * `token` cancels the in-flight Cosmos request: it is bridged to an `AbortController` so a cancelled
 * tool invocation stops reading documents (and consuming RUs) instead of running to completion.
 */
async function fetchSampleDocuments(
    connection: NoSqlQueryConnection,
    token?: vscode.CancellationToken,
): Promise<{ documents: NoSQLDocument[]; requestCharge?: number }> {
    const abortController = new AbortController();
    if (token?.isCancellationRequested) {
        abortController.abort();
    }
    const cancellationSubscription = token?.onCancellationRequested(() => abortController.abort());
    try {
        const client = getCosmosClient(connection);
        const container = client.database(connection.databaseId).container(connection.containerId);
        const response = await container.items
            .query<Record<string, unknown>>(SAMPLE_QUERY, {
                maxItemCount: 10,
                maxDegreeOfParallelism: 1,
                bufferItems: false,
                abortSignal: abortController.signal,
            })
            .fetchAll();
        return {
            documents: response.resources ?? [],
            requestCharge: response.requestCharge,
        };
    } finally {
        cancellationSubscription?.dispose();
    }
}

/**
 * Finds an open Query Editor tab by its stable id, or `undefined` when it has since been closed.
 */
function findTabById(tabId: string): QueryEditorTab | undefined {
    for (const tab of QueryEditorTab.openTabs) {
        if (tab.getId() === tabId) {
            return tab;
        }
    }
    return undefined;
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
export async function sampleAndPersistContainerSchema(
    connection: NoSqlQueryConnection,
    token?: vscode.CancellationToken,
): Promise<SampleSchemaResult> {
    const { documents, requestCharge } = await fetchSampleDocuments(connection, token);
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

    // Structure only — stripped of value-derived statistics (`x-minValue`/`x-maxValue`, string
    // lengths, etc.) so no actual document values reach the model on the persistence-failure fallback
    // path below, where this raw inferred schema is serialized directly instead of the simplified one.
    result.schema = stripSchemaStatistics(getSchemaFromDocuments(documents));

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
            result.schema = simplified.schema;
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
    const tool = vscode.lm.registerTool<SampleContainerSchemaInput>(SAMPLE_DATA_TOOL_NAME, {
        prepareInvocation(
            options: vscode.LanguageModelToolInvocationPrepareOptions<SampleContainerSchemaInput>,
            _token: vscode.CancellationToken,
        ): vscode.PreparedToolInvocation {
            const sampleContext = options.input?.sampleContextId
                ? getContainerSampleContext(options.input.sampleContextId)
                : undefined;

            const message = new vscode.MarkdownString(
                l10n.t(
                    'To generate an accurate query, Copilot needs to sample your container schema by reading a few documents. This will consume a small number of Request Units (RUs).',
                ),
            );
            if (sampleContext) {
                message.appendMarkdown('\n\n**' + l10n.t('Database:') + `** ${sampleContext.databaseId}`);
                message.appendMarkdown('\n\n**' + l10n.t('Container:') + `** ${sampleContext.containerId}`);
            }
            message.appendMarkdown('\n\n**' + l10n.t('Query:') + `** \`${SAMPLE_QUERY}\``);

            return {
                invocationMessage: l10n.t('Sampling container schema…'),
                confirmationMessages: {
                    title: l10n.t('Allow Copilot to sample your container schema to generate an accurate query?'),
                    message,
                },
            };
        },

        async invoke(
            options: vscode.LanguageModelToolInvocationOptions<SampleContainerSchemaInput>,
            token: vscode.CancellationToken,
        ): Promise<vscode.LanguageModelToolResult> {
            const toolResult = await callWithTelemetryAndErrorHandling(
                'cosmosDB.ai.tool.sampleContainerSchema',
                async (actionContext) => {
                    // The tool returns its own LanguageModelToolResult on every path, so suppress the
                    // default error UI; `outcome` starts pessimistic and is narrowed as we progress.
                    actionContext.errorHandling.suppressDisplay = true;
                    actionContext.telemetry.properties.outcome = 'error';

                    // Consume the one-use context captured for the confirmation prompt (removed on read so
                    // it can't be replayed). Resolve the *confirmed* tab by id instead of whatever is active
                    // now, so switching tabs while the prompt was open can't redirect sampling elsewhere.
                    const sampleContextId = options.input?.sampleContextId;
                    const sampleContext = sampleContextId ? takeContainerSampleContext(sampleContextId) : undefined;
                    if (!sampleContext) {
                        actionContext.telemetry.properties.outcome = 'invalidContext';
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t(
                                    'The sampling context is no longer available. Read the Query Editor context again, then retry sampling.',
                                ),
                            ),
                        ]);
                    }

                    const tab = findTabById(sampleContext.tabId);
                    const connection = tab ? getConnectionFromQueryTab(tab) : undefined;
                    if (connection) {
                        actionContext.valuesToMask.push(
                            connection.endpoint,
                            connection.databaseId,
                            connection.containerId,
                        );
                        const azureMetadata = connection.azureMetadata;
                        if (azureMetadata) {
                            actionContext.valuesToMask.push(
                                azureMetadata.accountName,
                                azureMetadata.subscription.subscriptionId,
                                azureMetadata.subscription.name,
                                azureMetadata.resourceGroup,
                                azureMetadata.accountId,
                            );
                        }
                    }

                    if (!tab || !connection) {
                        actionContext.telemetry.properties.outcome = 'noEditor';
                        ext.outputChannel.warn(l10n.t('[Sample Schema Tool] No active Cosmos DB Query Editor.'));
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t(
                                    'No active Cosmos DB Query Editor. Please open a query editor and connect to a container first.',
                                ),
                            ),
                        ]);
                    }

                    // Refuse to sample if the editor drifted from what the user confirmed: a re-pointed
                    // connection would read a container the user never saw. Re-reading the context captures
                    // a fresh snapshot and shows a new prompt.
                    if (
                        connection.endpoint !== sampleContext.endpoint ||
                        connection.databaseId !== sampleContext.databaseId ||
                        connection.containerId !== sampleContext.containerId
                    ) {
                        actionContext.telemetry.properties.outcome = 'stateChanged';
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t(
                                    'The Query Editor changed after you confirmed, so no data was sampled. Please try again to confirm the current container.',
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
                        // The user may have switched tabs while the confirmation prompt was open. Bring the
                        // confirmed editor forward so it is clear which container was sampled.
                        tab.reveal();

                        const sample = await sampleAndPersistContainerSchema(connection, token);
                        if (token.isCancellationRequested) {
                            actionContext.telemetry.properties.outcome = 'cancelled';
                            ext.outputChannel.info(l10n.t('[Sample Schema Tool] Operation cancelled by user.'));
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(l10n.t('Operation cancelled.')),
                            ]);
                        }
                        actionContext.telemetry.properties.outcome =
                            sample.documentCount > 0 ? 'success' : 'noDocuments';
                        actionContext.telemetry.measurements.documentCount = sample.documentCount;
                        if (typeof sample.requestCharge === 'number') {
                            actionContext.telemetry.measurements.requestCharge = sample.requestCharge;
                        }
                        const properties = (sample.schema as { properties?: Record<string, unknown> } | undefined)
                            ?.properties;
                        actionContext.telemetry.measurements.schemaPropertyCount = Object.keys(
                            properties ?? sample.schema ?? {},
                        ).length;
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
                        if (message.trim()) actionContext.valuesToMask.push(message);
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
