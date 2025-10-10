/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { KeyValueStore } from '../KeyValueStore';
import { noSqlQueryConnectionKey, type NoSqlQueryConnection } from '../cosmosdb/NoSqlCodeLensProvider';
import { ext } from '../extensionVariables';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { CosmosDbOperationsService } from './CosmosDbOperationsService';
import { OperationParser } from './OperationParser';

// Extended interface for newer ChatRequest API that includes model property
interface ExtendedChatRequest extends vscode.ChatRequest {
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
     * Extracts context from active query editors including current query and results
     */
    private getQueryEditorContext(): string {
        try {
            // Get active query editor tabs
            const activeQueryEditors = Array.from(QueryEditorTab.openTabs);

            let context = '';

            // Check for active database connections
            // if (ext.connectedMongoDB) {
            //     context += `\n\n## Connected Database Context\n`;
            //     context += `### MongoDB Connection: ${ext.connectedMongoDB.label}\n`;
            //     context += `Database: ${ext.connectedMongoDB.databaseName || ext.connectedMongoDB.label}\n`;
            //     if (ext.connectedMongoDB.connectionString) {
            //         // Extract server info without exposing credentials
            //         const serverInfo = ext.connectedMongoDB.connectionString.replace(/\/\/[^@]*@/, '//***@');
            //         context += `Server: ${serverInfo}\n`;
            //     }
            // }

            if (ext.connectedPostgresDB) {
                if (!context) {
                    context = '\n\n## Connected Database Context\n';
                }
                context += `### PostgreSQL Connection: ${ext.connectedPostgresDB.label}\n`;
                context += `Database: ${ext.connectedPostgresDB.databaseName || ext.connectedPostgresDB.label}\n`;
            }

            // Check for active query editor tabs first (priority over text editor)
            if (activeQueryEditors.length > 0) {
                const activeQueryEditor = activeQueryEditors[0];
                const result = activeQueryEditor.getCurrentQueryResults();

                if (!context) {
                    context = '\n\n## Query Editor Context\n';
                }
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
            }
            // Check for active text editor with relevant file types (fallback)
            else {
                const activeTextEditor = vscode.window.activeTextEditor;
                if (activeTextEditor?.document) {
                    const doc = activeTextEditor.document;
                    const queryText = doc.getText();

                    if (queryText.trim()) {
                        // Handle NoSQL queries
                        if (doc.languageId === 'nosql' || doc.fileName.endsWith('.nosql')) {
                            if (!context) context = '\n\n## Query Editor Context\n';
                            context += `\n### Current NoSQL Query (Text Editor):\n\`\`\`sql\n${queryText}\n\`\`\`\n`;
                        }
                        // Handle MongoDB queries
                        else if (doc.languageId === 'mongo' || doc.fileName.endsWith('.mongo')) {
                            if (!context) context = '\n\n## Query Editor Context\n';
                            context += `\n### Current MongoDB Script:\n\`\`\`javascript\n${queryText}\n\`\`\`\n`;
                        }
                        // Handle PostgreSQL queries
                        else if (doc.languageId === 'postgres' || doc.fileName.endsWith('.psql')) {
                            if (!context) context = '\n\n## Query Editor Context\n';
                            context += `\n### Current PostgreSQL Query:\n\`\`\`sql\n${queryText}\n\`\`\`\n`;
                        }
                    }
                }
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

Available operations: connect, editQuery, explainQuery, help

Return JSON with operation and parameters. Examples:
- "connect to languye-nosql" → {"operation": "connect", "parameters": {"target": "languye-nosql"}}
- "improve this query: SELECT * FROM c" → {"operation": "editQuery", "parameters": {"currentQuery": "SELECT * FROM c", "suggestion": "enhanced query"}}
- "explain this query: SELECT * FROM c" → {"operation": "explainQuery", "parameters": {"query": "SELECT * FROM c"}}
- "help" → {"operation": "help", "parameters": {}}

Only return valid JSON, no other text, no end-of-line characters:`;

            const messages = [vscode.LanguageModelChatMessage.User(intentPrompt)];
            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

            let jsonText = '';
            for await (const fragment of response.text) {
                jsonText += fragment;
            }

            const result = JSON.parse(jsonText.trim()) as { operation: string; parameters: Record<string, unknown> };
            return result && result.operation ? result : null;
        } catch (error) {
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
- For "connect to languye-nosql": {"target": "languye-nosql"}
- For "SELECT * FROM c with metrics": {"query": "SELECT * FROM c", "includeMetrics": true}
- For "show info about mydb": {"target": "mydb"}
- For "disconnect": {}

Only return valid JSON, no other text:`;

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

        switch (operation) {
            case 'connect': {
                const connectMatch = originalPrompt.match(/connect\s+to\s+([^\s,]+)/i);
                if (connectMatch) {
                    parameters.target = connectMatch[1];
                }
                const simpleConnectMatch = originalPrompt.match(
                    /connect(?:\s+(?:to|database|container))?\s+([^\s,]+)/i,
                );
                if (simpleConnectMatch && !parameters.target) {
                    parameters.target = simpleConnectMatch[1];
                }
                break;
            }
            case 'editQuery': {
                // Pass the full user prompt for LLM processing
                parameters.userPrompt = originalPrompt;

                // Extract current query from prompt if explicitly provided
                const queryMatch = originalPrompt.match(/(?:query|select)\s*:?\s*(.+)/i);
                if (queryMatch) {
                    parameters.currentQuery = queryMatch[1].trim();
                }
                break;
            }
            case 'info': {
                const infoMatch = originalPrompt.match(/info\s+(?:about|for)\s+([^\s,]+)/i);
                if (infoMatch) {
                    parameters.target = infoMatch[1];
                }
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
     * Detects user intent based on request context, references, and prompt
     */
    private detectIntent(
        request: vscode.ChatRequest,
    ): { operation: string; parameters: Record<string, unknown> } | null {
        const prompt = request.prompt.toLowerCase().trim();

        // Intent detection based on context and references (not just text parsing)

        // 1. Check for file references (user selected/referenced files)
        if (request.references.length > 0) {
            const hasQueryFile = request.references.some(
                (ref) =>
                    ref.value instanceof vscode.Uri &&
                    (ref.value.path.endsWith('.nosql') || ref.value.path.endsWith('.sql')),
            );

            if (hasQueryFile) {
                return {
                    operation: 'executeQuery',
                    parameters: {
                        query: prompt || 'SELECT * FROM c',
                        includeMetrics: prompt.includes('metrics') || prompt.includes('performance'),
                    },
                };
            }
        }

        // 2. Check current context (what user is working on)
        const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
        if (activeQueryEditors.length > 0) {
            // User has active query editor - check for edit/improve intents
            if (
                prompt.includes('edit') ||
                prompt.includes('improve') ||
                prompt.includes('optimize') ||
                prompt.includes('enhance')
            ) {
                const activeEditor = activeQueryEditors[0];
                const result = activeEditor.getCurrentQueryResults();

                // Build rich context for the editQuery operation
                let explanation = 'Query optimization based on session context';

                if (result?.requestCharge && result.requestCharge > 10) {
                    explanation += ' - High RU consumption detected';
                }
                if (result?.documents && result.documents.length > 100) {
                    explanation += ' - Large result set detected';
                }

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

        const activeTextEditor = vscode.window.activeTextEditor;
        if (activeTextEditor?.document.languageId === 'nosql') {
            // User has NoSQL file open - check for edit intents
            if (prompt.includes('edit') || prompt.includes('improve') || prompt.includes('optimize')) {
                return {
                    operation: 'editQuery',
                    parameters: {
                        currentQuery: activeTextEditor.document.getText() || 'SELECT * FROM c',
                        userPrompt: prompt, // Pass the user's original prompt for LLM
                    },
                };
            }
        }

        // 3. Intent keywords (more semantic than parsing) with parameter extraction
        const intentKeywords = {
            connect: ['connect', 'connection', 'database', 'container'],
            info: ['info', 'status', 'current', 'connected', 'what', 'where'],
            editQuery: ['edit', 'improve', 'optimize', 'enhance', 'suggest', 'modify', 'update', 'query'],
            explainQuery: ['explain', 'describe', 'analyze', 'breakdown', 'understand', 'what does', 'how does'],
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
            stream.markdown(result);

            // Add contextual suggestions
            const connection = KeyValueStore.instance.get(noSqlQueryConnectionKey) as NoSqlQueryConnection;
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
                case 'connect':
                    operationName = 'connect';
                    break;
                case 'editQuery':
                    operationName = 'editQuery';
                    break;
                case 'explainQuery':
                    operationName = 'explainQuery';
                    break;
                case 'info':
                    operationName = 'getConnectionInfo';
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
                    // Fallback to basic parameter extraction
                    if (operationName === 'executeQuery') {
                        parameters = {
                            query: request.prompt || 'SELECT * FROM c',
                            includeMetrics: request.prompt.toLowerCase().includes('metrics'),
                        };
                    }
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
                }
            }
            const result = await operationsService.executeOperation(operationName, parameters);
            stream.markdown(result);

            // Add suggestions for next operations
            const connection = KeyValueStore.instance.get(noSqlQueryConnectionKey) as NoSqlQueryConnection;
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
     * Handles help command requests
     */
    private handleHelpCommand(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        const helpText = `## 🚀 CosmosDB Assistant Commands

### **Quick Commands:**
- \`@cosmosdb /connect\` - Connect to a CosmosDB container
- \`@cosmosdb /editQuery\` - Edit and improve queries in active query editor with AI suggestions
- \`@cosmosdb /explainQuery\` - Explain the current query with AI analysis
- \`@cosmosdb /info\` - Show connection information
- \`@cosmosdb /help\` - Show this help

### **Natural Language:**
You can also use natural language:
- "connect to my database"
- "improve my current query" (requires active query editor)
- "optimize this query" (modifies query in active editor)
- "explain this query" (analyzes current query in active editor)
- "what does my query do?" (explains query purpose and components)
- "what am I connected to?"
- "enhance my SQL statement" (updates active query editor)

### **Current Features:**
- 🔗 Connection management
- 🤖 AI-powered query optimization
- 📊 AI-powered query explanation and analysis
- 🎯 Context-aware responses
- 💡 Smart suggestions with user confirmation
- 📝 Query editor integration
- ✨ LLM-enhanced query improvements

Ask me anything about Azure Cosmos DB! 💪`;

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
                const models = await vscode.lm.selectChatModels({
                    vendor: 'copilot',
                });

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
- "connect" - Connect to a CosmosDB container
- "editQuery" - Edit and improve queries with AI suggestions (uses active query session data)
- "connection info" - Show current connection details
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
                const connection = KeyValueStore.instance.get(noSqlQueryConnectionKey) as NoSqlQueryConnection;
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
