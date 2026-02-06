/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { type JSONSchema } from '../utils/json/JSONSchema';
import {
    getSchemaFromDocument,
    updateSchemaWithDocument,
    type NoSQLDocument,
} from '../utils/json/nosql/SchemaAnalyzer';
import { sanitizeSqlComment } from '../utils/sanitization';
import { getActiveQueryEditor, getConnectionFromQueryTab, sendChatRequest } from './chatUtils';
import { buildQueryOneShotMessages } from './queryOneShotExamples';
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
    currentQuery: string;
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
            if (execution.schema) {
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
     * Execute a CosmosDB operation
     */
    public async executeOperation(
        operationName: string,
        parameters: Record<string, unknown> = {},
    ): Promise<string | EditQueryResult> {
        try {
            switch (operationName) {
                case 'editQuery': {
                    const { activeEditor, connection, currentResult, sessionQuery, hasResults } =
                        this.getActiveQueryEditorContext();

                    const actualQuery = sessionQuery || (parameters.currentQuery as string) || 'SELECT * FROM c';
                    const historyContext = this.getQueryHistoryContext(activeEditor);

                    return await this.handleEditQuery(
                        actualQuery,
                        parameters.userPrompt as string,
                        parameters.explanation as string,
                        connection,
                        historyContext,
                        {
                            documentCount: hasResults ? currentResult?.documents?.length : undefined,
                            requestCharge: hasResults ? currentResult?.requestCharge : undefined,
                        },
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

                    return await this.handleExplainQuery(actualQuery, parameters.userPrompt as string, connection, {
                        documentCount: hasResults ? currentResult?.documents?.length : undefined,
                        requestCharge: hasResults ? currentResult?.requestCharge : undefined,
                        schema: currentSchema,
                    });
                }
                case 'generateQuery':
                    return await this.handleGenerateQuery(
                        parameters.userPrompt as string,
                        parameters.currentQuery as string,
                    );

                default:
                    throw new Error(l10n.t('Unknown operation: {0}', operationName));
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return l10n.t('❌ Error executing {0}: {1}', operationName, errorMessage);
        }
    }

    private async handleEditQuery(
        currentQuery: string,
        userPrompt: string,
        explanation: string | undefined,
        connection: NoSqlQueryConnection,
        historyContext: QueryHistoryContext | undefined,
        resultContext: {
            documentCount?: number;
            requestCharge?: number;
        },
    ): Promise<EditQueryResult> {
        // Generate LLM suggestion if userPrompt is provided
        let suggestion: string;
        let llmExplanation: string = explanation || '';

        if (userPrompt && userPrompt.trim() !== '') {
            try {
                const llmSuggestion = await this.generateQueryWithLLM(userPrompt, currentQuery, {
                    historyContext,
                    withExplanation: true,
                });
                suggestion = llmSuggestion.query;
                llmExplanation = llmSuggestion.explanation;
            } catch (error) {
                console.warn('LLM query generation failed, using fallback:', error);
                suggestion = this.generateFallbackSuggestion(currentQuery, userPrompt);
                llmExplanation = l10n.t('Basic query optimization applied (LLM unavailable)');
            }
        } else {
            // Fallback when no user prompt
            suggestion = this.generateFallbackSuggestion(currentQuery, '');
            llmExplanation = explanation || l10n.t('Basic query optimization applied');
        }

        // Format the suggested query with comments (like generateQuery does)
        // Comment out the original query and add the prompt that generated the update
        const sanitizedPrompt = sanitizeSqlComment(userPrompt);
        const sanitizedCurrentQuery = currentQuery
            .split('\n')
            .map((line) => sanitizeSqlComment(line))
            .join('\n-- ');
        const formattedSuggestion = `-- Updated from: ${sanitizedPrompt}\n${suggestion.trim()}\n\n-- Previous query:\n-- ${sanitizedCurrentQuery}`;

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
     * Generate fallback suggestion when LLM is unavailable
     */
    private generateFallbackSuggestion(currentQuery: string, userPrompt: string): string {
        // Basic query improvements
        let improvedQuery = currentQuery;

        // Add basic optimizations based on common patterns
        if (userPrompt.toLowerCase().includes('limit') || userPrompt.toLowerCase().includes('top')) {
            if (!improvedQuery.toUpperCase().includes('TOP')) {
                improvedQuery = improvedQuery.replace(/SELECT\s+/i, 'SELECT TOP 100 ');
            }
        }

        if (userPrompt.toLowerCase().includes('order') || userPrompt.toLowerCase().includes('sort')) {
            if (!improvedQuery.toUpperCase().includes('ORDER BY')) {
                improvedQuery += ' ORDER BY c._ts DESC';
            }
        }

        if (userPrompt.toLowerCase().includes('count')) {
            improvedQuery = 'SELECT VALUE COUNT(1) FROM c';
        }

        return improvedQuery;
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
    ): Promise<string> {
        try {
            // Generate LLM explanation with current query context
            const explanation = await this.generateQueryExplanationWithLLM(
                currentQuery,
                userPrompt || 'Explain this query',
                connection,
                resultContext,
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
        } catch (error) {
            console.warn('LLM query explanation failed, using fallback:', error);
            const fallbackExplanation = this.generateFallbackExplanation(currentQuery);

            let queryContext = l10n.t('## 📊 Query Analysis') + '\n\n';
            queryContext += l10n.t('**Database:** {0}', connection.databaseId) + '\n';
            queryContext += l10n.t('**Container:** {0}', connection.containerId) + '\n\n';

            return (
                `${queryContext}` +
                l10n.t('**Query:**') +
                `\n\`\`\`sql\n${currentQuery}\n\`\`\`\n\n` +
                l10n.t('**Basic Explanation:**') +
                `\n${fallbackExplanation}\n\n` +
                l10n.t('*Note: Advanced AI analysis unavailable - using basic explanation.*')
            );
        }
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
    ): Promise<string> {
        try {
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
            );

            let explanation = '';
            for await (const fragment of response.text) {
                explanation += fragment;
            }

            return explanation.trim();
        } catch (error) {
            console.error('LLM query explanation failed:', error);
            throw error;
        }
    }

    /**
     * Generate fallback explanation when LLM is unavailable
     */
    private generateFallbackExplanation(query: string): string {
        const queryUpper = query.toUpperCase();
        let explanation = '';

        // Basic query structure analysis
        if (queryUpper.includes('SELECT')) {
            if (queryUpper.includes('SELECT *')) {
                explanation += l10n.t('• **SELECT * **: Retrieves all properties from documents') + '\n';
            } else if (queryUpper.includes('SELECT VALUE')) {
                explanation += l10n.t('• **SELECT VALUE**: Returns the raw values instead of objects') + '\n';
            } else {
                explanation += l10n.t('• **SELECT**: Retrieves specific properties from documents') + '\n';
            }
        }

        if (queryUpper.includes('FROM C')) {
            explanation += l10n.t('• **FROM c**: Queries from the container (c is the alias)') + '\n';
        }

        if (queryUpper.includes('WHERE')) {
            explanation += l10n.t('• **WHERE**: Filters documents based on specified conditions') + '\n';
        }

        if (queryUpper.includes('ORDER BY')) {
            explanation += l10n.t('• **ORDER BY**: Sorts results in ascending or descending order') + '\n';
        }

        if (queryUpper.includes('TOP') || queryUpper.includes('OFFSET')) {
            explanation += l10n.t('• **Pagination**: Limits the number of results returned') + '\n';
        }

        if (queryUpper.includes('COUNT')) {
            explanation += l10n.t('• **COUNT**: Aggregates the number of matching documents') + '\n';
        }

        if (queryUpper.includes('GROUP BY')) {
            explanation += l10n.t('• **GROUP BY**: Groups results by specified properties') + '\n';
        }

        if (queryUpper.includes('JOIN')) {
            explanation += l10n.t('• **JOIN**: Performs intra-document joins (within the same document)') + '\n';
        }

        if (!explanation) {
            explanation = l10n.t(
                'This appears to be a custom or complex query. Consider using the AI-powered explanation for detailed analysis.',
            );
        }

        return explanation;
    }

    /**
     * Generate a new query from natural language using LLM
     */
    private async handleGenerateQuery(userPrompt: string, currentQuery?: string): Promise<string> {
        // Check if there's an active query editor
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

        // Get current query from session if not provided
        const currentResult = activeEditor.getCurrentQueryResults();
        const sessionQuery = currentResult?.query;
        const actualCurrentQuery = currentQuery || sessionQuery || '';

        // Get query history context for better LLM understanding
        const historyContext = this.getQueryHistoryContext(activeEditor);

        if (!userPrompt || userPrompt.trim() === '') {
            throw new Error(l10n.t('Please provide a description of the query you want to generate.'));
        }

        try {
            const generatedQuery = await this.generateQueryWithLLM(userPrompt, actualCurrentQuery, {
                historyContext,
            });

            // Build response with context
            let response = l10n.t('## 🔨 Generated Query') + '\n\n';
            response += l10n.t('**Database:** {0}', connection.databaseId) + '\n';
            response += l10n.t('**Container:** {0}', connection.containerId) + '\n\n';
            response += l10n.t('**Your request:** {0}', userPrompt) + '\n\n';
            response += l10n.t('**Generated Query:**') + `\n\`\`\`sql\n${generatedQuery}\n\`\`\`\n\n`;

            return response;
        } catch (error) {
            console.error('Query generation failed:', error);
            throw error;
        }
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
        },
    ): Promise<string | { query: string; explanation: string }> {
        const { modelId, historyContext, withExplanation, cancellationToken } = options ?? {};

        const models = await vscode.lm.selectChatModels();
        if (models.length === 0) {
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
        // Use sendChatRequest utility which ensures instruction message is always first.
        // The VS Code Language Model API doesn't support system messages, so we send
        // instructions as the first User message per VS Code documentation.
        // Message order: [system instruction] → [one-shot examples] → [user request]
        const chatResponse = await sendChatRequest(model, systemMessage, userMessage, {}, token, oneShotMessages);

        let responseText = '';
        for await (const chunk of chatResponse.text) {
            responseText += chunk;
        }

        responseText = responseText.trim();

        if (withExplanation) {
            // Parse JSON response
            const result = JSON.parse(responseText) as { query: string; explanation: string };
            if (!result.query || typeof result.query !== 'string') {
                throw new Error(l10n.t('Invalid LLM response: missing query'));
            }
            return {
                query: this.cleanupQueryResponse(result.query),
                explanation: result.explanation || l10n.t('Query generated by AI'),
            };
        }

        return this.cleanupQueryResponse(responseText);
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
