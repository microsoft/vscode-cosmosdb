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

const LanguageModelChatMessageRole = { User: 1, Assistant: 2 };

const LanguageModelChatMessage = {
    User: (content: unknown) => ({ role: LanguageModelChatMessageRole.User, content }),
    Assistant: (content: unknown) => ({ role: LanguageModelChatMessageRole.Assistant, content }),
};

class CancellationTokenSource {
    token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
    cancel = vi.fn();
    dispose = vi.fn();
}

// Only fill gaps — never clobber anything jest-mock-vscode already provides.
vsCodeMock.LanguageModelTextPart ??= LanguageModelTextPart;
vsCodeMock.LanguageModelToolCallPart ??= LanguageModelToolCallPart;
vsCodeMock.LanguageModelToolResultPart ??= LanguageModelToolResultPart;
vsCodeMock.LanguageModelChatMessageRole ??= LanguageModelChatMessageRole;
vsCodeMock.LanguageModelChatMessage ??= LanguageModelChatMessage;
vsCodeMock.CancellationTokenSource ??= CancellationTokenSource;
vsCodeMock.lm ??= { tools: [] };

module.exports = vsCodeMock;
