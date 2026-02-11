/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { ext } from '../extensionVariables';
import { type QueryEditorTab } from '../panels/QueryEditorTab';

/**
 * Sends a chat request to the language model with proper message ordering.
 *
 * The VS Code Language Model API doesn't support system messages, so we use
 * the first User message for instructions/context and the second for the actual request.
 * This is the recommended pattern per VS Code documentation.
 *
 * @param model The language model to send the request to
 * @param instructionMessage The instruction/context message (placed first)
 * @param userMessage Optional user message with the actual request (placed last)
 * @param options Options for the request
 * @param token Cancellation token
 * @param intermediateMessages Optional messages inserted between instruction and user
 *   message, e.g. one-shot User/Assistant example pairs
 * @returns The chat response from the model
 */
export async function sendChatRequest(
    model: vscode.LanguageModelChat,
    instructionMessage: vscode.LanguageModelChatMessage,
    userMessage: vscode.LanguageModelChatMessage | undefined,
    options: vscode.LanguageModelChatRequestOptions,
    token: vscode.CancellationToken,
    intermediateMessages?: vscode.LanguageModelChatMessage[],
): Promise<vscode.LanguageModelChatResponse> {
    // Build messages array with instruction message always first
    const messages = buildChatMessages(instructionMessage, userMessage, intermediateMessages);

    // Count tokens for all messages and log usage info
    try {
        const [instructionTokens, userTokens] = await Promise.all([
            model.countTokens(instructionMessage, token),
            userMessage ? model.countTokens(userMessage, token) : Promise.resolve(0),
        ]);
        const totalTokens = instructionTokens + userTokens;
        const maxTokens = model.maxInputTokens;
        const ratio = maxTokens > 0 ? ((totalTokens / maxTokens) * 100).toFixed(1) : 'N/A';
        ext.outputChannel.info(
            `[Chat Request] model="${model.name}" (${model.family}), ` +
                `instructionTokens=${instructionTokens}, userTokens=${userTokens}, ` +
                `requestTokens=${totalTokens}, maxInputTokens=${maxTokens}, ` +
                `usage=${ratio}%`,
        );
    } catch {
        // Token counting is best-effort; don't block the request
    }

    return model.sendRequest(messages, options, token);
}

/**
 * Builds the messages array for a chat request, ensuring instruction message is always first.
 * This is exported separately to enable unit testing without mocking the model.
 *
 * Message ordering: [instruction] → [intermediateMessages...] → [userMessage]
 *
 * Intermediate messages are typically one-shot User/Assistant example pairs that
 * demonstrate expected query patterns. Per VS Code LanguageModelChatMessage API,
 * these use LanguageModelChatMessage.User() and LanguageModelChatMessage.Assistant().
 *
 * @param instructionMessage The instruction/context message (placed first)
 * @param userMessage Optional user message with the actual request (placed last)
 * @param intermediateMessages Optional messages between instruction and user message,
 *   e.g. one-shot example pairs
 * @returns Array of messages with instruction first
 */
export function buildChatMessages(
    instructionMessage: vscode.LanguageModelChatMessage,
    userMessage?: vscode.LanguageModelChatMessage,
    intermediateMessages?: vscode.LanguageModelChatMessage[],
): vscode.LanguageModelChatMessage[] {
    const messages: vscode.LanguageModelChatMessage[] = [instructionMessage];
    if (intermediateMessages) {
        messages.push(...intermediateMessages);
    }
    if (userMessage) {
        messages.push(userMessage);
    }
    return messages;
}

/**
 * Find the active or visible query editor, fallback to first if none active
 */
export const getActiveQueryEditor = (activeQueryEditors: QueryEditorTab[]): QueryEditorTab =>
    activeQueryEditors.find((editor) => editor.isActive()) ||
    activeQueryEditors.find((editor) => editor.isVisible()) ||
    activeQueryEditors[0];

/**
 * Helper method to get connection from a query editor tab
 */
export const getConnectionFromQueryTab = (queryTab: QueryEditorTab): NoSqlQueryConnection | undefined => {
    return queryTab.getConnection();
};
