/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import {
    getSchemaFromDocument,
    updateSchemaWithDocument,
    type NoSQLDocument,
} from '../utils/json/nosql/SchemaAnalyzer';
import { getActiveQueryEditor, getConnectionFromQueryTab } from './chatUtils';

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

export class CosmosDbOperationsService {
    private static instance: CosmosDbOperationsService;

    public static getInstance(): CosmosDbOperationsService {
        if (!CosmosDbOperationsService.instance) {
            CosmosDbOperationsService.instance = new CosmosDbOperationsService();
        }
        return CosmosDbOperationsService.instance;
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
                case 'editQuery':
                    return await this.handleEditQuery(
                        parameters.currentQuery as string,
                        parameters.userPrompt as string,
                        parameters.explanation as string,
                    );
                case 'explainQuery':
                    return await this.handleExplainQuery(
                        parameters.currentQuery as string,
                        parameters.userPrompt as string,
                    );
                case 'generateQuery':
                    return await this.handleGenerateQuery(
                        parameters.userPrompt as string,
                        parameters.currentQuery as string,
                    );

                default:
                    throw new Error(`Unknown operation: ${operationName}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return `❌ Error executing ${operationName}: ${errorMessage}`;
        }
    }

    private async handleEditQuery(
        currentQuery: string,
        userPrompt: string,
        explanation?: string,
    ): Promise<EditQueryResult> {
        // Check if there's an active query editor
        const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
        if (activeQueryEditors.length === 0) {
            throw new Error(
                'No active query editor found. Please open a query editor first using the Azure extension or right-click on a container.',
            );
        }

        // Find the active or visible query editor, fallback to first if none active
        const activeEditor = getActiveQueryEditor(activeQueryEditors);
        const connection = getConnectionFromQueryTab(activeEditor);
        if (!connection) {
            throw new Error(
                'No connection found in the active query editor. Please connect to a CosmosDB container first.',
            );
        }

        // Get comprehensive context from the active query session
        const currentResult = activeEditor.getCurrentQueryResults();
        const sessionQuery = currentResult?.query;
        const hasResults = currentResult?.documents && currentResult.documents.length > 0;
        const requestCharge = currentResult?.requestCharge;
        const documentCount = currentResult?.documents?.length || 0;

        // Use session query as primary source, fallback to parameter
        const actualCurrentQuery = sessionQuery || currentQuery || 'SELECT * FROM c';

        // Generate LLM suggestion if userPrompt is provided
        let suggestion: string;
        let llmExplanation: string = explanation || '';

        if (userPrompt && userPrompt.trim() !== '') {
            try {
                const llmSuggestion = await this.generateQuerySuggestionWithLLM(
                    actualCurrentQuery,
                    userPrompt,
                    connection,
                    currentResult,
                );
                suggestion = llmSuggestion.query;
                llmExplanation = llmSuggestion.explanation;
            } catch (error) {
                console.warn('LLM query generation failed, using fallback:', error);
                suggestion = this.generateFallbackSuggestion(actualCurrentQuery, userPrompt);
                llmExplanation = 'Basic query optimization applied (LLM unavailable)';
            }
        } else {
            // Fallback when no user prompt
            suggestion = this.generateFallbackSuggestion(actualCurrentQuery, '');
            llmExplanation = explanation || 'Basic query optimization applied';
        }

        // Return structured data for the chat participant to handle
        return {
            type: 'editQuery',
            currentQuery: actualCurrentQuery,
            suggestedQuery: suggestion,
            explanation: llmExplanation,
            connection: connection,
            queryContext: {
                databaseId: connection.databaseId,
                containerId: connection.containerId,
                documentCount: hasResults ? documentCount : undefined,
                requestCharge: hasResults ? requestCharge : undefined,
            },
        };
    }

    /**
     * Generate query suggestion using LLM based on user prompt and context
     */
    private async generateQuerySuggestionWithLLM(
        currentQuery: string,
        userPrompt: string,
        connection: NoSqlQueryConnection,
        queryResult?: { documents?: unknown[]; requestCharge?: number; query?: string },
    ): Promise<{ query: string; explanation: string }> {
        try {
            // Get available language models
            const models = await vscode.lm.selectChatModels({});
            if (models.length === 0) {
                throw new Error('No language model available');
            }

            const model = models[0];

            // Build context for LLM
            let contextInfo = `Database: ${connection.databaseId}, Container: ${connection.containerId}`;
            if (queryResult?.documents) {
                contextInfo += `, Last execution: ${queryResult.documents.length} documents`;
                if (queryResult.requestCharge) {
                    contextInfo += `, ${queryResult.requestCharge.toFixed(2)} RUs`;
                }

                // Include inferred schema to context
                if (queryResult.documents.length > 0) {
                    const schema = getSchemaFromDocument(queryResult.documents[0] as NoSQLDocument);
                    for (const document of queryResult.documents.slice(1)) {
                        updateSchemaWithDocument(schema, document as NoSQLDocument);
                    }
                    contextInfo += `, Inferred schema from query result: ${JSON.stringify(schema)}`;
                }
            }

            const llmPrompt = `You are a Cosmos DB query optimization expert. Please improve the following NoSQL query based on the user's request.a

**Context:** ${contextInfo}

**Current Query:**
\`\`\`sql
${currentQuery}
\`\`\`

**User Request:** ${userPrompt}

**Instructions:**
1. Optimize the query for performance and cost (RU efficiency)
2. Follow Cosmos DB best practices
3. Ensure the query is syntactically correct
4. Consider partition key usage if relevant
5. Add appropriate indexing hints if needed

**Response Format (JSON only):**
{
  "query": "optimized SQL query here",
  "explanation": "brief explanation of changes made"
}

Return only valid JSON, no other text:`;

            const messages = [vscode.LanguageModelChatMessage.User(llmPrompt)];
            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

            let jsonText = '';
            for await (const fragment of response.text) {
                jsonText += fragment;
            }

            // Parse the JSON response
            const result = JSON.parse(jsonText.trim()) as { query: string; explanation: string };

            if (!result.query || typeof result.query !== 'string') {
                throw new Error('Invalid LLM response: missing query');
            }

            return {
                query: result.query.trim(),
                explanation: result.explanation || 'Query optimized by AI',
            };
        } catch (error) {
            console.error('LLM query generation failed:', error);
            throw error;
        }
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
    private async handleExplainQuery(currentQuery?: string, userPrompt?: string): Promise<string> {
        // Check if there's an active query editor
        const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
        if (activeQueryEditors.length === 0) {
            throw new Error(
                'No active query editor found. Please open a query editor first using the Azure extension or right-click on a container.',
            );
        }

        // Find the active or visible query editor, fallback to first if none active
        const activeEditor = getActiveQueryEditor(activeQueryEditors);
        const connection = getConnectionFromQueryTab(activeEditor);
        if (!connection) {
            throw new Error(
                'No connection found in the active query editor. Please connect to a CosmosDB container first.',
            );
        }

        // Get comprehensive context from the active query session
        const currentResult = activeEditor.getCurrentQueryResults();
        const sessionQuery = currentResult?.query;
        const editorQuery = activeEditor.getCurrentQuery();
        const hasResults = currentResult?.documents && currentResult.documents.length > 0;
        const requestCharge = currentResult?.requestCharge;
        const documentCount = currentResult?.documents?.length || 0;

        // Use session query as primary source, fallback to editor query, then to parameter
        const actualCurrentQuery = sessionQuery || editorQuery || currentQuery;

        if (!actualCurrentQuery) {
            return 'There is no query to analyze';
        }

        try {
            // Generate LLM explanation
            const explanation = await this.generateQueryExplanationWithLLM(
                actualCurrentQuery,
                userPrompt || 'Explain this query',
                connection,
                currentResult,
            );

            // Build context for better user understanding
            let queryContext = `## 📊 Query Analysis\n\n`;
            queryContext += `**Database:** ${connection.databaseId}\n`;
            queryContext += `**Container:** ${connection.containerId}\n`;
            if (hasResults) {
                queryContext += `**Last Execution:** ${documentCount} documents returned`;
                if (requestCharge) {
                    queryContext += `, ${requestCharge.toFixed(2)} RUs consumed`;
                }
                queryContext += `\n`;

                // Include inferred schema to context
                if (currentResult.documents.length > 0) {
                    const schema = getSchemaFromDocument(currentResult.documents[0] as NoSQLDocument);
                    for (const document of currentResult.documents.slice(1)) {
                        updateSchemaWithDocument(schema, document as NoSQLDocument);
                    }
                    queryContext += `=, Inferred schema from query result: ${JSON.stringify(schema)}\n`;
                }
            }
            queryContext += `\n`;

            return `${queryContext}**Query:**\n\`\`\`sql\n${actualCurrentQuery}\n\`\`\`\n\n**Explanation:**\n${explanation}`;
        } catch (error) {
            console.warn('LLM query explanation failed, using fallback:', error);
            const fallbackExplanation = this.generateFallbackExplanation(actualCurrentQuery);

            let queryContext = `## 📊 Query Analysis\n\n`;
            queryContext += `**Database:** ${connection.databaseId}\n`;
            queryContext += `**Container:** ${connection.containerId}\n\n`;

            return `${queryContext}**Query:**\n\`\`\`sql\n${actualCurrentQuery}\n\`\`\`\n\n**Basic Explanation:**\n${fallbackExplanation}\n\n*Note: Advanced AI analysis unavailable - using basic explanation.*`;
        }
    }

    /**
     * Generate query explanation using LLM
     */
    private async generateQueryExplanationWithLLM(
        query: string,
        userPrompt: string,
        connection: NoSqlQueryConnection,
        queryResult?: { documents?: unknown[]; requestCharge?: number; query?: string },
    ): Promise<string> {
        try {
            // Get available language models
            const models = await vscode.lm.selectChatModels({});
            if (models.length === 0) {
                throw new Error('No language model available');
            }

            const model = models[0];

            // Build context for LLM with only metadata (no document content)
            let contextInfo = `Database: ${connection.databaseId}, Container: ${connection.containerId}`;
            if (queryResult?.documents) {
                contextInfo += `, Last execution: ${queryResult.documents.length} documents returned`;
                if (queryResult.requestCharge) {
                    contextInfo += `, ${queryResult.requestCharge.toFixed(2)} RUs consumed`;
                }
            }

            const llmPrompt = `You are a Cosmos DB query expert. Please explain the following NoSQL query in detail.

**Context:** ${contextInfo}

**Query to Explain:**
\`\`\`sql
${query}
\`\`\`

**User's Question/Context:** ${userPrompt}

**Please provide a comprehensive explanation that includes:**
1. **Purpose**: What this query does
2. **Components**: Break down each part of the query (SELECT, FROM, WHERE, etc.)
3. **Performance**: RU cost considerations and optimization suggestions
4. **Results**: What kind of data this query returns
5. **Best Practices**: Any recommendations for improvement

Make the explanation clear and educational, suitable for developers learning Cosmos DB queries.`;

            const messages = [vscode.LanguageModelChatMessage.User(llmPrompt)];
            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

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
                explanation += '• **SELECT * **: Retrieves all properties from documents\n';
            } else if (queryUpper.includes('SELECT VALUE')) {
                explanation += '• **SELECT VALUE**: Returns the raw values instead of objects\n';
            } else {
                explanation += '• **SELECT**: Retrieves specific properties from documents\n';
            }
        }

        if (queryUpper.includes('FROM C')) {
            explanation += '• **FROM c**: Queries from the container (c is the alias)\n';
        }

        if (queryUpper.includes('WHERE')) {
            explanation += '• **WHERE**: Filters documents based on specified conditions\n';
        }

        if (queryUpper.includes('ORDER BY')) {
            explanation += '• **ORDER BY**: Sorts results in ascending or descending order\n';
        }

        if (queryUpper.includes('TOP') || queryUpper.includes('OFFSET')) {
            explanation += '• **Pagination**: Limits the number of results returned\n';
        }

        if (queryUpper.includes('COUNT')) {
            explanation += '• **COUNT**: Aggregates the number of matching documents\n';
        }

        if (queryUpper.includes('GROUP BY')) {
            explanation += '• **GROUP BY**: Groups results by specified properties\n';
        }

        if (queryUpper.includes('JOIN')) {
            explanation += '• **JOIN**: Performs intra-document joins (within the same document)\n';
        }

        if (!explanation) {
            explanation =
                'This appears to be a custom or complex query. Consider using the AI-powered explanation for detailed analysis.';
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
                'No active query editor found. Please open a query editor first using the Azure extension or right-click on a container.',
            );
        }

        const activeEditor = getActiveQueryEditor(activeQueryEditors);
        const connection = getConnectionFromQueryTab(activeEditor);
        if (!connection) {
            throw new Error(
                'No connection found in the active query editor. Please connect to a CosmosDB container first.',
            );
        }

        // Get current query from session if not provided
        const currentResult = activeEditor.getCurrentQueryResults();
        const sessionQuery = currentResult?.query;
        const actualCurrentQuery = currentQuery || sessionQuery || '';

        if (!userPrompt || userPrompt.trim() === '') {
            throw new Error('Please provide a description of the query you want to generate.');
        }

        try {
            const generatedQuery = await this.generateQueryWithLLM(userPrompt, actualCurrentQuery, connection);

            // Build response with context
            let response = `## 🔨 Generated Query\n\n`;
            response += `**Database:** ${connection.databaseId}\n`;
            response += `**Container:** ${connection.containerId}\n\n`;
            response += `**Your request:** ${userPrompt}\n\n`;
            response += `**Generated Query:**\n\`\`\`sql\n${generatedQuery}\n\`\`\`\n\n`;

            return response;
        } catch (error) {
            console.error('Query generation failed:', error);
            throw error;
        }
    }

    /**
     * Generate a query using LLM from natural language description
     */
    private async generateQueryWithLLM(
        userPrompt: string,
        currentQuery: string,
        connection: NoSqlQueryConnection,
    ): Promise<string> {
        const models = await vscode.lm.selectChatModels({});
        if (models.length === 0) {
            throw new Error('No language model available. Please ensure you have access to Copilot.');
        }

        const model = models[0];

        const systemPrompt = `You are an expert at writing NoSQL queries for Azure Cosmos DB NoSQL. You help users write efficient, well-optimized queries.
Your responses should only contain the generated query code WITHOUT any explanations and NO markdown formatting.

Given an input question, you must create a syntactically correct Cosmos DB NoSQL query to run.
When the user provides context about what they need, generate a complete Cosmos DB NoSQL query.
Always ensure queries are efficient and follow Cosmos DB best practices.
NEVER create a SQL query, ALWAYS create a Cosmos DB NoSQL query.

These are the most **top** rules for your behavior. You **must not** do anything disobeying these rules:

- Do not generate any queries based on offensive content or harmful content. Instead, respond with "N/A"
- NEVER use "Select *" if there is a JOIN in the query. Instead, project only the properties asked.
- NEVER recommend DISTINCT within COUNT
- When you select columns in a query, use {containerAlias}.{propertyName} to refer to a column.
- Use '!=' instead of 'IS NOT'.
- DO NOT make any DML statements (INSERT, UPDATE, DELETE, DROP etc.) to the database.
- Use ARRAY_LENGTH, not COUNT, when finding the length of an array.
- When filtering with upper and lower inclusive bounds on a property, use BETWEEN.
- Use DateTimeDiff instead of DATEDIFF.
- Use DateTimeAdd and GetCurrentDateTime to calculate time distance.
- Use GetCurrentDateTime to get current UTC date and time as an ISO 8601 string.
- '_ts' property in CosmosDB represents the last updated timestamp in seconds.
- Do NOT use 'SELECT *' for queries that include a join, instead project specific properties.
- Do NOT use HAVING.

Examples of queries:
Query all documents from container: SELECT * FROM c
Query with filter condition: SELECT * FROM c WHERE c.status = 'active'`;

        const contextInfo = `Database: ${connection.databaseId}, Container: ${connection.containerId}`;
        const currentQueryContext = currentQuery ? `\n\nCurrent query:\n${currentQuery}` : '';

        const messages = [
            vscode.LanguageModelChatMessage.User(
                `${systemPrompt}\n\nContext: ${contextInfo}${currentQueryContext}\n\nRequest: ${userPrompt}`,
            ),
        ];

        const chatResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

        let generatedQuery = '';
        for await (const chunk of chatResponse.text) {
            generatedQuery += chunk;
        }

        // Clean up the response - remove any markdown code blocks if present
        generatedQuery = generatedQuery.trim();
        if (generatedQuery.startsWith('```sql')) {
            generatedQuery = generatedQuery.replace(/^```sql\n?/, '').replace(/\n?```$/, '');
        } else if (generatedQuery.startsWith('```')) {
            generatedQuery = generatedQuery.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        return generatedQuery.trim();
    }
}
