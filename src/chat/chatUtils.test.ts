/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as vscode from 'vscode';
import { type QueryEditorTab } from '../panels/QueryEditorTab';
import { buildChatMessages, getActiveQueryEditor, getConnectionFromQueryTab, sendChatRequest } from './chatUtils';

// Prevent transitive require('vscode') from @microsoft/vscode-azext-utils deps
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));

vi.mock('../utils/aiUtils', () => ({
    logLlmTokenUsage: vi.fn(),
}));

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

function createMockAssistantMessage(content: string): vscode.LanguageModelChatMessage {
    return {
        role: vscode.LanguageModelChatMessageRole?.Assistant ?? 2, // 2 = Assistant role
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

        it('should insert intermediate messages between instruction and user message', () => {
            const instruction = createMockUserMessage('INSTRUCTION');
            const user = createMockUserMessage('USER');
            const oneShotUser = createMockUserMessage('example question');
            const oneShotAssistant = createMockAssistantMessage('example query');

            const result = buildChatMessages(instruction, user, [oneShotUser, oneShotAssistant]);

            expect(result).toHaveLength(4);
            expect(result[0]).toBe(instruction);
            expect(result[1]).toBe(oneShotUser);
            expect(result[2]).toBe(oneShotAssistant);
            expect(result[3]).toBe(user);
        });

        it('should handle intermediate messages with no user message', () => {
            const instruction = createMockUserMessage('INSTRUCTION');
            const oneShotUser = createMockUserMessage('example question');
            const oneShotAssistant = createMockAssistantMessage('example query');

            const result = buildChatMessages(instruction, undefined, [oneShotUser, oneShotAssistant]);

            expect(result).toHaveLength(3);
            expect(result[0]).toBe(instruction);
            expect(result[1]).toBe(oneShotUser);
            expect(result[2]).toBe(oneShotAssistant);
        });

        it('should handle empty intermediate messages array', () => {
            const instruction = createMockUserMessage('INSTRUCTION');
            const user = createMockUserMessage('USER');

            const result = buildChatMessages(instruction, user, []);

            expect(result).toHaveLength(2);
            expect(result[0]).toBe(instruction);
            expect(result[1]).toBe(user);
        });

        it('should handle undefined intermediate messages (backward compatible)', () => {
            const instruction = createMockUserMessage('INSTRUCTION');
            const user = createMockUserMessage('USER');

            const result = buildChatMessages(instruction, user, undefined);

            expect(result).toHaveLength(2);
            expect(result[0]).toBe(instruction);
            expect(result[1]).toBe(user);
        });
    });

    describe('sendChatRequest', () => {
        it('should call model.sendRequest with properly built messages', async () => {
            const { logLlmTokenUsage } = await import('../utils/aiUtils');
            const instructionMessage = createMockUserMessage('Instruction');
            const userMessage = createMockUserMessage('User');
            const mockResponse = { text: 'response' };
            const mockModel = {
                sendRequest: vi.fn().mockResolvedValue(mockResponse),
            } as unknown as vscode.LanguageModelChat;
            const mockToken = {} as vscode.CancellationToken;
            const options = {};

            const result = await sendChatRequest(mockModel, instructionMessage, userMessage, options, mockToken);

            expect(logLlmTokenUsage).toHaveBeenCalled();
            expect(mockModel.sendRequest).toHaveBeenCalledWith([instructionMessage, userMessage], options, mockToken);
            expect(result).toBe(mockResponse);
        });

        it('should pass intermediate messages through to buildChatMessages', async () => {
            const instructionMessage = createMockUserMessage('Instruction');
            const userMessage = createMockUserMessage('User');
            const intermediate = [createMockUserMessage('example'), createMockAssistantMessage('response')];
            const mockResponse = { text: 'response' };
            const mockModel = {
                sendRequest: vi.fn().mockResolvedValue(mockResponse),
            } as unknown as vscode.LanguageModelChat;
            const mockToken = {} as vscode.CancellationToken;

            await sendChatRequest(mockModel, instructionMessage, userMessage, {}, mockToken, intermediate);

            expect(mockModel.sendRequest).toHaveBeenCalledWith(
                [instructionMessage, ...intermediate, userMessage],
                {},
                mockToken,
            );
        });

        it('should pass caller to logLlmTokenUsage', async () => {
            const { logLlmTokenUsage } = await import('../utils/aiUtils');
            const instructionMessage = createMockUserMessage('Instruction');
            const mockModel = {
                sendRequest: vi.fn().mockResolvedValue({ text: '' }),
            } as unknown as vscode.LanguageModelChat;
            const mockToken = {} as vscode.CancellationToken;

            await sendChatRequest(mockModel, instructionMessage, undefined, {}, mockToken, undefined, 'testCaller');

            expect(logLlmTokenUsage).toHaveBeenCalledWith(mockModel, expect.objectContaining({ caller: 'testCaller' }));
        });

        it('should default caller to unknown when not provided', async () => {
            const { logLlmTokenUsage } = await import('../utils/aiUtils');
            const instructionMessage = createMockUserMessage('Instruction');
            const mockModel = {
                sendRequest: vi.fn().mockResolvedValue({ text: '' }),
            } as unknown as vscode.LanguageModelChat;
            const mockToken = {} as vscode.CancellationToken;

            await sendChatRequest(mockModel, instructionMessage, undefined, {}, mockToken);

            expect(logLlmTokenUsage).toHaveBeenCalledWith(mockModel, expect.objectContaining({ caller: 'unknown' }));
        });
    });

    describe('getActiveQueryEditor', () => {
        function createMockEditor(active: boolean, visible: boolean): QueryEditorTab {
            return {
                isActive: () => active,
                isVisible: () => visible,
            } as unknown as QueryEditorTab;
        }

        it('should return the active editor when one exists', () => {
            const editor1 = createMockEditor(false, false);
            const editor2 = createMockEditor(true, true);
            const editor3 = createMockEditor(false, true);

            const result = getActiveQueryEditor([editor1, editor2, editor3]);

            expect(result).toBe(editor2);
        });

        it('should fall back to visible editor when none is active', () => {
            const editor1 = createMockEditor(false, false);
            const editor2 = createMockEditor(false, true);
            const editor3 = createMockEditor(false, false);

            const result = getActiveQueryEditor([editor1, editor2, editor3]);

            expect(result).toBe(editor2);
        });

        it('should fall back to first editor when none is active or visible', () => {
            const editor1 = createMockEditor(false, false);
            const editor2 = createMockEditor(false, false);

            const result = getActiveQueryEditor([editor1, editor2]);

            expect(result).toBe(editor1);
        });

        it('should prefer active over visible', () => {
            const visibleEditor = createMockEditor(false, true);
            const activeEditor = createMockEditor(true, false);

            const result = getActiveQueryEditor([visibleEditor, activeEditor]);

            expect(result).toBe(activeEditor);
        });
    });

    describe('getConnectionFromQueryTab', () => {
        it('should return the connection from the query tab', () => {
            const mockConnection = { databaseId: 'db1', containerId: 'c1' };
            const mockTab = {
                getConnection: () => mockConnection,
            } as unknown as QueryEditorTab;

            const result = getConnectionFromQueryTab(mockTab);

            expect(result).toBe(mockConnection);
        });

        it('should return undefined when tab has no connection', () => {
            const mockTab = {
                getConnection: () => undefined,
            } as unknown as QueryEditorTab;

            const result = getConnectionFromQueryTab(mockTab);

            expect(result).toBeUndefined();
        });
    });
});
