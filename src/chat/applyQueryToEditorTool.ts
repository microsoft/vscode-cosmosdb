/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { commentOutQuery, sanitizeSqlComment, stripCodeFences } from '../utils/sanitization';
import { getActiveQueryEditor, getConnectionFromQueryTab } from './chatUtils';

/**
 * Tool name constant for the apply-query-to-editor tool.
 * Keep in sync with the `name` in package.json `contributes.languageModelTools`.
 */
export const APPLY_QUERY_TO_EDITOR_TOOL_NAME = 'cosmosdb_applyQueryToEditor';

/**
 * Tool description for the apply-query-to-editor tool.
 * Keep in sync with the `modelDescription` in package.json `contributes.languageModelTools`.
 */
export const APPLY_QUERY_TO_EDITOR_TOOL_DESCRIPTION =
    'Writes a generated Cosmos DB NoSQL query into the active Query Editor, replacing its contents. ' +
    'The previous query is preserved below the new one as a commented "Previous query" block. ' +
    "Pass the user's original natural-language request as promptDescription so it is cited in a " +
    '"Generated from" comment. Applying does NOT run the query; if the user wants to see results, ' +
    'call cosmosdb_executeCurrentQuery afterwards.';

/**
 * Input for the apply-query-to-editor tool.
 */
interface ApplyQueryToEditorInput {
    /** The generated Cosmos DB NoSQL query to write into the editor. */
    query: string;
    /** The user's original natural-language request, cited in the "Generated from" comment. */
    promptDescription?: string;
}

/**
 * Tool input schema. `query` is required.
 * Keep in sync with the `inputSchema` in package.json `contributes.languageModelTools`.
 */
export const APPLY_QUERY_TO_EDITOR_TOOL_INPUT_SCHEMA = {
    type: 'object' as const,
    properties: {
        query: {
            type: 'string',
            description: 'The generated Cosmos DB NoSQL query to write into the active Query Editor.',
        },
        promptDescription: {
            type: 'string',
            description:
                'The user\'s original natural-language request, cited in the "Generated from" comment above the query.',
        },
    },
    required: ['query'],
    additionalProperties: false,
};

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
 * Builds the final editor text: the generated query framed with a "Generated from"
 * header (when a description is provided) and the previous query preserved as a
 * commented "Previous query" block. Mirrors the framing produced by the legacy
 * `generateQuery` tRPC procedure so the editor experience stays consistent.
 */
export function buildFramedQuery(generatedQuery: string, currentQuery: string, promptDescription?: string): string {
    const cleanedGenerated = stripCodeFences(generatedQuery).trim();
    const sanitizedCurrentQuery = commentOutQuery(currentQuery);
    const previousBlock = `-- ${l10n.t('Previous query:')}\n${sanitizedCurrentQuery}`;

    const description = promptDescription?.trim();
    if (description) {
        const header = `-- ${l10n.t('Generated from: {0}', sanitizeSqlComment(description))}`;
        return `${header}\n${cleanedGenerated}\n\n${previousBlock}`;
    }

    return `${cleanedGenerated}\n\n${previousBlock}`;
}

/**
 * Registers the cosmosdb_applyQueryToEditor tool with the VS Code Language Model API.
 */
export function registerApplyQueryToEditorTool(context: vscode.ExtensionContext): void {
    const tool = vscode.lm.registerTool<ApplyQueryToEditorInput>(APPLY_QUERY_TO_EDITOR_TOOL_NAME, {
        prepareInvocation(
            _options: vscode.LanguageModelToolInvocationPrepareOptions<ApplyQueryToEditorInput>,
            _token: vscode.CancellationToken,
        ): vscode.PreparedToolInvocation {
            return {
                invocationMessage: l10n.t('Applying query to the Query Editor…'),
            };
        },

        invoke(
            options: vscode.LanguageModelToolInvocationOptions<ApplyQueryToEditorInput>,
            _token: vscode.CancellationToken,
        ): vscode.LanguageModelToolResult {
            const query = options.input?.query;
            if (!query || !query.trim()) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('No query was provided to apply to the editor.')),
                ]);
            }

            const tab = getActiveTab();
            const connection = tab ? getConnectionFromQueryTab(tab) : undefined;
            if (!tab || !connection) {
                ext.outputChannel.warn(l10n.t('[Apply Query Tool] No active Cosmos DB Query Editor.'));
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        l10n.t(
                            'No active Cosmos DB Query Editor. Please open a query editor and connect to a container first.',
                        ),
                    ),
                ]);
            }

            try {
                const currentQuery = tab.getCurrentQuery() ?? '';
                // Prefer the request the agent passed; otherwise fall back to the prompt captured by
                // the in-editor "Generate query" flow so the citation appears reliably "like before".
                const promptDescription = options.input?.promptDescription?.trim() || tab.getLastGeneratePrompt();
                const finalQuery = buildFramedQuery(query, currentQuery, promptDescription);
                tab.updateQuery(finalQuery);

                ext.outputChannel.info(
                    l10n.t(
                        '[Apply Query Tool] Applied generated query to {0}/{1}.',
                        connection.databaseId,
                        connection.containerId,
                    ),
                );

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('The generated query was written to the Query Editor.')),
                ]);
            } catch (error) {
                const message = parseError(error).message;
                ext.outputChannel.error(l10n.t('[Apply Query Tool] Failed to apply query: {0}', message));
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Failed to apply the query to the editor: {0}', message)),
                ]);
            }
        },
    });

    context.subscriptions.push(tool);
}
