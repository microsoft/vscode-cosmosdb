/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type QueryEditorTab } from '../panels/QueryEditorTab';
import { logLlmTokenUsage } from '../utils/aiUtils';

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
 * @param caller Identifier for what triggered this LLM call (for telemetry)
 * @returns The chat response from the model
 */
export async function sendChatRequest(
    model: vscode.LanguageModelChat,
    instructionMessage: vscode.LanguageModelChatMessage,
    userMessage: vscode.LanguageModelChatMessage | undefined,
    options: vscode.LanguageModelChatRequestOptions,
    token: vscode.CancellationToken,
    intermediateMessages?: vscode.LanguageModelChatMessage[],
    caller?: string,
): Promise<vscode.LanguageModelChatResponse> {
    // Build messages array with instruction message always first
    const messages = buildChatMessages(instructionMessage, userMessage, intermediateMessages);

    // Count tokens for all messages and log usage info
    await logLlmTokenUsage(model, {
        caller: caller ?? 'unknown',
        instructionMessage,
        userMessage,
        token,
        logLabel: 'Chat Request',
    });

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

/**
 * Delimiters that fence a block of untrusted, user-supplied text inside an agent
 * prompt. Everything between them is data (the user's request), never instructions.
 */
export const USER_DATA_START = 'BEGIN_USER_DATA';
export const USER_DATA_END = 'END_USER_DATA';

/**
 * Wraps untrusted user text so it cannot restructure the surrounding agent instruction
 * template (prompt injection). The text is newline-normalized so it cannot rely on odd
 * line endings, stripped of any embedded delimiter markers so the user cannot forge an
 * `END_USER_DATA` to break out and inject new steps, then fenced between the delimiters.
 */
export function wrapUserDataForAgent(text: string): string {
    let neutralized = text.replace(/\r\n?/g, '\n');
    // Remove delimiter markers repeatedly: a single pass can leave adjacent fragments
    // that re-form a marker (e.g. `END_USEND_USER_DATAER_DATA`), so loop until stable.
    const marker = new RegExp(`${USER_DATA_START}|${USER_DATA_END}`, 'gi');
    let previous: string;
    do {
        previous = neutralized;
        neutralized = neutralized.replace(marker, '');
    } while (neutralized !== previous);

    return `${USER_DATA_START}\n${neutralized}\n${USER_DATA_END}`;
}
