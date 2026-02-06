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
 *
 * All user content is wrapped with clear delimiters to make it explicit that
 * the block is raw content, not an instruction.
 */

/**
 * Delimiters for wrapping user content to distinguish from instructions.
 */
export const USER_DATA_START = 'BEGIN_USER_DATA';
export const USER_DATA_END = 'END_USER_DATA';
export const USER_QUERY_START = 'BEGIN_USER_QUERY';
export const USER_QUERY_END = 'END_USER_QUERY';
export const USER_CONTEXT_START = 'BEGIN_CONTEXT';
export const USER_CONTEXT_END = 'END_CONTEXT';

/**
 * Wraps user-provided text with delimiters to clearly mark it as raw content.
 * @param text The user's raw text content
 * @param type The type of content being wrapped
 * @returns The wrapped content with clear delimiters
 */
export function wrapUserContent(text: string, type: 'data' | 'query' | 'context' = 'data'): string {
    switch (type) {
        case 'query':
            return `${USER_QUERY_START}\n${text}\n${USER_QUERY_END}`;
        case 'context':
            return `${USER_CONTEXT_START}\n${text}\n${USER_CONTEXT_END}`;
        case 'data':
        default:
            return `${USER_DATA_START}\n${text}\n${USER_DATA_END}`;
    }
}

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
 * Wraps user-provided data with clear delimiters.
 */
export function buildQueryGenerationUserContent(payload: QueryGenerationPayload): string {
    let content = '';

    if (payload.languageReference) {
        content += `## Query Language Reference\n${payload.languageReference}\n\n`;
    }

    if (payload.historyContext) {
        content += wrapUserContent(formatQueryHistoryContext(payload.historyContext), 'context');
        content += '\n\n';
    }

    if (payload.currentQuery) {
        content += `Current query:\n${wrapUserContent(payload.currentQuery, 'query')}`;
        content += '\n\n';
    }

    content += `Request:\n${wrapUserContent(payload.userPrompt, 'data')}`;

    return content;
}

/**
 * Builds query explanation user content (NOT system prompt).
 * Wraps user-provided data with clear delimiters.
 */
export function buildExplanationUserContent(payload: QueryExplanationPayload): string {
    const contextInfo = wrapUserContent(
        buildExplanationContextInfo(payload.connection, payload.resultContext),
        'context',
    );

    const queryBlock = wrapUserContent(payload.query, 'query');
    const userQuestion = wrapUserContent(payload.userPrompt, 'data');

    return `${contextInfo}

**Query to Explain:**
${queryBlock}

**User's Question/Context:**
${userQuestion}`;
}

/**
 * Builds intent extraction user content.
 * Wraps user prompt with clear delimiters.
 */
export function buildIntentExtractionUserContent(payload: IntentExtractionPayload): string {
    return `User request:\n${wrapUserContent(payload.userPrompt, 'data')}`;
}

/**
 * Builds parameter extraction user content.
 * Wraps user prompt with clear delimiters.
 * @param _operation The operation type (used by caller for context, not in user content)
 * @param userPrompt The user's original prompt
 */
export function buildParameterExtractionUserContent(_operation: string, userPrompt: string): string {
    return `User request:\n${wrapUserContent(userPrompt, 'data')}`;
}
