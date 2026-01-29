/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { CosmosDbOperationsService, type EditQueryResult } from './CosmosDbOperationsService';
import { OperationParser } from './OperationParser';
import { getActiveQueryEditor, getConnectionFromQueryTab } from './chatUtils';

// Interface for ChatRequest with optional model property (for compatibility with different VS Code versions)
interface ExtendedChatRequest {
    prompt: string;
    command?: string;
    model?: vscode.LanguageModelChat;
}

/**
 * A CosmosDB chat participant that forwards requests to an LLM for intelligent responses.
 */
export class CosmosDbChatParticipant {
    private participant: vscode.ChatParticipant;

    constructor(context: vscode.ExtensionContext) {
        // Create the chat participant with the ID 'cosmosdb'
        this.participant = vscode.chat.createChatParticipant(
            'cosmosdb',
            this.handleChatRequest.bind(this) as vscode.ChatRequestHandler,
        );

        // Set the icon to the specific CosmosDB logo
        this.participant.iconPath = vscode.Uri.joinPath(
            context.extensionUri,
            'resources',
            'icons',
            'theme-agnostic',
            'CosmosDBAccount.svg',
        );

        // Add to context subscriptions for proper cleanup
        context.subscriptions.push(this.participant);
    }

    /**
     * Extracts context from active query editors including current query, results, and schema.
     * Groups query execution history for better LLM understanding.
     */
    private getQueryEditorContext(): string {
        try {
            // Get active query editor tabs
            const activeQueryEditors = Array.from(QueryEditorTab.openTabs);

            if (activeQueryEditors.length === 0) {
                return '';
            }

            const activeQueryEditor = getActiveQueryEditor(activeQueryEditors);
            const operationsService = CosmosDbOperationsService.getInstance();

            // Get grouped query history context
            const historyContext = operationsService.getQueryHistoryContext(activeQueryEditor);

            if (historyContext) {
                // Use the service's formatted grouped context
                let context = '\n\n## Query Editor Context\n';
                context += `The user has an active Cosmos DB NoSQL query editor with session data.\n\n`;
                context += operationsService.formatQueryHistoryForLLM(historyContext);
                return context;
            }

            // Fallback to basic context if no history available
            const result = activeQueryEditor.getCurrentQueryResults();
            let context = '\n\n## Query Editor Context\n';
            context += `\n### Active Query Editor Session\n`;
            context += `The user has an active Cosmos DB NoSQL query editor with session data.\n`;

            if (result?.query) {
                context += `### Current Query:\n\`\`\`sql\n${result.query}\n\`\`\`\n`;
            }

            if (result?.documents && result.documents.length > 0) {
                context += `### Query Results Context:\n`;
                context += `- Documents returned: ${result.documents.length}\n`;
                if (result.requestCharge) {
                    context += `- Request charge: ${result.requestCharge} RUs\n`;
                }
                context += `- Sample result structure: ${JSON.stringify(result.documents[0], null, 2).substring(0, 200)}...\n`;
            }

            if (result?.metadata) {
                context += `### Query Metadata Available\n`;
                context += `- Execution context and performance metrics are available for optimization\n`;
            }

            return context;
        } catch (error) {
            console.error('Error getting query editor context:', error);
            return '';
        }
    }

    /**
     * Uses LLM for complete intent and parameter extraction - the ideal approach
     */
    private async extractIntentWithLLM(
        originalPrompt: string,
        model: vscode.LanguageModelChat,
    ): Promise<{ operation: string; parameters: Record<string, unknown> } | null> {
        try {
            const intentPrompt = `Analyze this CosmosDB user request and extract the intent and parameters.

User request: "${originalPrompt}"

Available operations: editQuery, explainQuery, generateQuery, help

Return JSON with operation and parameters. Examples:
- "improve this query: SELECT * FROM c" → {"operation": "editQuery", "parameters": {"currentQuery": "SELECT * FROM c", "suggestion": "enhanced query"}}
- "explain this query: SELECT * FROM c" → {"operation": "explainQuery", "parameters": {"query": "SELECT * FROM c"}}
- "generate a query to find all active users" → {"operation": "generateQuery", "parameters": {"userPrompt": "find all active users"}}
- "create a query for orders over $100" → {"operation": "generateQuery", "parameters": {"userPrompt": "orders over $100"}}
- "help" → {"operation": "help", "parameters": { "topic": "partition key choice" }}
- if intent does not map any of the available operations: {}

Only return valid a JSON string. ** Do not return markdown format such as \`\`\`json \`\`\` **. Do not include any other text, nor end-of-line characters such as \\n.
** RETURN ONLY STRINGS THAT JSON.parse() CAN PARSE **`;

            const messages = [vscode.LanguageModelChatMessage.User(intentPrompt)];
            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

            let jsonText = '';
            for await (const fragment of response.text) {
                jsonText += fragment;
            }

            if (jsonText.trim() === '{}') {
                return null;
            }

            const result = JSON.parse(jsonText.trim()) as { operation: string; parameters: Record<string, unknown> };
            return result && result.operation ? result : null;
        } catch (error) {
            // TODO Add telemetry
            console.warn('LLM intent extraction failed, falling back to rule-based:', error);
            return null;
        }
    }

    /**
     * Uses LLM to extract parameters from user prompt - much smarter than regex parsing
     */
    private async extractParametersWithLLM(
        operation: string,
        originalPrompt: string,
        model: vscode.LanguageModelChat,
    ): Promise<Record<string, unknown>> {
        try {
            const extractionPrompt = `Extract structured parameters from this user request for a ${operation} operation.

User request: "${originalPrompt}"

Return JSON with relevant parameters. Examples:
- For "SELECT * FROM c with metrics": {"query": "SELECT * FROM c", "includeMetrics": true}
- For "show info about mydb": {"target": "mydb"}
Only return valid JSON, no other text.
** RETURN ONLY STRINGS THAT JSON.parse() CAN PARSE **`;

            const messages = [vscode.LanguageModelChatMessage.User(extractionPrompt)];
            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

            let jsonText = '';
            for await (const fragment of response.text) {
                jsonText += fragment;
            }

            // Parse the JSON response
            const parameters = JSON.parse(jsonText.trim()) as Record<string, unknown>;
            return parameters && typeof parameters === 'object' ? parameters : {};
        } catch (error) {
            console.warn('LLM parameter extraction failed, falling back to regex:', error);
            return this.extractParametersWithRegex(operation, originalPrompt);
        }
    }

    /**
     * Fallback regex-based parameter extraction (legacy approach)
     */
    private extractParametersWithRegex(operation: string, originalPrompt: string): Record<string, unknown> {
        const parameters: Record<string, unknown> = {};
        const lowercasePrompt = originalPrompt.toLowerCase();

        // Extract query from code block if present (works for any operation)
        const codeBlockMatch = originalPrompt.match(/```(?:sql)?\s*([\s\S]*?)```/i);
        if (codeBlockMatch) {
            parameters.currentQuery = codeBlockMatch[1].trim();
        }

        switch (operation) {
            case 'editQuery': {
                // Pass the full user prompt for LLM processing
                parameters.userPrompt = originalPrompt;

                // Extract current query from prompt if explicitly provided (and not already from code block)
                if (!parameters.currentQuery) {
                    const queryMatch = originalPrompt.match(/(?:query|select)\s*:?\s*(.+)/i);
                    if (queryMatch) {
                        parameters.currentQuery = queryMatch[1].trim();
                    }
                }
                break;
            }
            case 'explainQuery': {
                // Pass the full user prompt for context
                parameters.userPrompt = originalPrompt;
                break;
            }
            default: {
                if (lowercasePrompt.includes('metrics') || lowercasePrompt.includes('performance')) {
                    parameters.includeMetrics = true;
                }
                break;
            }
        }

        return parameters;
    }

    /**
     * Detects user intent based on request context, and prompt
     */
    private detectIntent(
        request: vscode.ChatRequest,
    ): { operation: string; parameters: Record<string, unknown> } | null {
        const prompt = request.prompt.toLowerCase().trim();

        // Intent detection based on context  (not just text parsing)

        // 1. Check current context (what user is working on)
        const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
        if (activeQueryEditors.length > 0) {
            // User has active query editor - check for edit/improve intents
            if (
                prompt.includes('edit') ||
                prompt.includes('improve') ||
                prompt.includes('optimize') ||
                prompt.includes('enhance')
            ) {
                const activeEditor = getActiveQueryEditor(activeQueryEditors);
                const result = activeEditor.getCurrentQueryResults();

                // Build rich context for the editQuery operation
                const explanation = 'Query optimization based on session context';

                return {
                    operation: 'editQuery',
                    parameters: {
                        currentQuery: result?.query || 'SELECT * FROM c',
                        userPrompt: prompt, // Pass the user's original prompt for LLM
                        explanation,
                        // Pass session context for LLM
                        sessionContext: {
                            documentCount: result?.documents?.length || 0,
                            requestCharge: result?.requestCharge || 0,
                            hasResults: !!(result?.documents && result.documents.length > 0),
                        },
                    },
                };
            }
        }

        // 2. Intent keywords (more semantic than parsing) with parameter extraction
        const intentKeywords = {
            editQuery: ['edit', 'improve', 'optimize', 'enhance', 'suggest', 'modify', 'update', 'query'],
            explainQuery: ['explain', 'describe', 'analyze', 'breakdown', 'understand', 'what does', 'how does'],
            generateQuery: ['generate', 'create', 'write', 'make', 'build', 'new query', 'query for', 'query to'],
            help: ['help', 'commands', 'what can', 'how to'],
        };

        for (const [operation, keywords] of Object.entries(intentKeywords)) {
            if (keywords.some((keyword) => prompt.includes(keyword))) {
                // Extract parameters based on operation type using regex (LLM extraction happens at higher level)
                const parameters = this.extractParametersWithRegex(operation, request.prompt);
                return { operation, parameters };
            }
        }

        return null;
    }

    /**
     * Handles intent-based requests (context-aware, not just text parsing)
     */
    private async handleIntentBasedRequest(
        request: vscode.ChatRequest,
        intent: { operation: string; parameters: Record<string, unknown> },
        stream: vscode.ChatResponseStream,
        _token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult> {
        const operationsService = CosmosDbOperationsService.getInstance();

        stream.markdown(`🎯 **Detected Intent:** ${intent.operation}\n\n`);

        if (intent.operation === 'help') {
            return this.handleHelpCommand(stream);
        }

        try {
            // Map intent operation to actual operation
            let operationName = intent.operation;
            let parameters = intent.parameters;

            // Handle special cases
            if (intent.operation === 'editQuery' && request.prompt.trim()) {
                operationName = 'editQuery';
                parameters = {
                    currentQuery: intent.parameters.currentQuery || '',
                    userPrompt: request.prompt, // Pass the full user prompt for LLM processing
                    explanation: 'Query optimization based on AI analysis',
                };
            }

            const result = await operationsService.executeOperation(operationName, parameters);

            // Handle editQuery results specially with buttons
            if (typeof result === 'object' && result.type === 'editQuery') {
                this.handleEditQueryResult(result, stream);
            } else {
                stream.markdown(result as string);
            }

            // Add contextual suggestions
            const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
            const activeEditor = activeQueryEditors.length > 0 ? getActiveQueryEditor(activeQueryEditors) : null;
            const connection = activeEditor ? getConnectionFromQueryTab(activeEditor) : undefined;
            const suggestions = OperationParser.generateSuggestions(!!connection);
            stream.markdown(suggestions);

            return { metadata: { command: 'cosmosdb', operation: intent.operation, method: 'intent' } };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`❌ Intent-based operation failed: ${errorMessage}`);
            return { metadata: { command: 'cosmosdb', error: errorMessage } };
        }
    }

    /**
     * Handles structured command requests with explicit commands
     */
    private async handleStructuredCommand(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        _token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult> {
        const operationsService = CosmosDbOperationsService.getInstance();

        stream.markdown(`🔧 **Executing Command:** ${request.command}\n\n`);

        // Try to get language model for parameter extraction
        let languageModel: vscode.LanguageModelChat | null = null;
        const extendedReq = request as ExtendedChatRequest;
        if (extendedReq.model) {
            languageModel = extendedReq.model;
        } else {
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            if (models.length > 0) {
                languageModel = models[0];
            }
        }

        try {
            let operationName: string;
            let parameters: Record<string, unknown> = {};

            // Map command to operation name
            switch (request.command) {
                case 'editQuery':
                    operationName = 'editQuery';
                    break;
                case 'explainQuery':
                    operationName = 'explainQuery';
                    break;
                case 'generateQuery':
                    operationName = 'generateQuery';
                    break;
                case 'help':
                    return await this.handleHelpCommand(stream);
                default:
                    operationName = request.command || 'help';
                    break;
            }

            // Use LLM to extract parameters if available, otherwise fallback to basic extraction
            if (languageModel && request.prompt.trim()) {
                try {
                    parameters = await this.extractParametersWithLLM(operationName, request.prompt, languageModel);
                    stream.markdown(`🧠 **LLM Extracted Parameters:** ${JSON.stringify(parameters)}\n\n`);
                } catch (error) {
                    console.warn('LLM parameter extraction failed, using basic extraction:', error);
                }
            } else {
                // Basic parameter extraction when no LLM available
                if (operationName === 'editQuery') {
                    parameters = {
                        currentQuery: '', // Will be detected from active query editor
                        userPrompt: request.prompt || 'optimize this query',
                        explanation: 'Standard query improvements',
                    };
                } else if (operationName === 'explainQuery') {
                    parameters = {
                        currentQuery: '', // Will be detected from active query editor
                        userPrompt: request.prompt || 'explain this query',
                    };
                } else if (operationName === 'generateQuery') {
                    parameters = {
                        currentQuery: '', // Will be detected from active query editor
                        userPrompt: request.prompt || '',
                    };
                }
            }
            const result = await operationsService.executeOperation(operationName, parameters);

            // Handle editQuery results specially with buttons
            if (typeof result === 'object' && result.type === 'editQuery') {
                this.handleEditQueryResult(result, stream);
            } else {
                stream.markdown(result as string);
            }

            // Add suggestions for next operations
            const currentActiveEditors = Array.from(QueryEditorTab.openTabs);
            const currentActiveEditor =
                currentActiveEditors.length > 0 ? getActiveQueryEditor(currentActiveEditors) : null;
            const connection = currentActiveEditor ? getConnectionFromQueryTab(currentActiveEditor) : undefined;
            const suggestions = OperationParser.generateSuggestions(!!connection);
            stream.markdown(suggestions);

            return { metadata: { command: 'cosmosdb', operation: request.command } };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`❌ Command failed: ${errorMessage}`);
            return { metadata: { command: 'cosmosdb', error: errorMessage } };
        }
    }

    /**
     * Handles editQuery results by showing the query diff and action buttons
     */
    private handleEditQueryResult(result: EditQueryResult, stream: vscode.ChatResponseStream): void {
        // Show query context
        let queryContext = `**Current Query Context:**\n`;
        queryContext += `- **Database:** ${result.queryContext.databaseId}\n`;
        queryContext += `- **Container:** ${result.queryContext.containerId}\n`;
        if (result.queryContext.documentCount !== undefined) {
            queryContext += `- **Last Results:** ${result.queryContext.documentCount} documents returned\n`;
            if (result.queryContext.requestCharge !== undefined) {
                queryContext += `- **Request Charge:** ${result.queryContext.requestCharge.toFixed(2)} RUs\n`;
            }
        }
        queryContext += `\n`;

        stream.markdown(queryContext);

        // Show current query
        stream.markdown(`**Current Query:**\n\`\`\`sql\n${result.currentQuery}\n\`\`\`\n\n`);

        // Show suggested query
        stream.markdown(`**Suggested Query:**\n\`\`\`sql\n${result.suggestedQuery}\n\`\`\`\n\n`);

        // Show explanation
        if (result.explanation) {
            stream.markdown(`**Explanation:** ${result.explanation}\n\n`);
        }

        stream.button({
            command: 'cosmosDB.applyQuerySuggestion',
            title: '✅ Update Query',
            arguments: [result.connection, result.suggestedQuery],
        });

        stream.button({
            command: 'cosmosDB.openQuerySideBySide',
            title: '🔍 Open Side-by-Side',
            arguments: [result.connection, result.suggestedQuery],
        });

        stream.markdown('\n');
    }

    /**
     * Handles help command requests
     */
    private handleHelpCommand(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        const helpText = `## Cosmos DB (NoSQL) Assistant Commands

### **Quick Commands:**
- \`@cosmosdb /editQuery\` - Edit and improve queries in active query editor with AI suggestions
- \`@cosmosdb /explainQuery\` - Explain the current query with AI analysis
- \`@cosmosdb /generateQuery\` - Generate a new query from natural language description
- \`@cosmosdb /help\` - Show this help

### **Natural Language:**
You can also use natural language:
- "improve my current query" (requires active query editor)
- "optimize this query" (modifies query in active editor)
- "explain this query" (analyzes current query in active editor)
- "what does my query do?" (explains query purpose and components)
- "generate a query to find all users" (creates a new query from description)

### **Features:**
- 🤖 AI query editing & optimization
- 📊 Query explanation
- ✨ AI-powered query generation from natural language

For more information, visit the [Azure Cosmos DB documentation](https://learn.microsoft.com/azure/cosmos-db/).`;

        stream.markdown(helpText);
        return Promise.resolve({ metadata: { command: 'cosmosdb', operation: 'help' } });
    }

    /**
     * Handles chat requests for the @cosmosdb participant by forwarding to the model from the request
     */
    private async handleChatRequest(
        request: vscode.ChatRequest,
        _context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult> {
        try {
            // Check if there's an active connection or query editor
            const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
            const hasConnection = activeQueryEditors.length > 0;

            if (!hasConnection) {
                stream.markdown('⚠️ **No Cosmos DB connection found.**\n\n');
                stream.markdown('Please connect to a Cosmos DB container to use the chat assistant.\n\n');

                // Add a button to open the query editor which will prompt for connection
                stream.button({
                    command: 'cosmosDB.openNoSqlQueryEditor',
                    title: '🔌 Open Query Editor',
                    arguments: [],
                });

                return { metadata: { command: '', result: 'No connection' } };
            }

            // Check if this is a structured command request (explicit intent)
            if (request.command) {
                return await this.handleStructuredCommand(request, stream, token);
            }

            // Try to get a language model for LLM-based intent detection
            let languageModel: vscode.LanguageModelChat | null = null;
            const extendedReq = request as ExtendedChatRequest;
            if (extendedReq.model) {
                languageModel = extendedReq.model;
            } else {
                const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
                if (models.length > 0) {
                    languageModel = models[0];
                }
            }

            // First try LLM-based intent detection (most intelligent approach)
            if (languageModel) {
                const llmIntent = await this.extractIntentWithLLM(request.prompt, languageModel);
                if (llmIntent) {
                    stream.markdown(`🧠 **LLM Detected Intent:** ${llmIntent.operation}\n`);
                    if (Object.keys(llmIntent.parameters).length > 0) {
                        stream.markdown(`**Parameters:** ${JSON.stringify(llmIntent.parameters)}\n\n`);
                    } else {
                        stream.markdown('\n');
                    }
                    return await this.handleIntentBasedRequest(request, llmIntent, stream, token);
                }
            }

            // Fallback: Check for intent based on context and references
            const intent = this.detectIntent(request);
            if (intent) {
                return await this.handleIntentBasedRequest(request, intent, stream, token);
            }

            // Try to use the model from the request if available, otherwise fall back to selecting one
            let model: vscode.LanguageModelChat;

            // Check if the request has a model property (newer API)
            const extendedRequest = request as ExtendedChatRequest;
            if (extendedRequest.model) {
                model = extendedRequest.model;
            } else {
                // Fall back to selecting available models
                const models = await vscode.lm.selectChatModels({});

                if (models.length === 0) {
                    stream.markdown('❌ No language model available. Please ensure GitHub Copilot is enabled.');
                    return { metadata: { command: 'cosmosdb' } };
                }

                model = models[0];
            }

            // Get query editor context if available
            const queryEditorContext = this.getQueryEditorContext();

            // Create system message with CosmosDB context
            let systemPrompt = `You are a helpful assistant specialized in Azure Cosmos DB.
You help users with:
- CosmosDB concepts and best practices
- Query optimization and troubleshooting (using actual query execution data when available)
- SDK usage and code examples
- Database design and modeling
- Performance tuning based on RU consumption and result patterns
- Cost optimization

You can also perform operations like:
- "editQuery" - Edit and improve queries with AI suggestions (uses active query session data)
- "help" - Show available commands and features

When helping with query optimization, use the provided query session context including:
- Current query text and structure
- Actual execution results and document counts
- Request charge (RU) consumption
- Sample result data structure
- Performance metadata when available

Please provide helpful, accurate, and actionable responses about Cosmos DB. If asked about something outside of Cosmos DB, politely redirect the conversation back to Cosmos DB topics.`;

            // Add query editor context if available
            if (queryEditorContext) {
                systemPrompt += `\n\n${queryEditorContext}`;
                systemPrompt += `\n\nThe user may be asking about the query shown above or related query operations. Use this context to provide more relevant and specific assistance.`;
                systemPrompt += `\n\nUse azure mcp to answer questions about cosmos db or respond I don't know`;
            }

            const systemMessage = vscode.LanguageModelChatMessage.User(systemPrompt);

            const userMessage = vscode.LanguageModelChatMessage.User(request.prompt);

            // Send request to language model
            const chatResponse = await model.sendRequest([systemMessage, userMessage], {}, token);

            // Stream the response
            try {
                for await (const fragment of chatResponse.text) {
                    stream.markdown(fragment);

                    if (token.isCancellationRequested) {
                        break;
                    }
                }

                // Add operation suggestions after LLM response
                const suggestionsActiveEditors = Array.from(QueryEditorTab.openTabs);
                const suggestionsActiveEditor =
                    suggestionsActiveEditors.length > 0 ? getActiveQueryEditor(suggestionsActiveEditors) : null;
                const connection = suggestionsActiveEditor
                    ? getConnectionFromQueryTab(suggestionsActiveEditor)
                    : undefined;
                const suggestions = OperationParser.generateSuggestions(!!connection);
                stream.markdown(suggestions);
            } catch (error) {
                console.error('Error streaming chat response:', error);
            }

            return { metadata: { command: 'cosmosdb' } };
        } catch (error) {
            // Handle errors gracefully
            console.error('CosmosDB chat participant error:', error);

            if (error instanceof vscode.LanguageModelError) {
                // Handle specific language model errors
                stream.markdown('❌ Language model error: ' + error.message);
            } else {
                stream.markdown('❌ An error occurred while processing your request. Please try again.');
            }

            return { metadata: { command: 'cosmosdb', error: String(error) } };
        }
    }
}
