/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { ext } from '../extensionVariables';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { type JSONSchema } from '../utils/json/JSONSchema';
import {
    getSchemaFromDocument,
    updateSchemaWithDocument,
    type NoSQLDocument,
} from '../utils/json/nosql/SchemaAnalyzer';
import { sanitizeSqlComment } from '../utils/sanitization';
import { buildChatMessages, getActiveQueryEditor, getConnectionFromQueryTab, sendChatRequest } from './chatUtils';
import { buildQueryOneShotMessages } from './queryOneShotExamples';
import {
    SAMPLE_DATA_CONFIRMATION_MESSAGE,
    SAMPLE_DATA_TOOL_NAME,
    sampleContainerSchema,
    type SampleSchemaResult,
} from './sampleDataTool';
import {
    JSON_RESPONSE_FORMAT_WITH_EXPLANATION,
    QUERY_EXPLANATION_PROMPT_TEMPLATE,
    QUERY_GENERATION_SYSTEM_PROMPT,
} from './systemPrompt';
import { buildQueryGenerationUserContent, type QueryGenerationPayload } from './userPayload';

/**
 * Represents a single query execution with its results and inferred schema.
 * Groups query, results, and schema together for better LLM context.
 * Note: We do not include actual document data to avoid passing user PII to the LLM.
 */
export interface QueryExecutionEntry {
    /** The SQL query that was executed */
    query: string;
    /** Number of documents returned */
    documentCount: number;
    /** Request charge in RUs */
    requestCharge?: number;
    /** Inferred schema from the query results (structure only, no actual data) */
    schema?: JSONSchema;
    /** Pre-simplified schema from tool sampling (already in compact form) */
    simplifiedSchema?: Record<string, unknown>;
    /** Timestamp when the query was executed */
    timestamp?: number;
}

/**
 * Context containing grouped query history for LLM consumption.
 * Each entry groups a query with its results and schema.
 */
export interface QueryHistoryContext {
    /** Account ID (optional for backwards compatibility) */
    accountId?: string;
    /** Database being queried */
    databaseId: string;
    /** Container being queried */
    containerId: string;
    /** List of query executions with their grouped context */
    executions: QueryExecutionEntry[];
}

export interface EditQueryResult {
    type: 'editQuery';
    currentQuery?: string;
    suggestedQuery: string;
    explanation: string;
    connection: NoSqlQueryConnection;
    queryContext: {
        databaseId: string;
        containerId: string;
        documentCount?: number;
        requestCharge?: number;
    };
}

/**
 * Maximum number of query executions to store per container.
 */
const MAX_QUERY_HISTORY_PER_CONTAINER = 20;

export class CosmosDbOperationsService {
    private static instance: CosmosDbOperationsService;
    private static extensionPath: string | undefined;
    private static queryLanguageReference: string | undefined;

    /**
     * In-memory storage for query execution history, keyed by "accountId/databaseId/containerId".
     * Each entry stores recent query executions with their computed schemas.
     */
    private queryHistoryStore: Map<string, QueryExecutionEntry[]> = new Map();

    /**
     * Generates a storage key for query history lookup.
     * @param accountId The account ID (optional)
     * @param databaseId The database ID
     * @param containerId The container ID
     * @returns A unique key in the format "accountId/databaseId/containerId"
     */
    private static getQueryHistoryKey(accountId: string | undefined, databaseId: string, containerId: string): string {
        return `${accountId ?? 'unknown'}/${databaseId}/${containerId}`;
    }

    /**
     * Initialize the service with the extension context.
     * This must be called once during extension activation to enable loading of asset files.
     */
    public static initialize(context: vscode.ExtensionContext): void {
        CosmosDbOperationsService.extensionPath = context.extensionPath;
    }

    public static getInstance(): CosmosDbOperationsService {
        if (!CosmosDbOperationsService.instance) {
            CosmosDbOperationsService.instance = new CosmosDbOperationsService();
        }
        return CosmosDbOperationsService.instance;
    }

    /**
     * Loads and caches the NoSQL query language reference for LLM context.
     * The reference is loaded once and cached for subsequent calls.
     */
    private static getQueryLanguageReference(): string {
        if (CosmosDbOperationsService.queryLanguageReference) {
            return CosmosDbOperationsService.queryLanguageReference;
        }

        if (!CosmosDbOperationsService.extensionPath) {
            console.warn('Extension path not initialized. Query language reference will not be available.');
            return '';
        }

        try {
            const referencePath = path.join(
                CosmosDbOperationsService.extensionPath,
                'resources',
                'azurecosmosdb-nosql-query-language.md',
            );
            CosmosDbOperationsService.queryLanguageReference = fs.readFileSync(referencePath, 'utf-8');
            return CosmosDbOperationsService.queryLanguageReference;
        } catch (error) {
            console.warn('Failed to load query language reference:', error);
            return '';
        }
    }

    /**
     * Extracts schema from query results by analyzing all returned documents.
     */
    private extractSchemaFromResults(documents: unknown[]): JSONSchema | undefined {
        if (!documents || documents.length === 0) {
            return undefined;
        }

        try {
            const schema = getSchemaFromDocument(documents[0] as NoSQLDocument);
            for (const document of documents.slice(1)) {
                updateSchemaWithDocument(schema, document as NoSQLDocument);
            }
            return schema;
        } catch (error) {
            console.warn('Failed to extract schema from results:', error);
            return undefined;
        }
    }

    /**
     * Removes SQL comment lines (starting with --) from query text.
     * This cleans up the query before storing in history to avoid accumulating
     * nested "Previous query:" comments.
     */
    private static stripQueryComments(query: string): string {
        return query
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n')
            .trim();
    }

    /**
     * Builds a query execution entry from a query result, grouping query, results, and schema together.
     */
    private buildQueryExecutionEntry(result: SerializedQueryResult): QueryExecutionEntry {
        const documents = result.documents || [];
        const schema = this.extractSchemaFromResults(documents);

        return {
            query: CosmosDbOperationsService.stripQueryComments(result.query),
            documentCount: documents.length,
            requestCharge: result.requestCharge,
            schema: schema,
            // Note: We do not include actual documents to avoid passing user PII to the LLM
            timestamp: Date.now(),
        };
    }

    /**
     * Records a query execution result to the in-memory history store.
     * This should be called after every successful query execution.
     * @param accountId The account ID (optional)
     * @param databaseId The database ID
     * @param containerId The container ID
     * @param result The serialized query result
     */
    public recordQueryExecution(
        accountId: string | undefined,
        databaseId: string,
        containerId: string,
        result: SerializedQueryResult,
    ): void {
        const key = CosmosDbOperationsService.getQueryHistoryKey(accountId, databaseId, containerId);
        const entry = this.buildQueryExecutionEntry(result);

        let history = this.queryHistoryStore.get(key);
        if (!history) {
            history = [];
            this.queryHistoryStore.set(key, history);
        }

        // Remove duplicate queries (keep most recent)
        const existingIndex = history.findIndex((e) => e.query === entry.query);
        if (existingIndex !== -1) {
            history.splice(existingIndex, 1);
        }

        // Add to the beginning (most recent first)
        history.unshift(entry);

        // Trim to max size
        if (history.length > MAX_QUERY_HISTORY_PER_CONTAINER) {
            history.length = MAX_QUERY_HISTORY_PER_CONTAINER;
        }
    }

    /**
     * Gets the query execution history for a specific container from the in-memory store.
     * @param accountId The account ID (optional)
     * @param databaseId The database ID
     * @param containerId The container ID
     * @returns The query history context or undefined if no history exists
     */
    public getQueryHistoryForContainer(
        accountId: string | undefined,
        databaseId: string,
        containerId: string,
    ): QueryHistoryContext | undefined {
        const key = CosmosDbOperationsService.getQueryHistoryKey(accountId, databaseId, containerId);
        const executions = this.queryHistoryStore.get(key);

        if (!executions || executions.length === 0) {
            return undefined;
        }

        return {
            accountId,
            databaseId,
            containerId,
            executions,
        };
    }

    /**
     * Records a sampled schema result into the query history store.
     * This allows subsequent LLM calls to see the schema without re-sampling.
     */
    public recordSampledSchema(
        accountId: string | undefined,
        databaseId: string,
        containerId: string,
        sampleQuery: string,
        documentCount: number,
        simplifiedSchema: Record<string, unknown>,
        requestCharge?: number,
    ): void {
        const key = CosmosDbOperationsService.getQueryHistoryKey(accountId, databaseId, containerId);

        let history = this.queryHistoryStore.get(key);
        if (!history) {
            history = [];
            this.queryHistoryStore.set(key, history);
        }

        // Remove any previous schema sampling entry
        const existingIndex = history.findIndex((e) => e.query === sampleQuery);
        if (existingIndex !== -1) {
            history.splice(existingIndex, 1);
        }

        history.unshift({
            query: sampleQuery,
            documentCount,
            requestCharge,
            simplifiedSchema,
            timestamp: Date.now(),
        });

        if (history.length > MAX_QUERY_HISTORY_PER_CONTAINER) {
            history.length = MAX_QUERY_HISTORY_PER_CONTAINER;
        }
    }

    /**
     * Clears the query history for a specific container.
     */
    public clearQueryHistory(accountId: string | undefined, databaseId: string, containerId: string): void {
        const key = CosmosDbOperationsService.getQueryHistoryKey(accountId, databaseId, containerId);
        this.queryHistoryStore.delete(key);
    }

    /**
     * Clears all query history.
     */
    public clearAllQueryHistory(): void {
        this.queryHistoryStore.clear();
    }

    /**
     * Gets the query history context from the active query editor.
     * Uses the in-memory query history store for better performance and consistency.
     */
    public getQueryHistoryContext(activeEditor: QueryEditorTab): QueryHistoryContext | undefined {
        const connection = getConnectionFromQueryTab(activeEditor);
        if (!connection) {
            return undefined;
        }

        // Use the in-memory store instead of iterating through sessions
        return this.getQueryHistoryForContainer(connection.accountId, connection.databaseId, connection.containerId);
    }

    /**
     * Formats query history context into a string suitable for LLM consumption.
     * Groups query, results, and schema together for each execution.
     */
    public formatQueryHistoryForLLM(historyContext: QueryHistoryContext): string {
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

            // Include schema information (structure only, no actual user data)
            if (execution.simplifiedSchema) {
                formatted += `**Inferred Schema:**\n\`\`\`json\n${JSON.stringify(execution.simplifiedSchema, null, 2)}\n\`\`\`\n`;
            } else if (execution.schema) {
                formatted += `**Inferred Schema:**\n\`\`\`json\n${JSON.stringify(this.simplifySchemaForLLM(execution.schema), null, 2)}\n\`\`\`\n`;
            }

            formatted += `\n`;
        }

        return formatted;
    }

    /**
     * Simplifies the schema for LLM context by extracting only essential type information.
     */
    private simplifySchemaForLLM(schema: JSONSchema): Record<string, unknown> {
        const simplified: Record<string, unknown> = {};

        if (schema.properties) {
            for (const [key, value] of Object.entries(schema.properties)) {
                if (typeof value === 'boolean') {
                    // Skip boolean schema values
                    continue;
                }
                const propSchema = value as JSONSchema;
                if (propSchema.anyOf && propSchema.anyOf.length > 0) {
                    // Get the types from anyOf (filter out boolean entries)
                    const validEntries = propSchema.anyOf.filter(
                        (entry): entry is JSONSchema => typeof entry !== 'boolean',
                    );
                    const types = validEntries.map((entry: JSONSchema) => entry.type || entry['x-bsonType']);
                    simplified[key] = types.length === 1 ? types[0] : types;

                    // If it's an object, recurse into its properties
                    const objectEntry = validEntries.find((entry: JSONSchema) => entry.type === 'object');
                    if (objectEntry && objectEntry.properties) {
                        simplified[key] = this.simplifySchemaForLLM(objectEntry);
                    }

                    // If it's an array, include item types
                    const arrayEntry = validEntries.find((entry: JSONSchema) => entry.type === 'array');
                    if (arrayEntry && arrayEntry.items) {
                        const itemsValue = arrayEntry.items;
                        // Handle items as single schema or array of schemas
                        if (!Array.isArray(itemsValue) && typeof itemsValue !== 'boolean') {
                            const itemsSchema = itemsValue;
                            if (itemsSchema.anyOf) {
                                const validItemEntries = itemsSchema.anyOf.filter(
                                    (entry): entry is JSONSchema => typeof entry !== 'boolean',
                                );
                                const itemTypes = validItemEntries.map(
                                    (entry: JSONSchema) => entry.type || entry['x-bsonType'],
                                );
                                simplified[key] = `array<${itemTypes.join('|')}>`;
                            } else if (itemsSchema.type) {
                                simplified[key] = `array<${itemsSchema.type}>`;
                            }
                        }
                    }
                } else if (propSchema.type) {
                    simplified[key] = propSchema.type;
                }
            }
        }

        return simplified;
    }

    /**
     * Gets the active query editor context including connection, query, and results.
     * Throws an error if no active query editor or connection is found.
     */
    private getActiveQueryEditorContext(): {
        activeEditor: QueryEditorTab;
        connection: NoSqlQueryConnection;
        currentResult: ReturnType<QueryEditorTab['getCurrentQueryResults']>;
        sessionQuery: string | undefined;
        editorQuery: string | undefined;
        hasResults: boolean;
    } {
        const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
        if (activeQueryEditors.length === 0) {
            throw new Error(
                l10n.t(
                    'No active query editor found. Please open a query editor first using the Azure extension or right-click on a container.',
                ),
            );
        }
        const activeEditor = getActiveQueryEditor(activeQueryEditors);
        const connection = getConnectionFromQueryTab(activeEditor);
        if (!connection) {
            throw new Error(
                l10n.t('No connection found in the active query editor. Please connect to a CosmosDB container first.'),
            );
        }

        const currentResult = activeEditor.getCurrentQueryResults();
        const sessionQuery = currentResult?.query;
        const editorQuery = activeEditor.getCurrentQuery();
        const hasResults = !!(currentResult?.documents && currentResult.documents.length > 0);

        return {
            activeEditor,
            connection,
            currentResult,
            sessionQuery,
            editorQuery,
            hasResults,
        };
    }

    /**
     * Gets the active NoSQL connection from an open query editor tab, if available.
     */
    private getActiveConnection(): NoSqlQueryConnection | undefined {
        const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
        if (activeQueryEditors.length === 0) {
            return undefined;
        }
        const activeEditor = getActiveQueryEditor(activeQueryEditors);
        return getConnectionFromQueryTab(activeEditor);
    }

    /**
     * Execute a CosmosDB operation
     */
    public async executeOperation(
        operationName: string,
        parameters: Record<string, unknown> = {},
        onProgress?: (message: string) => void,
        onConfirm?: (message: string) => Promise<boolean>,
        /** Where the request originated, e.g. 'chatParticipant' or 'queryEditor' */
        source?: string,
    ): Promise<string | EditQueryResult> {
        const result = await callWithTelemetryAndErrorHandling('cosmosDB.ai.executeOperation', async (ctx) => {
            ctx.errorHandling.suppressDisplay = true;
            ctx.telemetry.properties.operation = operationName;
            if (source) {
                ctx.telemetry.properties.source = source;
            }

            switch (operationName) {
                case 'editQuery': {
                    const { activeEditor, connection, currentResult, sessionQuery, editorQuery, hasResults } =
                        this.getActiveQueryEditorContext();

                    const actualQuery = sessionQuery || editorQuery || (parameters.currentQuery as string);
                    if (!actualQuery) {
                        return l10n.t(
                            'No query found to edit. Please write or execute a query in the query editor first.',
                        );
                    }
                    const historyContext = this.getQueryHistoryContext(activeEditor);

                    return await this.handleEditQuery(
                        parameters.userPrompt as string,
                        connection,
                        historyContext,
                        {
                            documentCount: hasResults ? currentResult?.documents?.length : undefined,
                            requestCharge: hasResults ? currentResult?.requestCharge : undefined,
                        },
                        actualQuery,
                        true,
                        onProgress,
                        onConfirm,
                        parameters.additionalContext as string | undefined,
                        source,
                        operationName,
                    );
                }
                case 'explainQuery': {
                    const { connection, currentResult, sessionQuery, editorQuery, hasResults } =
                        this.getActiveQueryEditorContext();

                    const actualQuery = sessionQuery || editorQuery || (parameters.currentQuery as string);
                    if (!actualQuery) {
                        return l10n.t('There is no query to analyze');
                    }

                    const currentSchema = hasResults
                        ? this.extractSchemaFromResults(currentResult!.documents)
                        : undefined;

                    return await this.handleExplainQuery(
                        actualQuery,
                        parameters.userPrompt as string,
                        connection,
                        {
                            documentCount: hasResults ? currentResult?.documents?.length : undefined,
                            requestCharge: hasResults ? currentResult?.requestCharge : undefined,
                            schema: currentSchema,
                        },
                        parameters.additionalContext as string | undefined,
                    );
                }
                case 'generateQuery': {
                    const {
                        activeEditor: genEditor,
                        connection: genConnection,
                        currentResult: genResult,
                        sessionQuery: genSessionQuery,
                        editorQuery: genEditorQuery,
                        hasResults: genHasResults,
                    } = this.getActiveQueryEditorContext();
                    const genHistoryContext = this.getQueryHistoryContext(genEditor);
                    const genCurrentQuery = genSessionQuery || genEditorQuery;

                    return await this.handleEditQuery(
                        parameters.userPrompt as string,
                        genConnection,
                        genHistoryContext,
                        {
                            documentCount: genHasResults ? genResult?.documents?.length : undefined,
                            requestCharge: genHasResults ? genResult?.requestCharge : undefined,
                        },
                        genCurrentQuery,
                        false,
                        onProgress,
                        onConfirm,
                        parameters.additionalContext as string | undefined,
                        source,
                        operationName,
                    );
                }

                default:
                    throw new Error(l10n.t('Unknown operation: {0}', operationName));
            }
        });

        if (result === undefined) {
            return l10n.t('❌ Error executing {0}', operationName);
        }
        return result;
    }

    private async handleEditQuery(
        userPrompt: string,
        connection: NoSqlQueryConnection,
        historyContext: QueryHistoryContext | undefined,
        resultContext: {
            documentCount?: number;
            requestCharge?: number;
        },
        currentQuery?: string,
        /** Whether to include currentQuery as LLM context for editing.
         *  When false, currentQuery is only used to comment out the previous query in the output.
         *  Set to false for generateQuery, which creates a fresh query independent of the existing one. */
        sendCurrentQueryToLLM: boolean = true,
        onProgress?: (message: string) => void,
        onConfirm?: (message: string) => Promise<boolean>,
        additionalContext?: string,
        source?: string,
        operation?: string,
    ): Promise<EditQueryResult> {
        if (!userPrompt || userPrompt.trim() === '') {
            throw new Error(l10n.t('Please provide a description of the query you want to generate.'));
        }

        const llmSuggestion = await this.generateQueryWithLLM(
            userPrompt,
            sendCurrentQueryToLLM && currentQuery ? currentQuery : '',
            {
                historyContext,
                withExplanation: true,
                onProgress,
                onConfirm,
                additionalContext,
                source,
                operation,
            },
        );
        const suggestion = llmSuggestion.query;
        const llmExplanation = llmSuggestion.explanation;

        // Format the suggested query with comments
        const sanitizedPrompt = sanitizeSqlComment(userPrompt);
        let formattedSuggestion: string;
        if (currentQuery) {
            const sanitizedCurrentQuery = currentQuery
                .split('\n')
                .map((line) => sanitizeSqlComment(line))
                .join('\n-- ');
            formattedSuggestion = `-- ${l10n.t('Updated from: {0}', sanitizedPrompt)}\n${suggestion.trim()}\n\n-- ${l10n.t('Previous query:')}\n-- ${sanitizedCurrentQuery}`;
        } else {
            formattedSuggestion = `-- ${l10n.t('Generated from: {0}', sanitizedPrompt)}\n${suggestion.trim()}`;
        }

        // Return structured data for the chat participant to handle
        return {
            type: 'editQuery',
            currentQuery: currentQuery,
            suggestedQuery: formattedSuggestion,
            explanation: llmExplanation,
            connection: connection,
            queryContext: {
                databaseId: connection.databaseId,
                containerId: connection.containerId,
                documentCount: resultContext.documentCount,
                requestCharge: resultContext.requestCharge,
            },
        };
    }

    /**
     * Explain the current query using LLM analysis
     */
    private async handleExplainQuery(
        currentQuery: string,
        userPrompt: string | undefined,
        connection: NoSqlQueryConnection,
        resultContext: {
            documentCount?: number;
            requestCharge?: number;
            schema?: JSONSchema;
        },
        additionalContext?: string,
    ): Promise<string> {
        // Generate LLM explanation with current query context
        const explanation = await this.generateQueryExplanationWithLLM(
            currentQuery,
            userPrompt || 'Explain this query',
            connection,
            resultContext,
            additionalContext,
        );

        // Build context header for better user understanding
        let queryContext = l10n.t('## 📊 Query Analysis') + '\n\n';
        queryContext += l10n.t('**Database:** {0}', connection.databaseId) + '\n';
        queryContext += l10n.t('**Container:** {0}', connection.containerId) + '\n';
        if (resultContext.documentCount !== undefined) {
            queryContext += l10n.t('**Last Execution:** {0} documents returned', resultContext.documentCount);
            if (resultContext.requestCharge) {
                queryContext += l10n.t(', {0} RUs consumed', resultContext.requestCharge.toFixed(2));
            }
            queryContext += '\n';

            // Include simplified schema for user reference
            if (resultContext.schema) {
                queryContext +=
                    l10n.t(
                        '**Inferred Schema:** {0}',
                        JSON.stringify(this.simplifySchemaForLLM(resultContext.schema)),
                    ) + '\n';
            }
        }
        queryContext += `\n`;

        return (
            `${queryContext}` +
            l10n.t('**Query:**') +
            `\n\`\`\`sql\n${currentQuery}\n\`\`\`\n\n` +
            l10n.t('**Explanation:**') +
            `\n${explanation}`
        );
    }

    /**
     * Generate query explanation using LLM.
     * Uses separated system prompt (instructions) and user content (payload).
     */
    private async generateQueryExplanationWithLLM(
        query: string,
        userPrompt: string,
        connection: NoSqlQueryConnection,
        resultContext?: {
            documentCount?: number;
            requestCharge?: number;
            schema?: JSONSchema;
        },
        additionalContext?: string,
    ): Promise<string> {
        // Get available language models
        const models = await vscode.lm.selectChatModels({});
        if (models.length === 0) {
            throw new Error('No language model available');
        }

        const model = models[0];

        // Build user content (payload) - separated from system instructions
        let contextInfo = `**Database:** ${connection.databaseId}\n**Container:** ${connection.containerId}\n`;
        if (resultContext?.documentCount !== undefined) {
            contextInfo += `**Last execution:** ${resultContext.documentCount} documents`;
            if (resultContext.requestCharge) {
                contextInfo += `, ${resultContext.requestCharge.toFixed(2)} RUs`;
            }
            contextInfo += `\n`;
        }
        if (resultContext?.schema) {
            contextInfo += `**Inferred Schema:** ${JSON.stringify(this.simplifySchemaForLLM(resultContext.schema))}\n`;
        }
        if (additionalContext) {
            contextInfo += `\n## User-Provided Context\n${additionalContext}\n`;
        }

        // System prompt (fixed instructions) - from systemPrompt.ts
        const systemPrompt = QUERY_EXPLANATION_PROMPT_TEMPLATE.replace('{contextInfo}', contextInfo)
            .replace('{query}', query)
            .replace('{userPrompt}', userPrompt);

        // Use utility to ensure instruction message is always first
        const systemMessage = vscode.LanguageModelChatMessage.User(systemPrompt);
        const response = await sendChatRequest(
            model,
            systemMessage,
            undefined,
            {},
            new vscode.CancellationTokenSource().token,
            undefined,
            'explainQuery',
        );

        let explanation = '';
        for await (const fragment of response.text) {
            explanation += fragment;
        }

        return explanation.trim();
    }

    /**
     * Generate a query using LLM from natural language description.
     * This is the main method for query generation, used by both the chat participant and the query editor.
     * @param userPrompt The user's natural language description of the desired query
     * @param currentQuery Optional current query to use as context
     * @param options Optional configuration including modelId, historyContext, and withExplanation
     * @returns The generated query string, or an object with query and explanation if withExplanation is true
     */
    public async generateQueryWithLLM(
        userPrompt: string,
        currentQuery: string,
        options?: {
            modelId?: string;
            historyContext?: QueryHistoryContext;
            withExplanation?: false;
            cancellationToken?: vscode.CancellationToken;
            onProgress?: (message: string) => void;
            onConfirm?: (message: string) => Promise<boolean>;
            additionalContext?: string;
            /** Where the request originated: 'queryEditor' or 'chatParticipant' */
            source?: string;
            /** The NL2Query operation type: 'generateQuery', 'editQuery', or 'explainQuery' */
            operation?: string;
        },
    ): Promise<string>;
    public async generateQueryWithLLM(
        userPrompt: string,
        currentQuery: string,
        options: {
            modelId?: string;
            historyContext?: QueryHistoryContext;
            withExplanation: true;
            cancellationToken?: vscode.CancellationToken;
            onProgress?: (message: string) => void;
            onConfirm?: (message: string) => Promise<boolean>;
            additionalContext?: string;
            source?: string;
            operation?: string;
        },
    ): Promise<{ query: string; explanation: string }>;
    public async generateQueryWithLLM(
        userPrompt: string,
        currentQuery: string,
        options?: {
            modelId?: string;
            historyContext?: QueryHistoryContext;
            withExplanation?: boolean;
            cancellationToken?: vscode.CancellationToken;
            onProgress?: (message: string) => void;
            onConfirm?: (message: string) => Promise<boolean>;
            additionalContext?: string;
            source?: string;
            operation?: string;
        },
    ): Promise<string | { query: string; explanation: string }> {
        const {
            modelId,
            historyContext,
            withExplanation,
            cancellationToken,
            onProgress,
            onConfirm,
            additionalContext,
        } = options ?? {};
        const source = options?.source;
        const operation = options?.operation;

        const models = await vscode.lm.selectChatModels();
        if (models.length === 0) {
            void callWithTelemetryAndErrorHandling('cosmosDB.ai.noLanguageModel', (ctx) => {
                ctx.errorHandling.suppressDisplay = true;
                ctx.telemetry.properties.caller = 'generateQuery';
            });
            throw new Error(l10n.t('No language model available. Please ensure you have access to Copilot.'));
        }

        // Use specified model or first available
        const model = modelId ? (models.find((m) => m.id === modelId) ?? models[0]) : models[0];

        // Load query language reference for comprehensive syntax guidance
        const queryLanguageRef = CosmosDbOperationsService.getQueryLanguageReference();

        // Build user content (payload) - separated from system instructions
        const userPayload: QueryGenerationPayload = {
            userPrompt,
            currentQuery: currentQuery || undefined,
            historyContext,
            languageReference: queryLanguageRef || undefined,
            additionalContext,
        };
        const userContent = buildQueryGenerationUserContent(userPayload);

        // System prompt (fixed instructions) - from systemPrompt.ts
        // User content (dynamic payload) - built from userPayload.ts
        // Use utility to ensure instruction message is always first
        const systemMessage = vscode.LanguageModelChatMessage.User(QUERY_GENERATION_SYSTEM_PROMPT);
        let userMessage: vscode.LanguageModelChatMessage;
        if (withExplanation) {
            userMessage = vscode.LanguageModelChatMessage.User(userContent + JSON_RESPONSE_FORMAT_WITH_EXPLANATION);
        } else {
            userMessage = vscode.LanguageModelChatMessage.User(userContent);
        }

        // Build one-shot example messages (User/Assistant pairs) for few-shot learning.
        // Per VS Code API, these use LanguageModelChatMessage.User() and .Assistant().
        const oneShotMessages = buildQueryOneShotMessages(vscode.LanguageModelChatMessage);

        const token = cancellationToken ?? new vscode.CancellationTokenSource().token;

        // Build the tool list so the LLM can decide to sample schema if needed.
        const registeredTool = vscode.lm.tools.find((t) => t.name === SAMPLE_DATA_TOOL_NAME);
        const tools: vscode.LanguageModelChatTool[] = registeredTool
            ? [
                  {
                      name: registeredTool.name,
                      description: registeredTool.description,
                      inputSchema: registeredTool.inputSchema,
                  },
              ]
            : [];

        // Build messages: [system instruction] → [one-shot examples] → [user request]
        const messages = buildChatMessages(systemMessage, userMessage, oneShotMessages);
        const requestOptions: vscode.LanguageModelChatRequestOptions = { tools };

        ext.outputChannel.debug('[Generate Query] LLM response:');
        onProgress?.(l10n.t('Generating query…'));
        const llmStartTime = Date.now();

        // Count tokens for the initial request and report telemetry
        try {
            const [systemTokens, userTokenCount] = await Promise.all([
                model.countTokens(systemMessage, token),
                model.countTokens(userMessage, token),
            ]);
            const totalTokens = systemTokens + userTokenCount;
            const maxTokens = model.maxInputTokens;
            const ratio = maxTokens > 0 ? ((totalTokens / maxTokens) * 100).toFixed(1) : 'N/A';
            ext.outputChannel.info(
                `[Generate Query] model="${model.name}" (${model.family}), ` +
                    `systemTokens=${systemTokens}, userTokens=${userTokenCount}, ` +
                    `requestTokens=${totalTokens}, maxInputTokens=${maxTokens}, ` +
                    `usage=${ratio}%`,
            );

            void callWithTelemetryAndErrorHandling('cosmosDB.ai.llmRequest', (ctx) => {
                ctx.errorHandling.suppressDisplay = true;
                ctx.telemetry.properties.caller = 'generateQuery';
                ctx.telemetry.properties.modelName = model.name;
                ctx.telemetry.properties.modelFamily = model.family;
                ctx.telemetry.measurements.instructionTokens = systemTokens;
                ctx.telemetry.measurements.userTokens = userTokenCount;
                ctx.telemetry.measurements.requestTokens = totalTokens;
                ctx.telemetry.measurements.maxInputTokens = maxTokens;
            });
        } catch {
            // Token counting is best-effort
        }

        let responseText = '';
        let schemaSamplingRUs = 0;
        let schemaSamplingExecuted = false;
        let schemaSamplingDurationMs = 0;
        let schemaSamplingUserAllowed: boolean | undefined;
        let toolRoundsUsed = 0;

        // Agentic loop: let the LLM decide whether to call the schema sampling tool
        const MAX_TOOL_ROUNDS = 3;
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
            const response = await model.sendRequest(messages, requestOptions, token);

            const textParts: string[] = [];
            const toolCallParts: vscode.LanguageModelToolCallPart[] = [];

            for await (const part of response.stream) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    textParts.push(part.value);
                    ext.outputChannel.debug(part.value);
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    toolCallParts.push(part);
                }
            }

            if (toolCallParts.length === 0) {
                // No tool calls — LLM produced the final answer
                responseText = textParts.join('');
                break;
            }

            // LLM requested tool call(s) — invoke and feed results back
            toolRoundsUsed = round + 1;
            ext.outputChannel.info(
                `[Generate Query] Tool call round ${round + 1}: ${toolCallParts.map((t) => t.name).join(', ')}`,
            );

            // Add assistant message with the tool call parts
            messages.push(vscode.LanguageModelChatMessage.Assistant(toolCallParts));

            // Invoke each tool and add results as user messages
            for (const toolCall of toolCallParts) {
                ext.outputChannel.info(`[Generate Query] Invoking tool: ${toolCall.name}...`);

                if (toolCall.name === SAMPLE_DATA_TOOL_NAME) {
                    onProgress?.(l10n.t('Analyzing container schema…'));

                    void callWithTelemetryAndErrorHandling('cosmosDB.ai.schemaSamplingRequested', (ctx) => {
                        ctx.errorHandling.suppressDisplay = true;
                        ctx.telemetry.properties.source = onConfirm ? 'queryEditor' : 'chatParticipant';
                    });
                }

                let toolResult: vscode.LanguageModelToolResult;

                // Invoke our own tool directly so we can show custom confirmation
                // (onConfirm), track telemetry, report progress, and cache the schema.
                if (toolCall.name === SAMPLE_DATA_TOOL_NAME) {
                    const connection = this.getActiveConnection();
                    if (connection) {
                        if (onConfirm) {
                            const confirmed = await onConfirm(l10n.t(SAMPLE_DATA_CONFIRMATION_MESSAGE));
                            if (!confirmed) {
                                schemaSamplingUserAllowed = false;
                                void callWithTelemetryAndErrorHandling('cosmosDB.ai.schemaSamplingDenied', (ctx) => {
                                    ctx.errorHandling.suppressDisplay = true;
                                    ctx.telemetry.properties.source = 'queryEditor';
                                });
                                toolResult = new vscode.LanguageModelToolResult([
                                    new vscode.LanguageModelTextPart(
                                        l10n.t('User declined to sample the container schema.'),
                                    ),
                                ]);
                                messages.push(
                                    vscode.LanguageModelChatMessage.User([
                                        new vscode.LanguageModelToolResultPart(toolCall.callId, toolResult.content),
                                    ]),
                                );
                                continue;
                            }
                        }
                        schemaSamplingUserAllowed = true;
                        void callWithTelemetryAndErrorHandling('cosmosDB.ai.schemaSamplingAllowed', (ctx) => {
                            ctx.errorHandling.suppressDisplay = true;
                            ctx.telemetry.properties.source = onConfirm ? 'queryEditor' : 'chatParticipant';
                        });

                        const schemaSamplingStart = Date.now();
                        let result: SampleSchemaResult;
                        try {
                            result = await sampleContainerSchema(connection);
                        } catch (error) {
                            const errMsg = parseError(error).message;
                            ext.outputChannel.error(`[Generate Query] Failed to sample container schema: ${errMsg}`);
                            const baseMessage = l10n.t(
                                'Unable to sample the container schema. Query generation will continue without schema information, which may affect accuracy.',
                            );
                            void vscode.window.showErrorMessage(
                                errMsg ? `${baseMessage} ${l10n.t('Error: {0}', errMsg)}` : baseMessage,
                            );
                            toolResult = new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(l10n.t('Failed to sample data: {0}', errMsg)),
                            ]);
                            messages.push(
                                vscode.LanguageModelChatMessage.User([
                                    new vscode.LanguageModelToolResultPart(toolCall.callId, toolResult.content),
                                ]),
                            );
                            continue;
                        }
                        toolResult = new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
                        ]);

                        schemaSamplingDurationMs += Date.now() - schemaSamplingStart;
                        const ruCost = result.requestCharge ?? 0;
                        schemaSamplingRUs += ruCost;
                        schemaSamplingExecuted = true;

                        // Log RU cost to output channel
                        ext.outputChannel.info(
                            `[Generate Query] Schema sampling cost: ${ruCost.toFixed(2)} RUs (${result.documentCount} documents)`,
                        );

                        // Stream RU cost to the chat window
                        onProgress?.(
                            l10n.t('Schema sampled ({0} documents, {1} RUs)', result.documentCount, ruCost.toFixed(2)),
                        );

                        // Cache the sampled schema in query history so subsequent
                        // LLM calls won't need to re-sample.
                        this.recordSampledSchema(
                            connection.accountId,
                            connection.databaseId,
                            connection.containerId,
                            result.sampleQuery,
                            result.documentCount,
                            result.schema as Record<string, unknown>,
                            result.requestCharge,
                        );
                    } else {
                        toolResult = new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                l10n.t(
                                    'No active Cosmos DB connection. Please open a query editor and connect to a container first.',
                                ),
                            ),
                        ]);
                    }
                } else {
                    toolResult = await vscode.lm.invokeTool(
                        toolCall.name,
                        { input: toolCall.input, toolInvocationToken: undefined },
                        token,
                    );
                }

                // Log tool result to output channel
                for (const part of toolResult.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        if (toolCall.name === SAMPLE_DATA_TOOL_NAME) {
                            try {
                                const parsed = JSON.parse(part.value) as {
                                    schema?: Record<string, unknown>;
                                    requestCharge?: number;
                                };
                                const fieldCount = parsed.schema ? Object.keys(parsed.schema).length : 0;
                                const ruInfo = parsed.requestCharge ? `, ${parsed.requestCharge.toFixed(2)} RUs` : '';
                                ext.outputChannel.info(
                                    `[Generate Query] Tool result: schema with ${fieldCount} top-level fields${ruInfo}`,
                                );
                            } catch {
                                ext.outputChannel.info(`[Generate Query] Tool result: (schema)`);
                            }
                        } else {
                            ext.outputChannel.info(`[Generate Query] Tool result: (non-schema tool)`);
                        }
                    }
                }

                messages.push(
                    vscode.LanguageModelChatMessage.User([
                        new vscode.LanguageModelToolResultPart(toolCall.callId, toolResult.content),
                    ]),
                );
            }
        }
        ext.outputChannel.appendLine('');

        responseText = responseText.trim();

        // Strip markdown code block fences if the LLM wrapped the response
        if (responseText.startsWith('```')) {
            responseText = responseText
                .replace(/^```(?:json)?\n?/, '')
                .replace(/\n?```$/, '')
                .trim();
        }

        const llmDurationMs = Date.now() - llmStartTime;

        // Report generation telemetry
        void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerated', (ctx) => {
            ctx.errorHandling.suppressDisplay = true;
            ctx.telemetry.properties.schemaSampled = String(schemaSamplingExecuted);
            ctx.telemetry.properties.modelId = model.id;
            ctx.telemetry.properties.hasCurrentQuery = String(!!currentQuery);
            if (source) {
                ctx.telemetry.properties.source = source;
            }
            if (operation) {
                ctx.telemetry.properties.operation = operation;
            }
            if (schemaSamplingUserAllowed !== undefined) {
                ctx.telemetry.properties.schemaSamplingUserAllowed = String(schemaSamplingUserAllowed);
            }
            ctx.telemetry.measurements.durationMs = llmDurationMs;
            ctx.telemetry.measurements.toolRoundsUsed = toolRoundsUsed;
            ctx.telemetry.measurements.queryHistorySize = historyContext?.executions?.length ?? 0;
            if (schemaSamplingExecuted) {
                ctx.telemetry.measurements.schemaSamplingRUs = schemaSamplingRUs;
                ctx.telemetry.measurements.schemaSamplingDurationMs = schemaSamplingDurationMs;
            }
        });

        if (withExplanation) {
            // Parse JSON response
            const result = JSON.parse(responseText) as { query: string; explanation: string; comments?: string };
            if (!result.query || typeof result.query !== 'string') {
                void callWithTelemetryAndErrorHandling('cosmosDB.ai.invalidLlmResponse', (ctx) => {
                    ctx.errorHandling.suppressDisplay = true;
                    ctx.telemetry.properties.reason = 'missingQuery';
                });
                throw new Error(l10n.t('Invalid LLM response: missing query'));
            }
            const query = result.comments
                ? `${sanitizeSqlComment(result.comments)}\n${this.cleanupQueryResponse(result.query)}`
                : this.cleanupQueryResponse(result.query);
            const schemaSamplingComment = schemaSamplingExecuted
                ? `-- ${l10n.t('Schema sampling tool was executed. Cost: {0} RUs', schemaSamplingRUs.toFixed(2))}\n`
                : '';
            return {
                query: schemaSamplingComment + query,
                explanation: result.explanation || l10n.t('Query generated by AI'),
            };
        }

        const schemaSamplingComment = schemaSamplingExecuted
            ? `-- ${l10n.t('Schema sampling tool was executed. Cost: {0} RUs', schemaSamplingRUs.toFixed(2))}\n`
            : '';
        return schemaSamplingComment + this.cleanupQueryResponse(responseText);
    }

    /**
     * Clean up the LLM response by removing markdown code blocks if present.
     */
    private cleanupQueryResponse(query: string): string {
        let cleaned = query.trim();
        if (cleaned.startsWith('```sql')) {
            cleaned = cleaned.replace(/^```sql\n?/, '').replace(/\n?```$/, '');
        } else if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }
        return cleaned.trim();
    }
}
