/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This file uses CommonJS on purpose: Vite's CJS interop maps all module.exports properties
// to named exports, so `import * as vscode from 'vscode'` resolves vscode.window / vscode.commands
// correctly. An ESM `export default` would wrap everything under `.default` and break tests.
// The file is excluded from all linters via ignorePatterns ("**/__mocks__/**/*").

const { createVSCodeMock } = require('jest-mock-vscode');

// With globals: true in vitest.config.ts, `vi` is injected as a global in the test environment.
// jest-mock-vscode is framework-agnostic: it only calls testFramework.fn() internally,
// so passing `vi` works perfectly with Vitest.
const vsCodeMock = createVSCodeMock(vi);

vsCodeMock.l10n = {
    t: vi.fn((msg) => msg),
};

// ─── Language Model API shims ────────────────────────────────────────────────
// jest-mock-vscode does not provide the `vscode.lm` namespace or the
// LanguageModel* value classes. Centralize them here so unit tests (and the
// shared `createMockLanguageModel` helper) get working `instanceof` checks and
// message/part constructors without each test re-shimming them.
class LanguageModelTextPart {
    constructor(public value: string) {}
}

class LanguageModelToolCallPart {
    constructor(
        public callId: string,
        public name: string,
        public input: unknown,
    ) {}
}

class LanguageModelToolResultPart {
    constructor(
        public callId: string,
        public content: unknown,
    ) {}
}

class LanguageModelToolResult {
    constructor(public content: unknown) {}
}

const LanguageModelChatMessageRole = { User: 1, Assistant: 2 };

// Mirror the real API: string input is normalized to a LanguageModelTextPart[]
// so consumers that iterate `message.content` as parts behave correctly.
const toMessageContent = (content: unknown): unknown =>
    typeof content === 'string' ? [new LanguageModelTextPart(content)] : content;

const LanguageModelChatMessage = {
    User: (content: unknown) => ({ role: LanguageModelChatMessageRole.User, content: toMessageContent(content) }),
    Assistant: (content: unknown) => ({
        role: LanguageModelChatMessageRole.Assistant,
        content: toMessageContent(content),
    }),
};

class CancellationTokenSource {
    private listeners: Array<(e: unknown) => void> = [];
    token = {
        isCancellationRequested: false,
        onCancellationRequested: (listener: (e: unknown) => void): { dispose: () => void } => {
            this.listeners.push(listener);
            return {
                dispose: () => {
                    const index = this.listeners.indexOf(listener);
                    if (index >= 0) {
                        this.listeners.splice(index, 1);
                    }
                },
            };
        },
    };
    cancel = (): void => {
        if (this.token.isCancellationRequested) {
            return;
        }
        this.token.isCancellationRequested = true;
        for (const listener of [...this.listeners]) {
            listener(undefined);
        }
    };
    dispose = (): void => {
        this.listeners.length = 0;
    };
}

// jest-mock-vscode lists these under its NotImplemented set, so provide minimal
// constructable shims with the shape `instanceof` checks and error classification
// rely on (`code`, `cause`).
class CancellationError extends Error {
    constructor() {
        super('Canceled');
        this.name = 'CancellationError';
    }
}

class LanguageModelError extends Error {
    code = 'Unknown';
    constructor(message?: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'LanguageModelError';
    }
}

// Only fill gaps — never clobber anything jest-mock-vscode already provides.
vsCodeMock.LanguageModelTextPart ??= LanguageModelTextPart;
vsCodeMock.LanguageModelToolCallPart ??= LanguageModelToolCallPart;
vsCodeMock.LanguageModelToolResultPart ??= LanguageModelToolResultPart;
vsCodeMock.LanguageModelToolResult ??= LanguageModelToolResult;
vsCodeMock.LanguageModelChatMessageRole ??= LanguageModelChatMessageRole;
vsCodeMock.LanguageModelChatMessage ??= LanguageModelChatMessage;
vsCodeMock.CancellationTokenSource ??= CancellationTokenSource;
vsCodeMock.CancellationError ??= CancellationError;
vsCodeMock.LanguageModelError ??= LanguageModelError;
vsCodeMock.lm ??= { tools: [] };

module.exports = vsCodeMock;
