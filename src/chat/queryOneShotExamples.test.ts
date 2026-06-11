/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as vscode from 'vscode';
import { buildQueryOneShotMessages, getAllOneShotExamples } from './queryOneShotExamples';

// The vscode mock from jest-mock-vscode does not include LanguageModelChatMessage.
// Create a minimal mock that matches the API used by buildQueryOneShotMessages.
const MockLanguageModelChatMessage = {
    User: (content: string) => ({
        role: vscode.LanguageModelChatMessageRole?.User ?? 1,
        content,
    }),
    Assistant: (content: string) => ({
        role: vscode.LanguageModelChatMessageRole?.Assistant ?? 2,
        content,
    }),
} as unknown as typeof vscode.LanguageModelChatMessage;

describe('queryOneShotExamples', () => {
    describe('getAllOneShotExamples', () => {
        it('should return unique and redundant example arrays', () => {
            const { unique, redundant } = getAllOneShotExamples();

            expect(unique).toBeInstanceOf(Array);
            expect(redundant).toBeInstanceOf(Array);
            expect(unique.length).toBeGreaterThan(0);
            expect(redundant.length).toBeGreaterThan(0);
        });

        it('should return examples with question and query properties', () => {
            const { unique, redundant } = getAllOneShotExamples();

            for (const example of [...unique, ...redundant]) {
                expect(example).toHaveProperty('question');
                expect(example).toHaveProperty('query');
                expect(typeof example.question).toBe('string');
                expect(typeof example.query).toBe('string');
                expect(example.question.length).toBeGreaterThan(0);
                expect(example.query.length).toBeGreaterThan(0);
            }
        });

        it('should return copies that do not affect the originals', () => {
            const first = getAllOneShotExamples();
            const second = getAllOneShotExamples();

            // Mutating the first copy should not affect the second
            first.unique.push({ question: 'test', query: 'test' });
            expect(second.unique.length).toBeLessThan(first.unique.length);
        });

        it('should have unique examples that contain complex query patterns', () => {
            const { unique } = getAllOneShotExamples();

            // Verify at least some examples demonstrate complex patterns
            const queries = unique.map((e) => e.query);
            expect(queries.some((q) => q.includes('DateTimeToTimestamp'))).toBe(true);
            expect(queries.some((q) => q.includes('ARRAY('))).toBe(true);
            expect(queries.some((q) => q.includes('JOIN'))).toBe(true);
        });
    });

    describe('buildQueryOneShotMessages', () => {
        it('should return pairs of User/Assistant messages', () => {
            const messages = buildQueryOneShotMessages(MockLanguageModelChatMessage);

            // Each example produces 2 messages (User question + Assistant answer)
            expect(messages.length % 2).toBe(0);
            expect(messages.length).toBeGreaterThan(0);
        });

        it('should include both unique and redundant examples by default', () => {
            const { unique, redundant } = getAllOneShotExamples();
            const messages = buildQueryOneShotMessages(MockLanguageModelChatMessage);

            const expectedPairs = unique.length + redundant.length;
            expect(messages.length).toBe(expectedPairs * 2);
        });

        it('should include only unique examples when includeRedundant is false', () => {
            const { unique } = getAllOneShotExamples();
            const messages = buildQueryOneShotMessages(MockLanguageModelChatMessage, false);

            expect(messages.length).toBe(unique.length * 2);
        });

        it('should alternate User and Assistant messages', () => {
            const messages = buildQueryOneShotMessages(MockLanguageModelChatMessage);

            for (let i = 0; i < messages.length; i++) {
                if (i % 2 === 0) {
                    // Even indices should be User messages (questions)
                    expect(messages[i].role).toBe(vscode.LanguageModelChatMessageRole?.User ?? 1);
                } else {
                    // Odd indices should be Assistant messages (queries)
                    expect(messages[i].role).toBe(vscode.LanguageModelChatMessageRole?.Assistant ?? 2);
                }
            }
        });
    });
});
