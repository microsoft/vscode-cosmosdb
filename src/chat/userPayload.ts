/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '../utils/json/JSONSchema';
import { type QueryHistoryContext } from './CosmosDbOperationsService';

/**
 * User payload types and builders for the Cosmos DB chat participant.
 * These represent raw, dynamic user content: file text, logs, selections, diffs, diagnostics.
 * DO NOT merge with system prompts - keep them architecturally separate.
 */

/**
 * Connection context for a Cosmos DB database/container.
 */
export interface ConnectionContext {
    readonly accountId: string;
    readonly databaseId: string;
    readonly containerId: string;
}

/**
 * Query execution result context.
 */
export interface QueryResultContext {
    readonly documentCount?: number;
    readonly requestCharge?: number;
    readonly schema?: JSONSchema;
    readonly sampleDocuments?: unknown[];
}

/**
 * Query editor context with current query and results.
 */
export interface QueryEditorPayload {
    readonly currentQuery?: string;
    readonly connection?: ConnectionContext;
    readonly resultContext?: QueryResultContext;
    readonly historyContext?: QueryHistoryContext;
}

/**
 * Intent extraction request payload.
 */
export interface IntentExtractionPayload {
    readonly userPrompt: string;
}

/**
 * Query generation request payload.
 */
export interface QueryGenerationPayload {
    readonly userPrompt: string;
    readonly currentQuery?: string;
    readonly historyContext?: QueryHistoryContext;
    readonly languageReference?: string;
}

/**
 * Query explanation request payload.
 */
export interface QueryExplanationPayload {
    readonly query: string;
    readonly userPrompt: string;
    readonly connection: ConnectionContext;
    readonly resultContext?: QueryResultContext;
}

/**
 * General chat request payload.
 */
export interface ChatRequestPayload {
    readonly userPrompt: string;
    readonly queryEditorContext?: string;
}

/**
 * Builds formatted connection context string for LLM consumption.
 */
export function formatConnectionContext(connection: ConnectionContext): string {
    return `**Database:** ${connection.databaseId}\n**Container:** ${connection.containerId}\n`;
}

/**
 * Builds formatted query result context string for LLM consumption.
 */
export function formatResultContext(context: QueryResultContext): string {
    let formatted = '';

    if (context.documentCount !== undefined) {
        formatted += `**Last execution:** ${context.documentCount} documents`;
        if (context.requestCharge) {
            formatted += `, ${context.requestCharge.toFixed(2)} RUs`;
        }
        formatted += `\n`;
    }

    if (context.schema) {
        formatted += `**Inferred Schema:** ${JSON.stringify(simplifySchema(context.schema))}\n`;
    }

    return formatted;
}

/**
 * Builds formatted query history context string for LLM consumption.
 */
export function formatQueryHistoryContext(historyContext: QueryHistoryContext): string {
    if (!historyContext || historyContext.executions.length === 0) {
        return '';
    }

    let formatted = `## Query Execution History\n`;
    formatted += `**Database:** ${historyContext.databaseId}\n`;
    formatted += `**Container:** ${historyContext.containerId}\n\n`;

    for (let i = 0; i < historyContext.executions.length; i++) {
        const execution = historyContext.executions[i];
        formatted += `### Query ${i + 1}\n`;
        formatted += `\`\`\`sql\n${execution.query}\n\`\`\`\n`;
        formatted += `**Results:** ${execution.documentCount} documents`;
        if (execution.requestCharge) {
            formatted += `, ${execution.requestCharge.toFixed(2)} RUs`;
        }
        formatted += `\n`;
        if (execution.schema) {
            formatted += `**Schema:** ${JSON.stringify(simplifySchema(execution.schema))}\n`;
        }
        formatted += `\n`;
    }

    return formatted;
}

/**
 * Builds the complete context info string for query explanation.
 */
export function buildExplanationContextInfo(connection: ConnectionContext, resultContext?: QueryResultContext): string {
    let contextInfo = formatConnectionContext(connection);

    if (resultContext) {
        contextInfo += formatResultContext(resultContext);
    }

    return contextInfo;
}

/**
 * Simplifies a schema for LLM consumption by extracting key structure.
 */
function simplifySchema(schema: JSONSchema | undefined): Record<string, unknown> {
    if (!schema) {
        return {};
    }

    const simplified: Record<string, unknown> = {};

    if (schema.type) {
        simplified['type'] = schema.type;
    }

    if (schema.properties && typeof schema.properties === 'object') {
        simplified['properties'] = Object.keys(schema.properties as object);
    }

    return simplified;
}

/**
 * Builds query generation user content (NOT system prompt).
 */
export function buildQueryGenerationUserContent(payload: QueryGenerationPayload): string {
    let content = '';

    if (payload.languageReference) {
        content += `## Query Language Reference\n${payload.languageReference}\n\n`;
    }

    if (payload.historyContext) {
        content += formatQueryHistoryContext(payload.historyContext);
    }

    if (payload.currentQuery) {
        content += `\n\nCurrent query:\n${payload.currentQuery}`;
    }

    content += `\n\nRequest: ${payload.userPrompt}`;

    return content;
}

/**
 * Builds query explanation user content (NOT system prompt).
 */
export function buildExplanationUserContent(payload: QueryExplanationPayload): string {
    const contextInfo = buildExplanationContextInfo(payload.connection, payload.resultContext);

    return `${contextInfo}

**Query to Explain:**
\`\`\`sql
${payload.query}
\`\`\`

**User's Question/Context:** ${payload.userPrompt}`;
}

/**
 * Builds intent extraction user content.
 */
export function buildIntentExtractionUserContent(payload: IntentExtractionPayload): string {
    return `User request: "${payload.userPrompt}"`;
}

/**
 * Builds parameter extraction user content.
 * @param _operation The operation type (used by caller for context, not in user content)
 * @param userPrompt The user's original prompt
 */
export function buildParameterExtractionUserContent(_operation: string, userPrompt: string): string {
    return `User request: "${userPrompt}"`;
}
