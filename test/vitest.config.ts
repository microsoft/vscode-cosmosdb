/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vitest/config';
import { vscodePool } from './integration/vscodePool.js';

export default defineConfig({
    test: {
        name: 'integration',
        pool: vscodePool(),
        include: ['out/test/**/*.test.js'],
        exclude: ['out/test/e2e/**'],
        // Only the Extension Host can resolve vscode. Import the compiled tests natively, without Vite's resolver
        // or Node loader hooks replacing VS Code's own module loading.
        experimental: { viteModuleRunner: false, nodeLoader: false },
        maxWorkers: 1,
        fileParallelism: false,
        isolate: false,
        clearMocks: false,
        testTimeout: 20_000,
        hookTimeout: 120_000,
    },
});
