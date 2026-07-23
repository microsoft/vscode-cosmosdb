/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { ext } from '../extensionVariables';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { getConnectionFromQueryTab } from './chatUtils';

/**
 * Tool name constant for the focus-query-editor tool.
 * Keep in sync with the `name` in package.json `contributes.languageModelTools`.
 */
export const FOCUS_QUERY_EDITOR_TOOL_NAME = 'cosmosdb_focusQueryEditor';

/**
 * Tool description for the focus-query-editor tool.
 * Keep in sync with the `modelDescription` in package.json `contributes.languageModelTools`.
 */
export const FOCUS_QUERY_EDITOR_TOOL_DESCRIPTION =
    'Focuses (activates) a specific open Cosmos DB Query Editor when multiple are open, so the other Query Editor ' +
    'tools (cosmosdb_getQueryEditorContext, cosmosdb_applyQueryToEditor, cosmosdb_executeCurrentQuery) operate on it. ' +
    'Identify the target by its databaseId and containerId — get these from cosmosdb_listOpenConnections. Use this ' +
    'after listing connections when the user wants to work with a specific editor other than the currently active ' +
    'one. Does not open new connections; if no open editor is connected to the given container, call ' +
    'cosmosdb_openQueryEditor instead. Returns PII-free metadata only — never query text or document data.';

/**
 * Input for the focus-query-editor tool. Both fields are required and together identify the
 * open Query Editor connection to focus.
 */
interface FocusQueryEditorInput {
    /** Database of the open Query Editor connection to focus. */
    databaseId: string;
    /** Container of the open Query Editor connection to focus. */
    containerId: string;
}

/**
 * Tool input schema. Both `databaseId` and `containerId` are required.
 * Keep in sync with the `inputSchema` in package.json `contributes.languageModelTools`.
 */
export const FOCUS_QUERY_EDITOR_TOOL_INPUT_SCHEMA = {
    type: 'object' as const,
    properties: {
        databaseId: {
            type: 'string',
            description: 'Database of the open Query Editor connection to focus. Use together with containerId.',
        },
        containerId: {
            type: 'string',
            description: 'Container of the open Query Editor connection to focus. Use together with databaseId.',
        },
    },
    required: ['databaseId', 'containerId'],
    additionalProperties: false,
};

/**
 * Collects the open Query Editor tabs paired with their connections (skipping tabs with no connection).
 */
function getOpenConnections(): { tab: QueryEditorTab; connection: NoSqlQueryConnection }[] {
    return Array.from(QueryEditorTab.openTabs)
        .map((tab) => ({ tab, connection: getConnectionFromQueryTab(tab) }))
        .filter((entry): entry is { tab: QueryEditorTab; connection: NoSqlQueryConnection } => !!entry.connection);
}

/**
 * Registers the cosmosdb_focusQueryEditor tool with the VS Code Language Model API.
 */
export function registerFocusQueryEditorTool(context: vscode.ExtensionContext): void {
    const tool = vscode.lm.registerTool<FocusQueryEditorInput>(FOCUS_QUERY_EDITOR_TOOL_NAME, {
        prepareInvocation(
            _options: vscode.LanguageModelToolInvocationPrepareOptions<FocusQueryEditorInput>,
            _token: vscode.CancellationToken,
        ): vscode.PreparedToolInvocation {
            return {
                invocationMessage: l10n.t('Focusing the Query Editor…'),
            };
        },

        async invoke(
            options: vscode.LanguageModelToolInvocationOptions<FocusQueryEditorInput>,
            token: vscode.CancellationToken,
        ): Promise<vscode.LanguageModelToolResult> {
            const toolResult = await callWithTelemetryAndErrorHandling(
                'cosmosDB.ai.tool.focusQueryEditor',
                async (actionContext) => {
                    actionContext.errorHandling.suppressDisplay = true;
                    actionContext.telemetry.properties.outcome = 'error';

                    if (token.isCancellationRequested) {
                        actionContext.telemetry.properties.outcome = 'cancelled';
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(l10n.t('Operation cancelled.')),
                        ]);
                    }

                    const databaseId = options.input?.databaseId?.trim();
                    const containerId = options.input?.containerId?.trim();
                    // Container/database names are sensitive: mask them from any error path.
                    if (databaseId) {
                        actionContext.valuesToMask.push(databaseId);
                    }
                    if (containerId) {
                        actionContext.valuesToMask.push(containerId);
                    }

                    if (!databaseId || !containerId) {
                        actionContext.telemetry.properties.outcome = 'invalidInput';
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t('Both databaseId and containerId are required to focus a Query Editor.'),
                            ),
                        ]);
                    }

                    const entries = getOpenConnections();
                    actionContext.telemetry.measurements.openEditorCount = entries.length;

                    if (entries.length === 0) {
                        actionContext.telemetry.properties.outcome = 'noEditors';
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t(
                                    'There are no open Cosmos DB Query Editors to focus. Use cosmosdb_openQueryEditor to open one.',
                                ),
                            ),
                        ]);
                    }

                    const matches = entries.filter(
                        (e) => e.connection.databaseId === databaseId && e.connection.containerId === containerId,
                    );
                    actionContext.telemetry.measurements.matchCount = matches.length;

                    if (matches.length === 0) {
                        actionContext.telemetry.properties.outcome = 'notFound';
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t(
                                    'No open Query Editor is connected to database "{0}" / container "{1}". Call cosmosdb_listOpenConnections to see the available editors.',
                                    databaseId,
                                    containerId,
                                ),
                            ),
                        ]);
                    }

                    // Prefer a match that is not already the active editor so "focus" makes a visible
                    // change when several editors share the same container; otherwise take the first match.
                    const target = matches.find((e) => !e.tab.isActive()) ?? matches[0];
                    target.tab.reveal();

                    actionContext.telemetry.properties.outcome = 'success';
                    ext.outputChannel.info(
                        l10n.t('[Focus Query Editor Tool] Focused Query Editor for {0}/{1}.', databaseId, containerId),
                    );

                    const ambiguityNote =
                        matches.length > 1
                            ? ' ' +
                              l10n.t(
                                  'Note: {0} open editors are connected to this container; one of them was focused.',
                                  matches.length,
                              )
                            : '';

                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            l10n.t(
                                'Focused the Query Editor connected to database "{0}" / container "{1}". Subsequent Query Editor tools will now operate on it.',
                                databaseId,
                                containerId,
                            ) + ambiguityNote,
                        ),
                    ]);
                },
            );

            return (
                toolResult ??
                new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Failed to focus the Query Editor.')),
                ])
            );
        },
    });

    context.subscriptions.push(tool);
}
