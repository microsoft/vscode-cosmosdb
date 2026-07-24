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
import { getActiveQueryEditor, getConnectionFromQueryTab } from './chatUtils';

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
    'Runs the CURRENT query in the active Cosmos DB Query Editor (the selected text if there is a selection, ' +
    'otherwise the full editor content) and shows the results in the editor grid. Use this whenever the user wants ' +
    'to see, show, list, find, count, or return data — writing or applying a query does NOT run it. This tool takes ' +
    'no query parameter; it always runs whatever is currently in the editor, so to run a specific or newly generated ' +
    'query you MUST first call cosmosdb_applyQueryToEditor to make it the current query, then call this tool. Asks ' +
    'the user for confirmation first because it reads data and consumes Request Units (RUs). Returns only PII-free ' +
    'result metadata (row count, request charge, inferred result schema) — never raw documents.';

/**
 * Gets the active query editor tab, if available.
 */
function getActiveTab(): QueryEditorTab | undefined {
    const tabs = Array.from(QueryEditorTab.openTabs);
    if (tabs.length === 0) {
        return undefined;
    }
    return getActiveQueryEditor(tabs);
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
    const tool = vscode.lm.registerTool(EXECUTE_CURRENT_QUERY_TOOL_NAME, {
        prepareInvocation(
            _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
            _token: vscode.CancellationToken,
        ): vscode.PreparedToolInvocation {
            const tab = getActiveTab();
            const activeQuery = tab ? getActiveQuery(tab) : undefined;
            const message = new vscode.MarkdownString(
                l10n.t('Running this query reads data from your Cosmos DB container and consumes Request Units (RUs).'),
            );
            if (activeQuery && activeQuery.trim()) {
                message.appendMarkdown('\n\n**' + l10n.t('Query:') + '**\n');
                message.appendCodeblock(activeQuery.trim(), 'sql');
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
            _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
            token: vscode.CancellationToken,
        ): Promise<vscode.LanguageModelToolResult> {
            const toolResult = await callWithTelemetryAndErrorHandling(
                'cosmosDB.ai.tool.executeCurrentQuery',
                async (actionContext) => {
                    actionContext.errorHandling.suppressDisplay = true;
                    actionContext.telemetry.properties.outcome = 'error';

                    const tab = getActiveTab();
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

                    if (token.isCancellationRequested) {
                        actionContext.telemetry.properties.outcome = 'cancelled';
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(l10n.t('Operation cancelled.')),
                        ]);
                    }

                    try {
                        // The webview runs the query and renders results in the grid; this resolves with
                        // the executionId that actually ran once it reports completion, or `undefined` when
                        // the run was cancelled / never started / timed out.
                        const executionId = await tab.runActiveQueryInEditor(activeQuery);
                        if (!executionId) {
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
                        // Result metadata only — never include raw document values.
                        const metadata = {
                            databaseId: connection.databaseId,
                            containerId: connection.containerId,
                            documentCount: documents.length,
                            requestCharge: queryResult.requestCharge,
                            roundTrips: queryResult.roundTrips,
                            hasMoreResults: queryResult.hasMoreResults,
                            schema:
                                documents.length > 0
                                    ? (getSchemaFromDocuments(documents as NoSQLDocument[]) as Record<string, unknown>)
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
                        actionContext.valuesToMask.push(message);
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
