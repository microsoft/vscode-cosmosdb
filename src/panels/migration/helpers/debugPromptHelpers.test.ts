/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { type Mock } from 'vitest';

vi.mock('vscode', () => {
    class LanguageModelTextPart {
        value: string;

        constructor(value: string) {
            this.value = value;
        }
    }

    return {
        Uri: {
            file: vi.fn((fsPath: string) => ({ fsPath })),
        },
        workspace: {
            fs: {
                createDirectory: vi.fn().mockResolvedValue(undefined),
                writeFile: vi.fn().mockResolvedValue(undefined),
                readFile: vi.fn(),
            },
        },
        LanguageModelTextPart,
        LanguageModelChatMessageRole: {
            User: 1,
            Assistant: 2,
        },
        LanguageModelChatMessage: {
            User: vi.fn((text: string) => ({
                role: 1,
                content: [new LanguageModelTextPart(text)],
            })),
        },
    };
});

vi.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLog: vi.fn(),
        },
    },
}));

import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { dumpDebugPrompt } from './debugPromptHelpers';

function createMessage(role: number, text: string): vscode.LanguageModelChatMessage {
    return {
        role,
        content: [new vscode.LanguageModelTextPart(text)],
    } as unknown as vscode.LanguageModelChatMessage;
}

describe('dumpDebugPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (vscode.workspace.fs.createDirectory as Mock).mockResolvedValue(undefined);
        (vscode.workspace.fs.writeFile as Mock).mockResolvedValue(undefined);
    });

    it('writes prompt and messages files when no override is active', async () => {
        const messages = [
            createMessage(vscode.LanguageModelChatMessageRole.User, 'prompt body'),
            createMessage(vscode.LanguageModelChatMessageRole.Assistant, 'assistant body'),
        ];

        await dumpDebugPrompt('/tmp/debug-prompts', 'step1-analysis', messages);

        expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(2);
        expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
            // Windows has another separator
            { fsPath: path.normalize('/tmp/debug-prompts/step1-analysis.prompt.md') },
            Buffer.from('prompt body', 'utf-8'),
        );
        expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
            // Windows has another separator
            { fsPath: path.normalize('/tmp/debug-prompts/step1-analysis.messages.md') },
            Buffer.from('<!-- MSG:Assistant -->\n\nassistant body', 'utf-8'),
        );
        expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(
            '[DEBUG] Dumped prompt files for "step1-analysis" → /tmp/debug-prompts',
        );
    });

    it('preserves the prompt override file and refreshes only messages when override is active', async () => {
        const messages = [
            createMessage(vscode.LanguageModelChatMessageRole.User, 'override prompt body'),
            createMessage(vscode.LanguageModelChatMessageRole.Assistant, 'assistant body'),
        ];

        await dumpDebugPrompt('/tmp/debug-prompts', 'step1-analysis', messages, true);

        expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
        expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
            // Windows has another separator
            { fsPath: path.normalize('/tmp/debug-prompts/step1-analysis.messages.md') },
            Buffer.from('<!-- MSG:Assistant -->\n\nassistant body', 'utf-8'),
        );
        expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(
            '[DEBUG] Override active for "step1-analysis": refreshed "step1-analysis.messages.md" → /tmp/debug-prompts',
        );
    });
});
