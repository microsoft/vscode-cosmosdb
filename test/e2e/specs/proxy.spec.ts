/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '@playwright/test';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readE2eConfig } from '../fixtures/vscode';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures argument.
test('proxy routing and TLS validation @proxy', async ({}, testInfo) => {
    test.setTimeout(240_000);
    const { vscodeExecutablePath } = readE2eConfig();
    const run = promisify(execFile)(
        process.execPath,
        [path.join(repoRoot, 'scripts/test-proxy.mjs'), vscodeExecutablePath],
        {
            cwd: repoRoot,
            timeout: 180_000,
            // Let @vscode/test-electron close the isolated VS Code instance before the test times out.
            killSignal: 'SIGINT',
            maxBuffer: 10 * 1024 * 1024,
        },
    );
    let output = '';
    run.child.stdout?.on('data', (chunk) => (output += chunk.toString()));
    run.child.stderr?.on('data', (chunk) => (output += chunk.toString()));
    try {
        await run;
    } finally {
        await testInfo.attach('proxy-test-output', { body: output, contentType: 'text/plain' });
    }
});
