/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    // Vite's built-in esbuild transform handles the automatic JSX runtime for the React component
    // tests (driven by the `jsx: react-jsx` compiler option), so no extra React plugin is needed.
    // React component tests opt into a DOM environment per-file via a `// @vitest-environment jsdom`
    // docblock; everything else runs in the default node environment.
    resolve: {
        alias: {
            vscode: path.resolve(__dirname, 'src/__mocks__/vscode.ts'),
            '@cosmosdb/nosql-language-service': path.resolve(__dirname, 'packages/nosql-language-service/src/index.ts'),
            '@cosmosdb/schema-analyzer/json': path.resolve(__dirname, 'packages/schema-analyzer/src/json/index.ts'),
            '@cosmosdb/schema-analyzer/bson': path.resolve(__dirname, 'packages/schema-analyzer/src/bson/index.ts'),
            '@cosmosdb/schema-analyzer': path.resolve(__dirname, 'packages/schema-analyzer/src/index.ts'),
            '@cosmosdb/webview-rpc/client': path.resolve(__dirname, 'packages/webview-rpc/src/client/index.ts'),
            '@cosmosdb/webview-rpc/react': path.resolve(__dirname, 'packages/webview-rpc/src/react/index.ts'),
            '@cosmosdb/webview-rpc': path.resolve(__dirname, 'packages/webview-rpc/src/index.ts'),
        },
    },
    test: {
        globals: true,
        // Node is the default for the bulk of the suite. React component tests opt into a DOM
        // environment per-file via a `// @vitest-environment jsdom` docblock at the top of the file.
        environment: 'node',
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'packages/*/src/**/*.test.ts'],
        setupFiles: ['./vitest.setup.ts'],
        testTimeout: 15_000,
        coverage: {
            reporter: ['text', 'cobertura', 'html'],
            exclude: [
                ...coverageConfigDefaults.exclude,
                // Theme color utilities adapted from open-source projects (CSS WG / Material color
                // tooling). Excluded from coverage since they are third-party code, not authored here.
                'src/webviews/theme/utils/**',
            ],
        },
    },
});
