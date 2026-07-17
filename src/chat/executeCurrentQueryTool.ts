/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getSchemaFromDocuments, type NoSQLDocument } from '@cosmosdb/schema-analyzer/json';
import { parseError } from '@microsoft/vscode-azext-utils';
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
            const tab = getActiveTab();
            const connection = tab ? getConnectionFromQueryTab(tab) : undefined;
            if (!tab || !connection) {
                ext.outputChannel.warn(l10n.t('[Execute Current Query Tool] No active Cosmos DB Query Editor.'));
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
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        l10n.t('The Query Editor has no query to run. Write a query first, then run it.'),
                    ),
                ]);
            }

            if (token.isCancellationRequested) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Operation cancelled.')),
                ]);
            }

            try {
                // The webview runs the query and renders results in the grid; this resolves once it
                // reports completion (or after a safety timeout).
                await tab.runActiveQueryInEditor(activeQuery);

                const result = tab.getCurrentQueryResults();
                if (!result) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            l10n.t('The query ran in the Query Editor. No result metadata is available.'),
                        ),
                    ]);
                }

                const documents = result.documents ?? [];
                // PII-free metadata only — never include raw document values.
                const metadata = {
                    databaseId: connection.databaseId,
                    containerId: connection.containerId,
                    query: result.query,
                    documentCount: documents.length,
                    requestCharge: result.requestCharge,
                    roundTrips: result.roundTrips,
                    hasMoreResults: result.hasMoreResults,
                    schema:
                        documents.length > 0
                            ? (getSchemaFromDocuments(documents as NoSQLDocument[]) as Record<string, unknown>)
                            : undefined,
                };

                ext.outputChannel.info(
                    l10n.t(
                        '[Execute Current Query Tool] Ran query on {0}/{1}: {2} rows, cost: {3} RUs',
                        connection.databaseId,
                        connection.containerId,
                        metadata.documentCount,
                        (result.requestCharge ?? 0).toFixed(2),
                    ),
                );

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(metadata, null, 2)),
                ]);
            } catch (error) {
                const message = parseError(error).message;
                ext.outputChannel.error(l10n.t('[Execute Current Query Tool] Failed to run query: {0}', message));
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Failed to run the query: {0}', message)),
                ]);
            }
        },
    });

    context.subscriptions.push(tool);
}
