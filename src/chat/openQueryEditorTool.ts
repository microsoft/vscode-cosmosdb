/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { type QueryEditorTab } from '../panels/QueryEditorTab';
import { getConnectionFromQueryTab } from './chatUtils';
import { revealConnectionInTree } from './revealConnection';

/**
 * Tool name constant for the open-query-editor tool.
 * Keep in sync with the `name` in package.json `contributes.languageModelTools`.
 */
export const OPEN_QUERY_EDITOR_TOOL_NAME = 'cosmosdb_openQueryEditor';

/**
 * Tool description for the open-query-editor tool.
 * Keep in sync with the `modelDescription` in package.json `contributes.languageModelTools`.
 */
export const OPEN_QUERY_EDITOR_TOOL_DESCRIPTION =
    'Opens a Cosmos DB NoSQL Query Editor by starting the connection flow: prompts the user to pick a Cosmos DB ' +
    'container, then opens a Query Editor connected to it. After opening, it also reveals the connected container in ' +
    'the Azure Resources tree (Azure-signed-in accounts only). This is the entry point for ALL Query Editor work: ' +
    'whenever the user wants to write, run, explain, sample, or explore Cosmos DB data and no Query Editor is open ' +
    'yet, call this tool yourself FIRST to open one — do NOT ask the user to open or connect a Query Editor manually, ' +
    'and do NOT emit a query as text for the user to run. The other Query Editor tools ' +
    '(cosmosdb_getQueryEditorContext, cosmosdb_applyQueryToEditor, cosmosdb_executeCurrentQuery, ' +
    'cosmosdb_sampleContainerSchema) require an open editor; if any of them reports that no editor is open, call this ' +
    'tool to open one and then retry that tool. The picker is interactive; the user may cancel it.';

/**
 * Command that opens the NoSQL Query Editor. When invoked with no arguments it starts the
 * connection flow (a container picker), so it doubles as "open a new connection".
 */
const OPEN_QUERY_EDITOR_COMMAND = 'cosmosDB.openNoSqlQueryEditor';

/**
 * Registers the cosmosdb_openQueryEditor tool with the VS Code Language Model API.
 */
export function registerOpenQueryEditorTool(context: vscode.ExtensionContext): void {
    const tool = vscode.lm.registerTool(OPEN_QUERY_EDITOR_TOOL_NAME, {
        prepareInvocation(
            _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
            _token: vscode.CancellationToken,
        ): vscode.PreparedToolInvocation {
            return {
                invocationMessage: l10n.t('Opening a Cosmos DB Query Editor…'),
            };
        },

        async invoke(
            _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
            token: vscode.CancellationToken,
        ): Promise<vscode.LanguageModelToolResult> {
            if (token.isCancellationRequested) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Operation cancelled.')),
                ]);
            }

            try {
                // Executing the command with no arguments starts the connection flow: the user is
                // prompted to pick a container and a Query Editor is opened connected to it. The
                // command resolves with the tab it actually opened, or undefined when the flow was
                // cancelled, so we never mistake a pre-existing editor for a newly opened one.
                const tab = await vscode.commands.executeCommand<QueryEditorTab | undefined>(OPEN_QUERY_EDITOR_COMMAND);
                const connection = tab ? getConnectionFromQueryTab(tab) : undefined;
                if (!connection) {
                    // The user most likely cancelled the container picker, so no editor was opened.
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            l10n.t(
                                'No Query Editor was opened. The connection flow may have been cancelled. Ask the user to select a Cosmos DB container to continue.',
                            ),
                        ),
                    ]);
                }

                ext.outputChannel.info(
                    l10n.t(
                        '[Open Query Editor Tool] Opened Query Editor for {0}/{1}.',
                        connection.databaseId,
                        connection.containerId,
                    ),
                );

                // Best-effort: reveal the newly connected container in the Azure Resources tree so
                // the user can see where it lives. Only works for Azure-signed-in accounts; failures
                // (or workspace-attached / emulator connections) are non-fatal and never block the open.
                let revealedInTree = false;
                try {
                    const { revealed, error: revealError } = await revealConnectionInTree(connection);
                    revealedInTree = revealed;
                    if (revealError) {
                        ext.outputChannel.warn(
                            l10n.t(
                                '[Open Query Editor Tool] Could not reveal connection in the tree: {0}',
                                revealError,
                            ),
                        );
                    }
                } catch (revealError) {
                    ext.outputChannel.warn(
                        l10n.t(
                            '[Open Query Editor Tool] Could not reveal connection in the tree: {0}',
                            parseError(revealError).message,
                        ),
                    );
                }

                const openedMessage = l10n.t(
                    'Opened a Query Editor connected to database "{0}" / container "{1}". You can now generate, apply, or run queries.',
                    connection.databaseId,
                    connection.containerId,
                );
                const revealMessage = revealedInTree
                    ? ' ' + l10n.t('The container was also revealed in the Azure Resources tree.')
                    : '';

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(openedMessage + revealMessage),
                ]);
            } catch (error) {
                const message = parseError(error).message;
                ext.outputChannel.error(l10n.t('[Open Query Editor Tool] Failed to open Query Editor: {0}', message));
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Failed to open a Query Editor: {0}', message)),
                ]);
            }
        },
    });

    context.subscriptions.push(tool);
}
