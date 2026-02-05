/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
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
 * @param userMessage Optional user message with the actual request (placed second)
 * @param options Options for the request
 * @param token Cancellation token
 * @returns The chat response from the model
 */
export async function sendChatRequest(
    model: vscode.LanguageModelChat,
    instructionMessage: vscode.LanguageModelChatMessage,
    userMessage: vscode.LanguageModelChatMessage | undefined,
    options: vscode.LanguageModelChatRequestOptions,
    token: vscode.CancellationToken,
): Promise<vscode.LanguageModelChatResponse> {
    // Build messages array with instruction message always first
    const messages = buildChatMessages(instructionMessage, userMessage);
    return model.sendRequest(messages, options, token);
}

/**
 * Builds the messages array for a chat request, ensuring instruction message is always first.
 * This is exported separately to enable unit testing without mocking the model.
 *
 * @param instructionMessage The instruction/context message (placed first)
 * @param userMessage Optional user message with the actual request (placed second)
 * @returns Array of messages with instruction first
 */
export function buildChatMessages(
    instructionMessage: vscode.LanguageModelChatMessage,
    userMessage?: vscode.LanguageModelChatMessage,
): vscode.LanguageModelChatMessage[] {
    const messages: vscode.LanguageModelChatMessage[] = [instructionMessage];
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
