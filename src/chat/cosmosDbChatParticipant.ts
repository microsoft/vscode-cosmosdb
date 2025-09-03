/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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
     * Handles chat requests for the @cosmosdb participant by forwarding to the model from the request
     */
    private async handleChatRequest(
        request: vscode.ChatRequest,
        _context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult> {
        try {
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

            // Create system message with CosmosDB context
            const systemMessage = vscode.LanguageModelChatMessage
                .User(`You are a helpful assistant specialized in Azure Cosmos DB.
You help users with:
- CosmosDB concepts and best practices
- Query optimization and troubleshooting
- SDK usage and code examples
- Database design and modeling
- Performance tuning
- Cost optimization

Please provide helpful, accurate, and actionable responses about Cosmos DB. If asked about something outside of Cosmos DB, politely redirect the conversation back to Cosmos DB topics.`);

            const userMessage = vscode.LanguageModelChatMessage.User(request.prompt);

            // Send request to language model
            const chatResponse = await model.sendRequest([systemMessage, userMessage], {}, token);

            // Stream the response
            for await (const fragment of chatResponse.text) {
                stream.markdown(fragment);

                if (token.isCancellationRequested) {
                    break;
                }
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
