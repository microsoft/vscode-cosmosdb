/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from '@playwright/test';

const baseURL = `http://127.0.0.1:4179${process.env.DOCS_BASE ?? '/'}`;

export default defineConfig({
    testDir: '.',
    testMatch: 'playground.spec.ts',
    outputDir: '../e2e/.results/docs',
    workers: 1,
    forbidOnly: !!process.env.CI,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    use: {
        baseURL,
        headless: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        colorScheme: 'light',
        viewport: { width: 1440, height: 1000 },
    },
    webServer: {
        command: 'npm --prefix packages/docs run preview -- --host 127.0.0.1 --port 4179 --strictPort',
        cwd: '../..',
        url: baseURL,
        reuseExistingServer: false,
    },
});
