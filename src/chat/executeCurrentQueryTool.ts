/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getSchemaFromDocuments, type NoSQLDocument } from '@cosmosdb/schema-analyzer/json';
import { callWithTelemetryAndErrorHandling, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { stripSchemaStatistics } from '../services/schemaStatistics';
import { getConnectionFromQueryTab } from './chatUtils';
import { getQueryExecutionContext, takeQueryExecutionContext } from './queryExecutionContext';

/**
 * Tool name constant for the execute-current-query tool.
 * Keep in sync with the `name` in package.json `contributes.languageModelTools`.
 */
export const EXECUTE_CURRENT_QUERY_TOOL_NAME = 'cosmosdb_executeCurrentQuery';

/**
 * Tool description for the execute-current-query tool.
 * Keep in sync with the `modelDescription` in package.json `contributes.languageModelTools`.
 */
export const EXECUTE_CURRENT_QUERY_TOOL_DESCRIPTION =
    'Runs a query previously read from or applied to a Cosmos DB Query Editor and shows the results in that editor. ' +
    'Use this whenever the user wants to see, show, list, find, count, or return data — writing or applying a query ' +
    'does NOT run it. Pass the queryContextId returned by cosmosdb_getQueryEditorContext or ' +
    'cosmosdb_applyQueryToEditor. The context pins the exact editor, query, and container so concurrent tool calls ' +
    'cannot execute or return results for one another. Asks the user for confirmation first because it reads data ' +
    'and consumes Request Units (RUs). Returns result metadata (row count, request charge, inferred result schema) — ' +
    'never raw documents.';

interface ExecuteCurrentQueryInput {
    queryContextId: string;
}

export const EXECUTE_CURRENT_QUERY_TOOL_INPUT_SCHEMA = {
    type: 'object' as const,
    properties: {
        queryContextId: {
            type: 'string',
            description:
                'The queryContextId returned by cosmosdb_getQueryEditorContext or cosmosdb_applyQueryToEditor.',
        },
    },
    required: ['queryContextId'],
    additionalProperties: { not: {} },
};

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
 * Resolves the query the editor would run: the selected text when there is a selection, otherwise
 * the full editor content.
 */
function getActiveQuery(tab: QueryEditorTab): string | undefined {
    const selected = tab.getSelectedQuery();
    if (selected && selected.trim()) {
        return selected;
    }
    return tab.getCurrentQuery();
}

/**
 * Registers the cosmosdb_executeCurrentQuery tool with the VS Code Language Model API.
 */
export function registerExecuteCurrentQueryTool(context: vscode.ExtensionContext): void {
    const tool = vscode.lm.registerTool<ExecuteCurrentQueryInput>(EXECUTE_CURRENT_QUERY_TOOL_NAME, {
        prepareInvocation(
            options: vscode.LanguageModelToolInvocationPrepareOptions<ExecuteCurrentQueryInput>,
            _token: vscode.CancellationToken,
        ): vscode.PreparedToolInvocation {
            const confirmation = options.input?.queryContextId
                ? getQueryExecutionContext(options.input.queryContextId)
                : undefined;

            const message = new vscode.MarkdownString(
                l10n.t('Running this query reads data from your Cosmos DB container and consumes Request Units (RUs).'),
            );
            if (confirmation) {
                message.appendMarkdown('\n\n**' + l10n.t('Database:') + `** ${confirmation.databaseId}`);
                message.appendMarkdown('\n\n**' + l10n.t('Container:') + `** ${confirmation.containerId}`);
                message.appendMarkdown('\n\n**' + l10n.t('Query:') + '**\n');
                message.appendCodeblock(confirmation.query.trim(), 'sql');
            }
            return {
                invocationMessage: l10n.t('Running the query in the Query Editor…'),
                confirmationMessages: {
                    title: l10n.t('Run this query against your Cosmos DB container?'),
                    message,
                },
            };
        },

        async invoke(
            options: vscode.LanguageModelToolInvocationOptions<ExecuteCurrentQueryInput>,
            token: vscode.CancellationToken,
        ): Promise<vscode.LanguageModelToolResult> {
            const toolResult = await callWithTelemetryAndErrorHandling(
                'cosmosDB.ai.tool.executeCurrentQuery',
                async (actionContext) => {
                    actionContext.errorHandling.suppressDisplay = true;
                    actionContext.telemetry.properties.outcome = 'error';

                    const queryContextId = options.input?.queryContextId;
                    const confirmation = queryContextId ? takeQueryExecutionContext(queryContextId) : undefined;
                    if (!confirmation) {
                        actionContext.telemetry.properties.outcome = 'invalidContext';
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t(
                                    'The query context is no longer available. Read or apply the query again, then retry execution.',
                                ),
                            ),
                        ]);
                    }

                    const tab = findTabById(confirmation.tabId);
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
                        ext.outputChannel.warn(
                            l10n.t('[Execute Current Query Tool] No active Cosmos DB Query Editor.'),
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t(
                                    'No active Cosmos DB Query Editor. Please open a query editor and connect to a container first.',
                                ),
                            ),
                        ]);
                    }

                    const activeQuery = getActiveQuery(tab);
                    if (!activeQuery || !activeQuery.trim()) {
                        actionContext.telemetry.properties.outcome = 'noQuery';
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t('The Query Editor has no query to run. Write a query first, then run it.'),
                            ),
                        ]);
                    }
                    // Mask query text early so it cannot leak via telemetry error messages; the query may carry
                    // literal values (e.g. WHERE clauses). Masking does not affect the result returned to the model.
                    actionContext.valuesToMask.push(activeQuery);
                    // The confirmed query may also carry literal values; mask it too in case the state
                    // drifted (below) and it differs from the query we just masked.
                    actionContext.valuesToMask.push(confirmation.query);

                    // Refuse to run if the editor drifted from what the user confirmed: an edited query
                    // (changed while the prompt was open) or a re-pointed connection would target state the
                    // user never saw. Re-running the tool captures a fresh snapshot and shows a new prompt.
                    if (
                        activeQuery !== confirmation.query ||
                        connection.endpoint !== confirmation.endpoint ||
                        connection.databaseId !== confirmation.databaseId ||
                        connection.containerId !== confirmation.containerId
                    ) {
                        actionContext.telemetry.properties.outcome = 'stateChanged';
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t(
                                    'The Query Editor changed after you confirmed, so the query was not run. Please run it again to confirm the current query.',
                                ),
                            ),
                        ]);
                    }

                    if (token.isCancellationRequested) {
                        actionContext.telemetry.properties.outcome = 'cancelled';
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(l10n.t('Operation cancelled.')),
                        ]);
                    }

                    try {
                        // The user may have switched tabs while the confirmation prompt was open.
                        // Bring the confirmed editor forward so the query and its results are visible.
                        tab.reveal();

                        // The webview runs the query and renders results in the grid; this resolves with
                        // the executionId that actually ran once it reports completion, or `undefined` when
                        // the run was cancelled / never started / timed out.
                        const executionId = await tab.runActiveQueryInEditor(
                            activeQuery,
                            {
                                endpoint: confirmation.endpoint,
                                databaseId: confirmation.databaseId,
                                containerId: confirmation.containerId,
                            },
                            token,
                        );
                        if (!executionId) {
                            if (token.isCancellationRequested) {
                                actionContext.telemetry.properties.outcome = 'cancelled';
                                return new vscode.LanguageModelToolResult([
                                    new vscode.LanguageModelTextPart(l10n.t('Operation cancelled.')),
                                ]);
                            }
                            actionContext.telemetry.properties.outcome = 'notExecuted';
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    l10n.t(
                                        'The query was not run in the Query Editor. It may have been cancelled or contain errors that need confirmation. Ask the user to confirm, then try again.',
                                    ),
                                ),
                            ]);
                        }

                        const queryResult = tab.getCurrentQueryResults(executionId);
                        if (!queryResult) {
                            actionContext.telemetry.properties.outcome = 'noResult';
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    l10n.t('The query could not be executed in the Query Editor. Please try again.'),
                                ),
                            ]);
                        }

                        const documents = queryResult.documents ?? [];
                        // Result metadata only — never include raw document values. The inferred
                        // schema is stripped of value-derived statistics (x-minValue/x-maxValue,
                        // x-min/maxLength, boolean counts) so no actual document values reach the model.
                        const metadata = {
                            databaseId: connection.databaseId,
                            containerId: connection.containerId,
                            documentCount: documents.length,
                            requestCharge: queryResult.requestCharge,
                            roundTrips: queryResult.roundTrips,
                            hasMoreResults: queryResult.hasMoreResults,
                            schema:
                                documents.length > 0
                                    ? (stripSchemaStatistics(
                                          getSchemaFromDocuments(documents as NoSQLDocument[]),
                                      ) as Record<string, unknown>)
                                    : undefined,
                        };

                        actionContext.telemetry.properties.outcome = 'success';
                        actionContext.telemetry.measurements.documentCount = metadata.documentCount;
                        if (typeof queryResult.requestCharge === 'number') {
                            actionContext.telemetry.measurements.requestCharge = queryResult.requestCharge;
                        }
                        if (typeof queryResult.roundTrips === 'number') {
                            actionContext.telemetry.measurements.roundTrips = queryResult.roundTrips;
                        }
                        if (metadata.schema) {
                            const properties = (metadata.schema as { properties?: Record<string, unknown> }).properties;
                            actionContext.telemetry.measurements.schemaPropertyCount = Object.keys(
                                properties ?? metadata.schema,
                            ).length;
                        }

                        ext.outputChannel.info(
                            l10n.t(
                                '[Execute Current Query Tool] Ran query on {0}/{1}: {2} rows, cost: {3} RUs',
                                connection.databaseId,
                                connection.containerId,
                                metadata.documentCount,
                                (queryResult.requestCharge ?? 0).toFixed(2),
                            ),
                        );

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(JSON.stringify(metadata, null, 2)),
                        ]);
                    } catch (error) {
                        actionContext.telemetry.properties.outcome = 'error';
                        const message = parseError(error).message;
                        if (message.trim()) {
                            actionContext.valuesToMask.push(message);
                        }
                        ext.outputChannel.error(
                            l10n.t('[Execute Current Query Tool] Failed to run query: {0}', message),
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(l10n.t('Failed to run the query: {0}', message)),
                        ]);
                    }
                },
            );

            return (
                toolResult ??
                new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Failed to run the query.')),
                ])
            );
        },
    });

    context.subscriptions.push(tool);
}
