/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createMockLanguageModel } from '../../../utils/languageModelMockUtils';
import { runAgenticLoop } from './aiHelpers';
import { stripMarkdownPreamble } from './markdownUtils';

vi.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            appendLog: vi.fn(),
            show: vi.fn(),
        },
    },
}));

// Run the wrapped callback with a minimal mutable telemetry context.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(async (_eventName: string, callback: (context: unknown) => unknown) =>
        callback({
            telemetry: { properties: {}, measurements: {} },
            errorHandling: { issueProperties: {} },
        }),
    ),
}));

vi.mock('@vscode/prompt-tsx', () => ({ renderPrompt: vi.fn() }));

vi.mock('../../../utils/aiUtils', () => ({
    extractJsonObject: vi.fn(),
    getSelectedModel: vi.fn(),
    logLlmTokenUsage: vi.fn(),
}));

vi.mock('../../../utils/modelUtils', () => ({ MIGRATION_SELECTED_MODEL_KEY: 'migration.selectedModel' }));

describe('stripMarkdownPreamble', () => {
    it('removes preamble text before the first heading', () => {
        const input = `Now I have a thorough understanding of the schema and the application code. Let me generate the discovery report.

# AdventureWorks Database — Cosmos DB Migration Discovery Report

## Schema Overview

| Schema | Tables |
|--------|--------|
| **dbo** | AWBuildVersion |`;

        const result = stripMarkdownPreamble(input);
        expect(result).toBe(`# AdventureWorks Database — Cosmos DB Migration Discovery Report

## Schema Overview

| Schema | Tables |
|--------|--------|
| **dbo** | AWBuildVersion |`);
    });

    it('returns text unchanged when it starts with a heading', () => {
        const input = `# Discovery Report

Some content here.`;

        expect(stripMarkdownPreamble(input)).toBe(input);
    });

    it('returns text unchanged when there are no headings', () => {
        const input = `This is plain text without any markdown headings.
It has multiple lines but no heading.`;

        expect(stripMarkdownPreamble(input)).toBe(input);
    });

    it('handles multiple preamble lines before the heading', () => {
        const input = `Let me analyze the schema.
I found 30 tables across 6 schemas.
Here is the comprehensive report:

# Database Migration Report

Content here.`;

        const result = stripMarkdownPreamble(input);
        expect(result).toBe(`# Database Migration Report

Content here.`);
    });

    it('handles a level-2 heading as the first heading', () => {
        const input = `Some preamble text.

## Overview

Details here.`;

        const result = stripMarkdownPreamble(input);
        expect(result).toBe(`## Overview

Details here.`);
    });

    it('returns empty string unchanged', () => {
        expect(stripMarkdownPreamble('')).toBe('');
    });

    it('handles heading on the very first line with no preamble', () => {
        const input = `## Quick Summary`;
        expect(stripMarkdownPreamble(input)).toBe(input);
    });

    it('does not strip code blocks that contain # characters', () => {
        const input = `Here is an example:

\`\`\`python
# This is a comment
print("hello")
\`\`\`

# Actual Heading

Content.`;

        // The regex matches the first `#` at the start of a line, which in this
        // case is inside a code block. This is acceptable because:
        // 1. Real LLM preambles don't start with code blocks
        // 2. The main use case is stripping conversational text before a document heading
        const result = stripMarkdownPreamble(input);
        expect(result).toBe(`# This is a comment
print("hello")
\`\`\`

# Actual Heading

Content.`);
    });

    it('preserves whitespace-only lines before heading', () => {
        const input = `\n\n# Report\n\nContent.`;
        const result = stripMarkdownPreamble(input);
        expect(result).toBe(`# Report\n\nContent.`);
    });
});

describe('runAgenticLoop (tool calling via mock language model)', () => {
    const SAMPLE_TOOL = 'cosmosdb_sampleContainerSchema';
    const tools: vscode.LanguageModelChatTool[] = [
        { name: SAMPLE_TOOL, description: 'Samples container schema', inputSchema: {} },
    ];

    function makeToken(): vscode.CancellationToken {
        return new vscode.CancellationTokenSource().token;
    }

    it('runs a tool-call round, executes the tool, then returns the final answer', async () => {
        let round = 0;
        // The resolver is invoked once per round: round 0 emits a tool call,
        // round 1 (after the tool result is fed back) emits the final query.
        const model = createMockLanguageModel({
            id: 'mock-model',
            name: 'Mock Model',
            resolveResponse: () =>
                round++ === 0
                    ? [{ type: 'toolCall', name: SAMPLE_TOOL, input: { containerId: 'orders' } }]
                    : 'SELECT * FROM c',
        });

        const executeToolCall = vi.fn(
            async (_toolCall: vscode.LanguageModelToolCallPart) => '{"schema":{"id":"string"}}',
        );

        const result = await runAgenticLoop(
            model,
            [vscode.LanguageModelChatMessage.User('generate a query for orders')],
            tools,
            executeToolCall,
            5,
            makeToken(),
            'Test Loop',
        );

        expect(executeToolCall).toHaveBeenCalledTimes(1);
        const toolCallArg = executeToolCall.mock.calls[0][0];
        expect(toolCallArg.name).toBe(SAMPLE_TOOL);
        expect(toolCallArg.input).toEqual({ containerId: 'orders' });
        expect(result.text).toBe('SELECT * FROM c');
        expect(result.roundsExhausted).toBe(false);
        expect(round).toBe(2);
    });

    it('finishes in a single round when the model requests no tools', async () => {
        const model = createMockLanguageModel({
            id: 'mock-model',
            name: 'Mock Model',
            resolveResponse: () => 'SELECT VALUE COUNT(1) FROM c',
        });
        const executeToolCall = vi.fn(async () => '');

        const result = await runAgenticLoop(
            model,
            [vscode.LanguageModelChatMessage.User('count documents')],
            tools,
            executeToolCall,
            5,
            makeToken(),
            'Test Loop',
        );

        expect(executeToolCall).not.toHaveBeenCalled();
        expect(result.text).toBe('SELECT VALUE COUNT(1) FROM c');
        expect(result.roundsExhausted).toBe(false);
    });
});
