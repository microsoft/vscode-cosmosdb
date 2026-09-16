#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Replaces @vscode/test-cli (which is mocha-only) with a thin wrapper around
 * @vscode/test-electron. Downloads VS Code, installs required extensions,
 * then starts Vitest with a single-worker pool hosted inside the extension host.
 */

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVitest } from 'vitest/node';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const VSCODE_VERSION = 'stable';
const REQUIRED_EXTENSIONS = ['ms-azuretools.vscode-azureresourcegroups'];

async function main() {
    // The extension is loaded from `dist/` (Vite produces a self-contained dist with
    // its own package.json whose `main` points to `./main.mjs`). This must be built
    // beforehand via `npm run vite-prod` (or `vite-dev`).
    const extensionDevelopmentPath = path.resolve(repoRoot, 'dist');
    if (!fs.existsSync(path.join(extensionDevelopmentPath, 'main.mjs'))) {
        console.error('Extension is not built yet — run `npm run vite-prod` (or `npm run vite-dev`) first.');
        process.exit(2);
    }

    // Compiled worker entry that was produced by `npm run pretest`.
    const extensionTestsPathRaw = path.resolve(repoRoot, 'out', 'test', 'index.js');
    if (!fs.existsSync(extensionTestsPathRaw)) {
        console.error(`Test entry not found at ${extensionTestsPathRaw} — did "pretest" run?`);
        process.exit(2);
    }

    console.log(`Downloading VS Code (${VSCODE_VERSION})…`);
    const vscodeExecutablePath = await downloadAndUnzipVSCode(VSCODE_VERSION);

    if (REQUIRED_EXTENSIONS.length > 0) {
        const [cli, ...baseArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
        for (const id of REQUIRED_EXTENSIONS) {
            console.log(`Installing dependent extension: ${id}`);
            const args = [...baseArgs, '--install-extension', id];
            const result =
                process.platform === 'win32'
                    ? spawnSync(`call "${cli}" ${args.map((arg) => `"${arg}"`).join(' ')}`, {
                          encoding: 'utf-8',
                          stdio: 'inherit',
                          shell: process.env.ComSpec ?? 'cmd.exe',
                      })
                    : spawnSync(cli, args, { encoding: 'utf-8', stdio: 'inherit' });
            if (result.status !== 0) {
                throw new Error(
                    `Failed to install ${id} (exit code ${result.status}${result.error ? `, error: ${result.error.message}` : ''})`,
                );
            }
        }
    }

    console.log('Launching extension test host…');
    process.env.COSMOSDB_TEST_VSCODE_PATH = vscodeExecutablePath;
    const vitest = await startVitest('test', process.argv.slice(2), {
        root: repoRoot,
        config: path.join(repoRoot, 'out', 'test', 'vitest.config.js'),
        watch: false,
    });
    if (!vitest) throw new Error('Vitest failed to start.');
    await vitest.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
