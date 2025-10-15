/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlCodeLensProvider';
import { QueryEditorTab } from '../panels/QueryEditorTab';

export interface CosmosDbOperation {
    name: string;
    description: string;
    parameters: { name: string; type: string; required: boolean; description: string }[];
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
     * Get list of available operations
     */
    public getAvailableOperations(): CosmosDbOperation[] {
        return [
            {
                name: 'editQuery',
                description:
                    'Edit query in active query editor with LLM suggestions and user confirmation using session context',
                parameters: [
                    {
                        name: 'currentQuery',
                        type: 'string',
                        required: false,
                        description: 'Current query to edit (auto-detected from active session)',
                    },
                    {
                        name: 'userPrompt',
                        type: 'string',
                        required: true,
                        description: 'User prompt describing desired query changes',
                    },
                    { name: 'explanation', type: 'string', required: false, description: 'Explanation of the change' },
                    {
                        name: 'sessionContext',
                        type: 'object',
                        required: false,
                        description: 'Query session context (RU consumption, result count, etc.)',
                    },
                ],
            },
            {
                name: 'getConnectionInfo',
                description: 'Get information about current connection',
                parameters: [],
            },
            {
                name: 'listDatabases',
                description: 'List available databases in the current account',
                parameters: [],
            },
            {
                name: 'explainQuery',
                description: 'Explain the current query from active query editor with AI analysis',
                parameters: [
                    {
                        name: 'currentQuery',
                        type: 'string',
                        required: false,
                        description: 'Current query to explain (auto-detected from active session)',
                    },
                    {
                        name: 'userPrompt',
                        type: 'string',
                        required: false,
                        description: 'Additional context or specific questions about the query',
                    },
                ],
            },
        ];
    }

    /**
     * Execute a CosmosDB operation
     */
    public async executeOperation(operationName: string, parameters: Record<string, unknown> = {}): Promise<string> {
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

                default:
                    throw new Error(`Unknown operation: ${operationName}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return `❌ Error executing ${operationName}: ${errorMessage}`;
        }
    }

    private async handleEditQuery(currentQuery: string, userPrompt: string, explanation?: string): Promise<string> {
        // Check if there's an active query editor
        const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
        if (activeQueryEditors.length === 0) {
            throw new Error(
                'No active query editor found. Please open a query editor first using the Azure extension or right-click on a container.',
            );
        }

        const activeEditor = activeQueryEditors[0]; // Use the first active editor
        const connection = this.getConnectionFromQueryTab(activeEditor);
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

        // Build context for better user understanding
        let queryContext = `**Current Query Context:**\n`;
        queryContext += `- **Database:** ${connection.databaseId}\n`;
        queryContext += `- **Container:** ${connection.containerId}\n`;
        if (hasResults) {
            queryContext += `- **Last Results:** ${documentCount} documents returned\n`;
            if (requestCharge) {
                queryContext += `- **Request Charge:** ${requestCharge.toFixed(2)} RUs\n`;
            }
        }
        queryContext += `\n`;

        try {
            // Show the user what changes will be made with context
            const explanationText = llmExplanation ? `\n\n**Explanation:** ${llmExplanation}` : '';
            const message = `🤖 **Query Enhancement Suggestion**

${queryContext}**Current Query:**
\`\`\`sql
${actualCurrentQuery}
\`\`\`

**Suggested Query:**
\`\`\`sql
${suggestion}
\`\`\`${explanationText}

Would you like to apply this change?`;

            const acceptItem: vscode.MessageItem = { title: 'Apply Change' };
            const viewBothItem: vscode.MessageItem = { title: 'Open Both Queries' };

            const choice = await vscode.window.showInformationMessage(
                message,
                { modal: true },
                acceptItem,
                viewBothItem,
            );

            if (choice === acceptItem) {
                // Open the suggested query in a new tab (safer approach)
                QueryEditorTab.render(connection, vscode.ViewColumn.Active, false, suggestion);
                return `✅ **Improved Query Opened**

The suggested query has been opened in a new query editor tab. You can now:
- Execute the improved query
- Compare it with your original query
- Make further modifications as needed

*Original query remains unchanged in your previous tab.*`;
            } else if (choice === viewBothItem) {
                // Open suggested query in a new tab for comparison
                QueryEditorTab.render(connection, vscode.ViewColumn.Two, false, suggestion);
                return `🔍 **Suggested Query Opened for Comparison**

The suggested query has been opened in a new tab alongside your current editor for easy comparison.`;
            } else {
                // User cancelled
                return `❌ **Query Edit Cancelled**

No changes were made to your query.`;
            }
        } catch (error) {
            throw new Error(`Failed to edit query: ${error instanceof Error ? error.message : String(error)}`);
        }
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
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
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
                // Add sample document structure if available
                if (queryResult.documents.length > 0) {
                    const sampleDoc = queryResult.documents[0];
                    const sampleStructure = JSON.stringify(sampleDoc, null, 2).substring(0, 300);
                    contextInfo += `\n\nSample document structure:\n${sampleStructure}...`;
                }
            }

            const llmPrompt = `You are a Cosmos DB query optimization expert. Please improve the following NoSQL query based on the user's request.

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

        const activeEditor = activeQueryEditors[0]; // Use the first active editor
        const connection = this.getConnectionFromQueryTab(activeEditor);
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
        const actualCurrentQuery = sessionQuery || currentQuery;

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
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            if (models.length === 0) {
                throw new Error('No language model available');
            }

            const model = models[0];

            // Build context for LLM
            let contextInfo = `Database: ${connection.databaseId}, Container: ${connection.containerId}`;
            if (queryResult?.documents) {
                contextInfo += `, Last execution: ${queryResult.documents.length} documents`;
                if (queryResult.requestCharge) {
                    contextInfo += `, ${queryResult.requestCharge.toFixed(2)} RUs consumed`;
                }
                // Add sample document structure if available
                if (queryResult.documents.length > 0) {
                    const sampleDoc = queryResult.documents[0];
                    const sampleStructure = JSON.stringify(sampleDoc, null, 2).substring(0, 300);
                    contextInfo += `\n\nSample document structure:\n${sampleStructure}...`;
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
     * Helper method to get connection from a query editor tab
     */
    private getConnectionFromQueryTab(queryTab: QueryEditorTab): NoSqlQueryConnection | undefined {
        return queryTab.getConnection();
    }
}
