/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            // Map the `vscode` module to our manual mock so every test file that
            // imports from 'vscode' gets the mock by default.
            // Individual tests may override this by calling vi.mock('vscode', factory).
            vscode: path.resolve(__dirname, 'src/__mocks__/vscode.js'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    },
});
