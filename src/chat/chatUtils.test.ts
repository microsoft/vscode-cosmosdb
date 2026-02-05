/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { buildChatMessages } from './chatUtils';

// Helper to create mock LanguageModelChatMessage objects
// The actual vscode.LanguageModelChatMessage is not available in tests,
// so we create mock objects that match the expected interface
function createMockUserMessage(content: string): vscode.LanguageModelChatMessage {
    return {
        role: vscode.LanguageModelChatMessageRole?.User ?? 1, // 1 = User role
        content: content,
        name: undefined,
    } as unknown as vscode.LanguageModelChatMessage;
}

describe('chatUtils', () => {
    describe('buildChatMessages', () => {
        it('should place instruction message first when both messages provided', () => {
            const instructionMessage = createMockUserMessage('You are a helpful assistant');
            const userMessage = createMockUserMessage('What is recursion?');

            const messages = buildChatMessages(instructionMessage, userMessage);

            expect(messages).toHaveLength(2);
            expect(messages[0]).toBe(instructionMessage);
            expect(messages[1]).toBe(userMessage);
        });

        it('should return only instruction message when user message is undefined', () => {
            const instructionMessage = createMockUserMessage('System instructions here');

            const messages = buildChatMessages(instructionMessage, undefined);

            expect(messages).toHaveLength(1);
            expect(messages[0]).toBe(instructionMessage);
        });

        it('should preserve message ordering with instruction first then user request', () => {
            // Basic pattern: instruction message first, then user's actual request
            // Note: Full few-shot learning would use Assistant messages for example outputs,
            // but this utility handles the simple instruction-first pattern
            const instruction = createMockUserMessage(
                'You are a Cosmos DB NoSQL query expert. Convert natural language to NoSQL queries.',
            );
            const userRequest = createMockUserMessage('find all documents where status is active');

            const messages = buildChatMessages(instruction, userRequest);

            // Verify instruction is always at index 0
            expect(messages[0]).toBe(instruction);
            // Verify user request follows at index 1
            expect(messages[1]).toBe(userRequest);
        });

        it('should handle instruction message with complex content', () => {
            const complexInstruction = createMockUserMessage(`
                You are a CosmosDB query assistant.
                Rules:
                1. Only generate valid NoSQL queries
                2. Use the container alias 'c'
                3. Be concise
            `);
            const simpleUser = createMockUserMessage('count documents');

            const messages = buildChatMessages(complexInstruction, simpleUser);

            expect(messages).toHaveLength(2);
            expect(messages[0]).toBe(complexInstruction);
            expect(messages[1]).toBe(simpleUser);
        });

        it('should not mutate the original messages', () => {
            const instructionMessage = createMockUserMessage('Instructions');
            const userMessage = createMockUserMessage('User prompt');

            const messages = buildChatMessages(instructionMessage, userMessage);

            // The returned array should contain references to the original messages
            expect(messages[0]).toBe(instructionMessage);
            expect(messages[1]).toBe(userMessage);

            // Modifying the returned array should not affect calling with same inputs
            messages.push(createMockUserMessage('extra'));
            const messages2 = buildChatMessages(instructionMessage, userMessage);

            expect(messages2).toHaveLength(2);
        });

        it('should always return instruction as first element - order invariant', () => {
            // This test ensures the contract: instruction is ALWAYS first
            // regardless of how the function is called
            const instruction = createMockUserMessage('INSTRUCTION');
            const user = createMockUserMessage('USER');

            const result = buildChatMessages(instruction, user);

            // The instruction message must be at index 0
            // This is the core invariant we're protecting
            expect(result[0]).toBe(instruction);

            // Additional verification: check content if needed
            expect(result[0].content).toContain('INSTRUCTION');
        });
    });
});
