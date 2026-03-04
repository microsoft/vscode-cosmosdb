/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getCosmosClient } from '../cosmosdb/getCosmosClient';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { ext } from '../extensionVariables';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { type JSONSchema } from '../utils/json/JSONSchema';
import {
    getSchemaFromDocument,
    updateSchemaWithDocument,
    type NoSQLDocument,
} from '../utils/json/nosql/SchemaAnalyzer';
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
 * Executes the sample query against the given connection and returns the inferred schema.
 */
export async function sampleContainerSchema(connection: NoSqlQueryConnection): Promise<SampleSchemaResult> {
    const client = getCosmosClient(connection);
    const container = client.database(connection.databaseId).container(connection.containerId);

    const response = await container.items
        .query<Record<string, unknown>>(SAMPLE_QUERY, {
            maxItemCount: 10,
            maxDegreeOfParallelism: 1,
            bufferItems: false,
        })
        .fetchAll();

    const documents = response.resources;
    if (!documents || documents.length === 0) {
        return {
            databaseId: connection.databaseId,
            containerId: connection.containerId,
            sampleQuery: SAMPLE_QUERY,
            documentCount: 0,
            schema: {},
            requestCharge: response.requestCharge,
        };
    }

    // Build schema from all sampled documents
    const schema = getSchemaFromDocument(documents[0] as NoSQLDocument);
    for (const doc of documents.slice(1)) {
        updateSchemaWithDocument(schema, doc as NoSQLDocument);
    }

    return {
        databaseId: connection.databaseId,
        containerId: connection.containerId,
        sampleQuery: SAMPLE_QUERY,
        documentCount: documents.length,
        schema: simplifySchemaForTool(schema),
        requestCharge: response.requestCharge,
    };
}

/**
 * Simplifies the schema for LLM context by extracting only essential type information.
 * Produces a compact representation: { propertyName: "type" | { nested } | ["type"] }
 */
function simplifySchemaForTool(schema: JSONSchema): Record<string, unknown> {
    const simplified: Record<string, unknown> = {};

    if (!schema.properties || typeof schema.properties !== 'object') {
        return simplified;
    }

    for (const [key, value] of Object.entries(schema.properties as Record<string, JSONSchema>)) {
        const propSchema = value as JSONSchema;
        const anyOfEntries = propSchema.anyOf as JSONSchema[] | undefined;

        if (anyOfEntries && anyOfEntries.length > 0) {
            // Check if any entry is an object type with nested properties
            const objectEntry = anyOfEntries.find((entry) => entry.type === 'object' && entry.properties);
            if (objectEntry) {
                simplified[key] = simplifySchemaForTool(objectEntry);
                continue;
            }

            // Check if any entry is an array type
            const arrayEntry = anyOfEntries.find((entry) => entry.type === 'array');
            if (arrayEntry && arrayEntry.items) {
                const itemsSchema = arrayEntry.items as JSONSchema;
                const itemAnyOf = itemsSchema.anyOf as JSONSchema[] | undefined;
                if (itemAnyOf && itemAnyOf.length > 0) {
                    const itemObjectEntry = itemAnyOf.find((e) => e.type === 'object' && e.properties);
                    if (itemObjectEntry) {
                        simplified[key] = [simplifySchemaForTool(itemObjectEntry)];
                    } else {
                        simplified[key] = [itemAnyOf.map((e) => e.type).join('|')];
                    }
                } else {
                    simplified[key] = ['unknown'];
                }
                continue;
            }

            // Simple type(s)
            const types = anyOfEntries.map((entry) => entry.type).filter(Boolean);
            simplified[key] = types.length === 1 ? types[0] : types.join('|');
        }
    }

    return simplified;
}

/**
 * Gets the active connection from the query editor, if available.
 */
function getActiveConnection(): NoSqlQueryConnection | undefined {
    const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
    if (activeQueryEditors.length === 0) {
        return undefined;
    }
    const activeEditor = getActiveQueryEditor(activeQueryEditors);
    return getConnectionFromQueryTab(activeEditor);
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
            const connection = getActiveConnection();
            if (!connection) {
                ext.outputChannel.warn('[Sample Schema Tool] No active Cosmos DB connection.');
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        l10n.t(
                            'No active Cosmos DB connection. Please open a query editor and connect to a container first.',
                        ),
                    ),
                ]);
            }

            if (token.isCancellationRequested) {
                ext.outputChannel.info('[Sample Schema Tool] Operation cancelled by user.');
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Operation cancelled.')),
                ]);
            }

            try {
                const result = await sampleContainerSchema(connection);
                ext.outputChannel.info(
                    `[Sample Schema Tool] Sampled ${result.documentCount} documents from ${result.databaseId}/${result.containerId}, cost: ${(result.requestCharge ?? 0).toFixed(2)} RUs`,
                );
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
                ]);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ext.outputChannel.error(`[Sample Schema Tool] Failed to sample data: ${message}`);
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Failed to sample data: {0}', message)),
                ]);
            }
        },
    });

    context.subscriptions.push(tool);
}
