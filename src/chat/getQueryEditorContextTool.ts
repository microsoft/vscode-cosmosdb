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
import { SchemaService } from '../services/SchemaService';
import { getActiveQueryEditor, getConnectionFromQueryTab } from './chatUtils';
import { CosmosDbOperationsService } from './CosmosDbOperationsService';

/**
 * Tool name constant for the query-editor context tool.
 * Keep in sync with the `name` in package.json `contributes.languageModelTools`.
 */
export const GET_QUERY_EDITOR_CONTEXT_TOOL_NAME = 'cosmosdb_getQueryEditorContext';

/**
 * Tool description for the query-editor context tool.
 * Keep in sync with the `modelDescription` in package.json `contributes.languageModelTools`.
 */
export const GET_QUERY_EDITOR_CONTEXT_TOOL_DESCRIPTION =
    'Returns the context of the active Cosmos DB Query Editor: the full editor text (currentQuery, which may contain ' +
    'multiple queries), the selected query if any (selectedQuery), the single query to operate on or explain ' +
    '(activeQuery — the selection when present, otherwise the full text), the Azure coordinates of the connected ' +
    'account (azure: accountName, subscriptionId, subscriptionName, resourceGroup — present only for Azure-signed-in ' +
    'accounts, omitted for workspace-attached accounts and the emulator), the persisted container schema (if one has ' +
    'already been sampled or inferred), recent query history, and result metadata (row counts, request charge, inferred ' +
    'result schema). Never returns raw document data. Use this to ground query generation or explanation; if it returns ' +
    'a containerSchema, you already know the schema and do not need to sample again.';

/**
 * Result metadata for a single query result. Structure and counts only — no raw document data.
 */
interface QueryResultMetadata {
    query: string;
    documentCount: number;
    requestCharge?: number;
    roundTrips?: number;
    hasMoreResults?: boolean;
    schema?: Record<string, unknown>;
}

/**
 * The PII-free context returned by the tool.
 */
interface QueryEditorContext {
    databaseId: string;
    containerId: string;
    /**
     * Azure resource coordinates for the connected account. Present only for Azure-signed-in
     * accounts; omitted for workspace-attached accounts and the local emulator.
     */
    azure?: {
        accountName: string;
        subscriptionId: string;
        subscriptionName?: string;
        resourceGroup: string;
    };
    /** The full editor text, which may contain multiple queries. */
    currentQuery?: string;
    /** The selected text, when the user has a selection. */
    selectedQuery?: string;
    /** The single query to operate on or explain: the selection when present, otherwise the full editor text. */
    activeQuery?: string;
    /** The persisted container schema (size-bounded) from prior sampling/inference, if any. */
    containerSchema?: unknown;
    currentResult?: QueryResultMetadata;
    queryHistory?: {
        query: string;
        documentCount: number;
        requestCharge?: number;
        timestamp?: number;
        schema?: unknown;
    }[];
}

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
 * Registers the cosmosdb_getQueryEditorContext tool with the VS Code Language Model API.
 */
export function registerGetQueryEditorContextTool(context: vscode.ExtensionContext): void {
    const tool = vscode.lm.registerTool(GET_QUERY_EDITOR_CONTEXT_TOOL_NAME, {
        prepareInvocation(
            _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
            _token: vscode.CancellationToken,
        ): vscode.PreparedToolInvocation {
            return {
                invocationMessage: l10n.t('Reading Query Editor context…'),
            };
        },

        async invoke(
            _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
            _token: vscode.CancellationToken,
        ): Promise<vscode.LanguageModelToolResult> {
            const toolResult = await callWithTelemetryAndErrorHandling(
                'cosmosDB.ai.tool.getQueryEditorContext',
                async (actionContext) => {
                    actionContext.errorHandling.suppressDisplay = true;
                    actionContext.telemetry.properties.outcome = 'error';

                    const tab = getActiveTab();
                    const connection = tab ? getConnectionFromQueryTab(tab) : undefined;
                    if (!tab || !connection) {
                        actionContext.telemetry.properties.outcome = 'noEditor';
                        ext.outputChannel.warn(l10n.t('[Query Editor Context Tool] No active Cosmos DB Query Editor.'));
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t(
                                    'No active Cosmos DB Query Editor. Please open a query editor and connect to a container first.',
                                ),
                            ),
                        ]);
                    }

                    try {
                        // In a multi-query editor the user's focus is the selected text; fall back to the
                        // full editor content when nothing is selected. `activeQuery` is the one to operate on.
                        const rawSelected = tab.getSelectedQuery();
                        const selectedQuery = rawSelected && rawSelected.trim() ? rawSelected : undefined;
                        const currentQuery = tab.getCurrentQuery();
                        const context: QueryEditorContext = {
                            databaseId: connection.databaseId,
                            containerId: connection.containerId,
                            currentQuery,
                            selectedQuery,
                            activeQuery: selectedQuery ?? currentQuery,
                        };

                        // Azure resource coordinates, when the connection is an Azure-signed-in account
                        // (undefined for workspace-attached accounts and the local emulator).
                        const azureMetadata = connection.azureMetadata;
                        if (azureMetadata) {
                            context.azure = {
                                accountName: azureMetadata.accountName,
                                subscriptionId: azureMetadata.subscription.subscriptionId,
                                subscriptionName: azureMetadata.subscription.name,
                                resourceGroup: azureMetadata.resourceGroup,
                            };
                        }

                        // Persisted container schema from prior sampling/inference (size-bounded for the
                        // model context). When present the agent can skip re-sampling the container.
                        const simplified = await SchemaService.getInstance().getSimplifiedSchema(connection);
                        if (simplified) {
                            context.containerSchema = simplified.schema;
                        }

                        const currentResult = tab.getCurrentQueryResults();
                        if (currentResult) {
                            const documents = currentResult.documents ?? [];
                            context.currentResult = {
                                query: currentResult.query,
                                documentCount: documents.length,
                                requestCharge: currentResult.requestCharge,
                                roundTrips: currentResult.roundTrips,
                                hasMoreResults: currentResult.hasMoreResults,
                                // Structure only — getSchemaFromDocuments never carries raw values.
                                schema:
                                    documents.length > 0
                                        ? (getSchemaFromDocuments(documents as NoSQLDocument[]) as Record<
                                              string,
                                              unknown
                                          >)
                                        : undefined,
                            };
                        }

                        const history = CosmosDbOperationsService.getInstance().getQueryHistoryContext(tab);
                        if (history && history.executions.length > 0) {
                            context.queryHistory = history.executions.map((execution) => ({
                                query: execution.query,
                                documentCount: execution.documentCount,
                                requestCharge: execution.requestCharge,
                                timestamp: execution.timestamp,
                                schema: execution.simplifiedSchema ?? execution.schema,
                            }));
                        }

                        actionContext.telemetry.properties.outcome = 'success';
                        actionContext.telemetry.properties.hasSelection = selectedQuery ? 'true' : 'false';
                        actionContext.telemetry.properties.hasContainerSchema = context.containerSchema
                            ? 'true'
                            : 'false';
                        actionContext.telemetry.properties.hasResult = context.currentResult ? 'true' : 'false';
                        if (context.currentResult) {
                            actionContext.telemetry.measurements.resultDocumentCount =
                                context.currentResult.documentCount;
                        }
                        actionContext.telemetry.measurements.historyCount = context.queryHistory?.length ?? 0;

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(JSON.stringify(context, null, 2)),
                        ]);
                    } catch (error) {
                        actionContext.telemetry.properties.outcome = 'error';
                        const message = parseError(error).message;
                        actionContext.valuesToMask.push(message);
                        ext.outputChannel.error(
                            l10n.t('[Query Editor Context Tool] Failed to read context: {0}', message),
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t('Failed to read Query Editor context: {0}', message),
                            ),
                        ]);
                    }
                },
            );

            return (
                toolResult ??
                new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Failed to read Query Editor context.')),
                ])
            );
        },
    });

    context.subscriptions.push(tool);
}
