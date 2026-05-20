/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This file uses CommonJS on purpose: Vite's CJS interop maps all module.exports properties
// to named exports, so `import * as vscode from 'vscode'` resolves vscode.window / vscode.commands
// correctly. An ESM `export default` would wrap everything under `.default` and break tests.
// The file is excluded from all linters via ignorePatterns ("**/__mocks__/**/*").

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createVSCodeMock } = require('jest-mock-vscode');

// With globals: true in vitest.config.ts, `vi` is injected as a global in the test environment.
// jest-mock-vscode is framework-agnostic: it only calls testFramework.fn() internally,
// so passing `vi` works perfectly with Vitest.
// eslint-disable-next-line no-undef
const vsCodeMock = createVSCodeMock(vi);

// eslint-disable-next-line no-undef
vsCodeMock.l10n = {
    // eslint-disable-next-line no-undef
    t: vi.fn((msg) => msg),
};

module.exports = vsCodeMock;
