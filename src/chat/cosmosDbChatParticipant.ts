/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { areAIFeaturesEnabled } from '../utils/copilotUtils';
import { safeCodeBlock, safeErrorDisplay, safeJsonDisplay, safeMarkdownText } from '../utils/sanitization';
import { CosmosDbOperationsService, type EditQueryResult } from './CosmosDbOperationsService';
import { OperationParser } from './OperationParser';
import { getActiveQueryEditor, getConnectionFromQueryTab, sendChatRequest } from './chatUtils';
import {
    CHAT_PARTICIPANT_SYSTEM_PROMPT,
    INTENT_EXTRACTION_PROMPT,
    PARAMETER_EXTRACTION_PROMPT_TEMPLATE,
    QUERY_EDITOR_CONTEXT_SUFFIX,
} from './systemPrompt';
import { buildIntentExtractionUserContent, buildParameterExtractionUserContent, wrapUserContent } from './userPayload';

// Interface for ChatRequest with optional model property (for compatibility with different VS Code versions)
interface ExtendedChatRequest {
    prompt: string;
    command?: string;
    model?: vscode.LanguageModelChat;
}

/**
 * Stores pending edit query results keyed by a unique ID so that chat button
 * commands can look them up without serializing large objects (connection
 * credentials, full query text) into the button arguments.
 */
export interface PendingEditQueryResult {
    connection: EditQueryResult['connection'];
    suggestedQuery: string;
}

/**
 * A CosmosDB chat participant that forwards requests to an LLM for intelligent responses.
 */
export class CosmosDbChatParticipant {
    /**
     * Map of pending edit-query results. Button commands look up the stored
     * connection & query by the lightweight numeric ID passed as button arg.
     * Old entries are evicted when the map exceeds {@link MAX_PENDING_RESULTS}.
     */
    static readonly pendingResults = new Map<number, PendingEditQueryResult>();
    private static nextResultId = 1;
    private static readonly MAX_PENDING_RESULTS = 20;

    private participant: vscode.ChatParticipant;
    private extensionPath: string;
    private skillContent: string | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.extensionPath = context.extensionPath;

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
     * Loads and caches the Cosmos DB best practices skill content.
     * This is included in the system prompt for free-form chat to provide domain knowledge.
     */
    private getCosmosDbReferenceContext(): string {
        if (this.skillContent === undefined) {
            try {
                this.skillContent = fs.readFileSync(
                    path.join(this.extensionPath, 'skills', 'cosmosdb-best-practices', 'SKILL.md'),
                    'utf-8',
                );
            } catch (error) {
                console.warn('Failed to load Cosmos DB best practices skill:', error);
                this.skillContent = '';
            }
        }

        if (this.skillContent) {
            return `\n\n## Azure Cosmos DB Best Practices:\n\n${this.skillContent}`;
        }
        return '';
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

            return '';
        } catch (error) {
            console.error('Error getting query editor context:', error);
            return '';
        }
    }

    /**
     * Resolves chat prompt references (files, selections, etc.) into a formatted text string
     * that can be included as additional context in LLM queries.
     */
    private async resolveChatReferences(request: vscode.ChatRequest): Promise<string> {
        if (!request.references || request.references.length === 0) {
            return '';
        }

        const parts: string[] = [];

        for (const ref of request.references) {
            try {
                if (ref.value instanceof vscode.Uri) {
                    const content = await vscode.workspace.fs.readFile(ref.value);
                    const text = new TextDecoder().decode(content);
                    const fileName = path.basename(ref.value.fsPath);
                    parts.push(`### File: ${fileName}\n\`\`\`\n${text}\n\`\`\``);
                } else if (ref.value instanceof vscode.Location) {
                    const doc = await vscode.workspace.openTextDocument(ref.value.uri);
                    const text = doc.getText(ref.value.range);
                    const fileName = path.basename(ref.value.uri.fsPath);
                    const startLine = ref.value.range.start.line + 1;
                    const endLine = ref.value.range.end.line + 1;
                    parts.push(`### File: ${fileName} (lines ${startLine}-${endLine})\n\`\`\`\n${text}\n\`\`\``);
                } else if (typeof ref.value === 'string') {
                    parts.push(ref.value);
                }
            } catch (error) {
                console.warn('Failed to resolve chat reference:', error);
            }
        }

        return parts.join('\n\n');
    }

    /**
     * Uses LLM for complete intent and parameter extraction - the ideal approach.
     * Uses separated system prompt (instructions) and user content (payload).
     */
    private async extractIntentWithLLM(
        originalPrompt: string,
        model: vscode.LanguageModelChat,
        ctx?: IActionContext,
    ): Promise<{ operation: string; parameters: Record<string, unknown> } | null> {
        try {
            // System prompt (fixed instructions) - from systemPrompt.ts
            const systemMessage = vscode.LanguageModelChatMessage.User(INTENT_EXTRACTION_PROMPT);

            // User content (payload) - from userPayload.ts
            const userContent = buildIntentExtractionUserContent({ userPrompt: originalPrompt });
            const userMessage = vscode.LanguageModelChatMessage.User(userContent);

            // Use utility to ensure instruction message is always first
            const response = await sendChatRequest(
                model,
                systemMessage,
                userMessage,
                {},
                new vscode.CancellationTokenSource().token,
                undefined,
                'intentExtraction',
            );

            let jsonText = '';
            for await (const fragment of response.text) {
                jsonText += fragment;
            }

            if (jsonText.trim() === '{}') {
                return null;
            }

            const parsed = JSON.parse(jsonText.trim()) as {
                operation: string;
                parameters: Record<string, unknown>;
            };
            return parsed && parsed.operation ? parsed : null;
        } catch (error) {
            if (ctx) {
                ctx.telemetry.properties.intentExtractionFailed = 'true';
            }
            console.warn('LLM intent extraction failed, falling back to rule-based:', error);
            return null;
        }
    }

    /**
     * Uses LLM to extract parameters from user prompt - much smarter than regex parsing.
     * Uses separated system prompt (instructions) and user content (payload).
     */
    private async extractParametersWithLLM(
        operation: string,
        originalPrompt: string,
        model: vscode.LanguageModelChat,
        ctx?: IActionContext,
    ): Promise<Record<string, unknown>> {
        try {
            // System prompt (fixed instructions) - from systemPrompt.ts
            const systemPromptText = PARAMETER_EXTRACTION_PROMPT_TEMPLATE.replace('{operation}', operation);
            const systemMessage = vscode.LanguageModelChatMessage.User(systemPromptText);

            // User content (payload) - from userPayload.ts
            const userContent = buildParameterExtractionUserContent(operation, originalPrompt);
            const userMessage = vscode.LanguageModelChatMessage.User(userContent);

            const response = await sendChatRequest(
                model,
                systemMessage,
                userMessage,
                {},
                new vscode.CancellationTokenSource().token,
                undefined,
                'parameterExtraction',
            );

            let jsonText = '';
            for await (const fragment of response.text) {
                jsonText += fragment;
            }

            // Parse the JSON response
            const parameters = JSON.parse(jsonText.trim()) as Record<string, unknown>;
            return parameters && typeof parameters === 'object' ? parameters : {};
        } catch (error) {
            if (ctx) {
                ctx.telemetry.properties.parameterExtractionFailed = 'true';
            }
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
            case 'generateQuery': {
                // Pass the full user prompt for LLM query generation
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
     * Resolves the language model from the request or by selecting one.
     * Returns null if no model is available.
     */
    private async getLanguageModel(request: vscode.ChatRequest): Promise<vscode.LanguageModelChat | null> {
        const extReq = request as ExtendedChatRequest;
        if (extReq.model) {
            return extReq.model;
        }
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        return models.length > 0 ? models[0] : null;
    }

    /**
     * Handles free-form conversation requests as a general Cosmos DB assistant.
     * Used when no structured intent (editQuery, explainQuery, etc.) is detected.
     */
    private async handleFreeformChat(
        request: vscode.ChatRequest,
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult> {
        // Get query editor context if available (user content/payload)
        const queryEditorContext = this.getQueryEditorContext();

        // Resolve any attached references (files, selections, etc.)
        const chatReferencesContext = await this.resolveChatReferences(request);

        // Load Cosmos DB reference assets for domain knowledge
        const referenceContext = this.getCosmosDbReferenceContext();

        // System prompt (fixed instructions) - from systemPrompt.ts, enriched with reference docs
        const systemMessage = vscode.LanguageModelChatMessage.User(CHAT_PARTICIPANT_SYSTEM_PROMPT + referenceContext);

        // User content (dynamic payload) - query editor context + chat references + user prompt
        let userContent = '';
        if (queryEditorContext) {
            userContent += wrapUserContent(queryEditorContext, 'context');
            userContent += QUERY_EDITOR_CONTEXT_SUFFIX;
        }
        if (chatReferencesContext) {
            userContent += `\n\n## User-Provided Context\n${wrapUserContent(chatReferencesContext, 'context')}`;
        }
        userContent += `\n\nUser request:\n${wrapUserContent(request.prompt, 'data')}`;

        const userMessage = vscode.LanguageModelChatMessage.User(userContent);

        const chatResponse = await sendChatRequest(
            model,
            systemMessage,
            userMessage,
            {},
            token,
            undefined,
            'freeformChat',
        );

        for await (const fragment of chatResponse.text) {
            stream.markdown(fragment);

            if (token.isCancellationRequested) {
                break;
            }
        }

        // Add operation suggestions after LLM response
        const activeEditors = Array.from(QueryEditorTab.openTabs);
        const activeEditor = activeEditors.length > 0 ? getActiveQueryEditor(activeEditors) : null;
        const connection = activeEditor ? getConnectionFromQueryTab(activeEditor) : undefined;
        const suggestions = OperationParser.generateSuggestions(!!connection);
        stream.markdown(suggestions);

        stream.markdown(
            l10n.t(
                '\n\nFor more information, visit the [Azure Cosmos DB documentation](https://learn.microsoft.com/azure/cosmos-db/).',
            ),
        );

        return { metadata: { command: 'cosmosdb' } };
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

        stream.markdown(`🎯 **Detected Intent:** ${safeMarkdownText(intent.operation)}\n\n`);

        if (intent.operation === 'help') {
            return this.handleHelpCommand(stream);
        }

        try {
            // Map intent operation to actual operation
            let operationName = intent.operation;
            let parameters = intent.parameters;

            // Resolve any attached references (files, selections, etc.)
            const chatReferencesContext = await this.resolveChatReferences(request);

            // Handle special cases
            if (intent.operation === 'editQuery' && request.prompt.trim()) {
                operationName = 'editQuery';
                parameters = {
                    currentQuery: intent.parameters.currentQuery || '',
                    userPrompt: request.prompt, // Pass the full user prompt for LLM processing
                    explanation: 'Query optimization based on AI analysis',
                };
            }

            // Forward resolved chat references as additional context
            if (chatReferencesContext) {
                parameters = { ...parameters, additionalContext: chatReferencesContext };
            }

            const operationResult = await operationsService.executeOperation(
                operationName,
                parameters,
                (message) => stream.markdown(message + '\n\n'),
                async (message) => {
                    const answer = await vscode.window.showInformationMessage(
                        message,
                        { modal: true },
                        l10n.t('Allow'),
                    );
                    return answer === l10n.t('Allow');
                },
                'chatParticipant',
            );

            // Handle editQuery results specially with buttons
            if (typeof operationResult === 'object' && operationResult.type === 'editQuery') {
                this.handleEditQueryResult(operationResult, stream);
            } else {
                stream.markdown(operationResult as string);
            }

            // Add contextual suggestions
            const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
            const activeEditor = activeQueryEditors.length > 0 ? getActiveQueryEditor(activeQueryEditors) : null;
            const connection = activeEditor ? getConnectionFromQueryTab(activeEditor) : undefined;
            const suggestions = OperationParser.generateSuggestions(!!connection);
            stream.markdown(suggestions);

            return {
                metadata: { command: 'cosmosdb', operation: intent.operation, method: 'intent' },
            };
        } catch (error) {
            stream.markdown(safeErrorDisplay(error as Error | string, '❌ Intent-based operation failed:'));
            return { metadata: { command: 'cosmosdb', result: 'error' } };
        }
    }

    /**
     * Handles structured command requests with explicit commands
     */
    private async handleStructuredCommand(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        _token: vscode.CancellationToken,
        ctx?: IActionContext,
    ): Promise<vscode.ChatResult> {
        const operationsService = CosmosDbOperationsService.getInstance();

        stream.markdown(`🔧 **Executing Command:** ${safeMarkdownText(request.command || '')}\n\n`);

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
                    parameters = await this.extractParametersWithLLM(operationName, request.prompt, languageModel, ctx);
                    stream.markdown(`🧠 **LLM Extracted Parameters:** ${safeJsonDisplay(parameters)}\n\n`);
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

            // Ensure userPrompt is always populated from the original request
            if (!parameters.userPrompt && request.prompt.trim()) {
                parameters.userPrompt = request.prompt;
            }

            // Resolve any attached references (files, selections, etc.)
            const chatReferencesContext = await this.resolveChatReferences(request);
            if (chatReferencesContext) {
                parameters = { ...parameters, additionalContext: chatReferencesContext };
            }

            const operationResult = await operationsService.executeOperation(
                operationName,
                parameters,
                (message) => stream.markdown(message + '\n\n'),
                async (message) => {
                    const answer = await vscode.window.showInformationMessage(
                        message,
                        { modal: true },
                        l10n.t('Allow'),
                    );
                    return answer === l10n.t('Allow');
                },
                'chatParticipant',
            );

            // Handle editQuery results specially with buttons
            if (typeof operationResult === 'object' && operationResult.type === 'editQuery') {
                this.handleEditQueryResult(operationResult, stream);
            } else {
                stream.markdown(operationResult as string);
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
            stream.markdown(safeErrorDisplay(error as Error | string, '❌ Command failed:'));
            return { metadata: { command: 'cosmosdb', result: 'error' } };
        }
    }

    /**
     * Handles editQuery results by showing the query diff and action buttons
     */
    private handleEditQueryResult(result: EditQueryResult, stream: vscode.ChatResponseStream): void {
        // Show query context - sanitize database and container IDs
        let queryContext = `**Query Context:**\n`;
        queryContext += `- **Database:** ${safeMarkdownText(result.queryContext.databaseId)}\n`;
        queryContext += `- **Container:** ${safeMarkdownText(result.queryContext.containerId)}\n`;
        if (result.queryContext.documentCount !== undefined) {
            queryContext +=
                l10n.t('- **Last Results:** {0} documents returned', result.queryContext.documentCount) + '\n';
            if (result.queryContext.requestCharge !== undefined) {
                queryContext +=
                    l10n.t('- **Request Charge:** {0} RUs', result.queryContext.requestCharge.toFixed(2)) + '\n';
            }
        }
        queryContext += '\n';

        stream.markdown(queryContext);

        // Show current query only if present (not for generateQuery)
        if (result.currentQuery) {
            stream.markdown(`**Current Query:**\n${safeCodeBlock(result.currentQuery, 'sql')}\n\n`);
        }

        // Show suggested query - use safeCodeBlock to prevent SQL injection in markdown
        stream.markdown(`**Suggested Query:**\n${safeCodeBlock(result.suggestedQuery, 'sql')}\n\n`);

        // Show explanation - sanitize LLM-generated explanation
        if (result.explanation) {
            stream.markdown(`**Explanation:** ${safeMarkdownText(result.explanation)}\n\n`);
        }

        // Store the result in the pending map and pass only the lightweight ID
        // to the button arguments. This avoids serializing large objects
        // (credentials, full query text) into the chat response, which can
        // delay button interactivity.
        const resultId = CosmosDbChatParticipant.nextResultId++;
        CosmosDbChatParticipant.pendingResults.set(resultId, {
            connection: result.connection,
            suggestedQuery: result.suggestedQuery,
        });

        // Evict oldest entries when the map grows too large
        while (CosmosDbChatParticipant.pendingResults.size > CosmosDbChatParticipant.MAX_PENDING_RESULTS) {
            const oldest = CosmosDbChatParticipant.pendingResults.keys().next().value as number;
            CosmosDbChatParticipant.pendingResults.delete(oldest);
        }

        stream.button({
            command: 'cosmosDB.applyQuerySuggestion',
            title: l10n.t('✅ Update Query'),
            arguments: [resultId],
        });

        stream.button({
            command: 'cosmosDB.openQuerySideBySide',
            title: l10n.t('🔍 Open Side-by-Side'),
            arguments: [resultId],
        });

        stream.markdown('\n');
    }

    /**
     * Handles help command requests
     */
    private handleHelpCommand(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        const helpText = l10n.t(`## Cosmos DB (NoSQL) Assistant Commands

### **Quick Commands:**
- \`@cosmosdb /editQuery\` - Edit and improve queries in active query editor with AI suggestions
- \`@cosmosdb /explainQuery\` - Explain the current query with AI analysis
- \`@cosmosdb /generateQuery\` - Generate a new query from natural language description
- \`@cosmosdb /question\` - Ask a general question about Azure Cosmos DB
- \`@cosmosdb /help\` - Show this help

### **Natural Language:**
You can also use natural language:
- "improve my current query" (requires active query editor)
- "optimize this query" (modifies query in active editor)
- "explain this query" (analyzes current query in active editor)
- "what does my query do?" (explains query purpose and components)
- "generate a query to find all users" (creates a new query from description)
- "what is a partition key?" (general Cosmos DB question)

### **Features:**
- 🤖 AI query editing & optimization
- 📊 Query explanation
- ✨ AI-powered query generation from natural language
- ❓ General Azure Cosmos DB knowledge and best practices

For more information, visit the [Azure Cosmos DB documentation](https://learn.microsoft.com/azure/cosmos-db/).`);

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
        const requestStartTime = Date.now();
        let resolvedCommand = request.command || 'freeform';
        let resolvedMethod = 'command';

        const result = await callWithTelemetryAndErrorHandling('cosmosDB.chatParticipant.request', async (ctx) => {
            ctx.errorHandling.suppressDisplay = true;

            try {
                // Check if AI features are available
                if (!(await areAIFeaturesEnabled())) {
                    stream.markdown(
                        l10n.t(
                            'AI features are currently unavailable. Please ensure GitHub Copilot is installed and enabled.',
                        ),
                    );
                    return { metadata: { command: '', result: 'AI features disabled' } } as vscode.ChatResult;
                }

                // Handle commands that don't require an active connection
                if (request.command === 'question') {
                    const questionModel = await this.getLanguageModel(request);
                    if (!questionModel) {
                        stream.markdown(
                            l10n.t('❌ No language model available. Please ensure GitHub Copilot is enabled.'),
                        );
                        return { metadata: { command: 'cosmosdb' } } as vscode.ChatResult;
                    }
                    return await this.handleFreeformChat(request, questionModel, stream, token);
                }
                if (request.command === 'help') {
                    return await this.handleHelpCommand(stream);
                }

                // Check if there's an active connection or query editor
                const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
                const hasConnection = activeQueryEditors.length > 0;

                if (!hasConnection) {
                    // For natural language requests, check if this is a general question
                    // that doesn't need a connection
                    if (!request.command) {
                        const noConnModel = await this.getLanguageModel(request);
                        if (noConnModel) {
                            const llmIntent = await this.extractIntentWithLLM(request.prompt, noConnModel, ctx);
                            if (!llmIntent || llmIntent.operation === 'generalQuestion') {
                                resolvedCommand = 'question';
                                resolvedMethod = 'intent';
                                return await this.handleFreeformChat(request, noConnModel, stream, token);
                            }
                            if (llmIntent.operation === 'help') {
                                resolvedCommand = 'help';
                                resolvedMethod = 'intent';
                                return await this.handleHelpCommand(stream);
                            }
                        }
                    }

                    stream.markdown(l10n.t('⚠️ **No Cosmos DB connection found.**') + '\n\n');
                    stream.markdown(
                        l10n.t('Please connect to a Cosmos DB container to use the chat assistant.') + '\n\n',
                    );

                    // Add a button to open the query editor which will prompt for connection
                    stream.button({
                        command: 'cosmosDB.openNoSqlQueryEditor',
                        title: l10n.t('🔌 Open Query Editor'),
                        arguments: [],
                    });

                    return { metadata: { command: '', result: 'No connection' } } as vscode.ChatResult;
                }

                // Check if this is a structured command request (explicit intent)
                if (request.command) {
                    return await this.handleStructuredCommand(request, stream, token, ctx);
                }

                // Get the language model from the request or select one
                const model = await this.getLanguageModel(request);
                if (!model) {
                    stream.markdown(l10n.t('❌ No language model available. Please ensure GitHub Copilot is enabled.'));
                    return { metadata: { command: 'cosmosdb' } } as vscode.ChatResult;
                }

                // First try LLM-based intent detection (most intelligent approach)
                const llmIntent = await this.extractIntentWithLLM(request.prompt, model, ctx);
                if (llmIntent && llmIntent.operation !== 'generalQuestion') {
                    resolvedCommand = llmIntent.operation;
                    resolvedMethod = 'intent';
                    stream.markdown(`🧠 **LLM Detected Intent:** ${safeMarkdownText(llmIntent.operation)}\n`);
                    if (Object.keys(llmIntent.parameters).length > 0) {
                        stream.markdown(`**Parameters:** ${safeJsonDisplay(llmIntent.parameters)}\n\n`);
                    } else {
                        stream.markdown('\n');
                    }
                    return await this.handleIntentBasedRequest(request, llmIntent, stream, token);
                }

                // No structured intent or general question — handle as free-form conversation
                resolvedCommand = 'question';
                resolvedMethod = 'fallback';
                return await this.handleFreeformChat(request, model, stream, token);
            } catch (error) {
                // Handle errors gracefully
                console.error('CosmosDB chat participant error:', error);

                if (error instanceof vscode.LanguageModelError) {
                    // Handle specific language model errors
                    stream.markdown(l10n.t('❌ Language model error: {0}', error.message));
                } else {
                    stream.markdown(l10n.t('❌ An error occurred while processing your request. Please try again.'));
                }

                throw error;
            } finally {
                ctx.telemetry.properties.command = resolvedCommand;
                ctx.telemetry.properties.method = resolvedMethod;
                ctx.telemetry.measurements.durationMs = Date.now() - requestStartTime;
            }
        });

        return result ?? { metadata: { command: 'cosmosdb', result: 'error' } };
    }
}
