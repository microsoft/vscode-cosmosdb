/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getSchemaFromDocuments, type NoSQLDocument } from '@cosmosdb/schema-analyzer/json';
import { parseError } from '@microsoft/vscode-azext-utils';
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
    'Samples a few documents from the active Cosmos DB container to infer its schema. ' +
    'Runs a cheap read query (SELECT TOP 5 * FROM c) and returns the inferred property names and types. ' +
    'ALWAYS use this tool FIRST if you do not know the container schema (property names/types). Do not guess schema.';

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
 * Samples the container schema and persists it via `SchemaService`.
 *
 * The returned `SampleSchemaResult.schema` is the size-bounded version
 * produced by `SchemaService.getSimplifiedSchema` so the LLM context stays
 * small regardless of the raw container shape. When persistence is disabled
 * (the user has turned off `generateSchemaBasedOnQueries`), we fall back to
 * a one-shot inferred schema built from the just-sampled documents.
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

    if (isSchemaBasedOnQueries) {
        try {
            await SchemaService.getInstance().mergeDocumentsIntoSchema(connection, documents, {
                source: 'aiSample',
                suppressNotification: true,
                confirmAll: true,
                updateFromQueriesEnabled: true,
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
                    title: l10n.t('Sample Container Schema'),
                    message: l10n.t(SAMPLE_DATA_CONFIRMATION_MESSAGE),
                },
            };
        },

        async invoke(
            _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
            token: vscode.CancellationToken,
        ): Promise<vscode.LanguageModelToolResult> {
            const tab = getActiveTab();
            const connection = tab ? getConnectionFromQueryTab(tab) : undefined;
            if (!connection) {
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
                ext.outputChannel.info(l10n.t('[Sample Schema Tool] Operation cancelled by user.'));
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Operation cancelled.')),
                ]);
            }

            try {
                const result = await sampleAndPersistContainerSchema(connection);
                ext.outputChannel.info(
                    l10n.t(
                        '[Sample Schema Tool] Sampled {0} documents from {1}/{2}, cost: {3} RUs',
                        result.documentCount,
                        result.databaseId,
                        result.containerId,
                        (result.requestCharge ?? 0).toFixed(2),
                    ),
                );

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
                ]);
            } catch (error) {
                const message = parseError(error).message;
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
    });

    context.subscriptions.push(tool);
}
