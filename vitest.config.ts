/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            vscode: path.resolve(__dirname, 'src/__mocks__/vscode.ts'),
            '@cosmosdb/nosql-language-service': path.resolve(__dirname, 'packages/nosql-language-service/src/index.ts'),
            '@cosmosdb/schema-analyzer/json': path.resolve(__dirname, 'packages/schema-analyzer/src/json/index.ts'),
            '@cosmosdb/schema-analyzer/bson': path.resolve(__dirname, 'packages/schema-analyzer/src/bson/index.ts'),
            '@cosmosdb/schema-analyzer': path.resolve(__dirname, 'packages/schema-analyzer/src/index.ts'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    },
});
