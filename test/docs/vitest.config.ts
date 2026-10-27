/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vitest/config';

// Keep the root suite's workspace-source aliases out of published-package tests.
export default defineConfig({
    test: {
        include: ['packages/docs/src/**/*.test.ts'],
        environment: 'node',
        allowOnly: !process.env.CI,
    },
});
