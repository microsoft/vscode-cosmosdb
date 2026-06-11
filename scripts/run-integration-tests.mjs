#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Replaces @vscode/test-cli (which is mocha-only) with a thin wrapper around
 * @vscode/test-electron. Downloads VS Code, installs required extensions,
 * then runs our custom @vitest/runner-driven test entry inside the extension host.
 */

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const VSCODE_VERSION = 'stable';
const REQUIRED_EXTENSIONS = ['ms-azuretools.vscode-azureresourcegroups'];

async function main() {
    // The extension is loaded from `dist/` (Vite produces a self-contained dist with
    // its own package.json whose `main` points to `./main.mjs`). This must be built
    // beforehand via `npm run vite-prod` (or `vite-dev`).
    // Both paths are run through realpathSync.native so the drive-letter case matches
    // what Node uses elsewhere — critical on Windows where ESM caches modules by URL
    // and `file:///c:/...` and `file:///C:/...` are treated as distinct modules.
    const extensionDevelopmentPath = fs.realpathSync.native(path.resolve(repoRoot, 'dist'));
    if (!fs.existsSync(path.join(extensionDevelopmentPath, 'main.mjs'))) {
        console.error('Extension is not built yet — run `npm run vite-prod` (or `npm run vite-dev`) first.');
        process.exit(2);
    }

    // Compiled vitest-runner entry that was produced by `npm run pretest`.
    const extensionTestsPathRaw = path.resolve(repoRoot, 'out', 'test', 'index.js');
    if (!fs.existsSync(extensionTestsPathRaw)) {
        console.error(`Test entry not found at ${extensionTestsPathRaw} — did "pretest" run?`);
        process.exit(2);
    }
    const extensionTestsPath = fs.realpathSync.native(extensionTestsPathRaw);

    console.log(`Downloading VS Code (${VSCODE_VERSION})…`);
    const vscodeExecutablePath = await downloadAndUnzipVSCode(VSCODE_VERSION);

    if (REQUIRED_EXTENSIONS.length > 0) {
        const [cli, ...baseArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
        for (const id of REQUIRED_EXTENSIONS) {
            console.log(`Installing dependent extension: ${id}`);
            const result = spawnSync(cli, [...baseArgs, '--install-extension', id], {
                encoding: 'utf-8',
                stdio: 'inherit',
                // Required on Windows when `cli` resolves to a .cmd / .bat (e.g. bin/code.cmd):
                // child_process.spawn on Windows cannot launch shell scripts without a shell.
                shell: process.platform === 'win32',
            });
            if (result.status !== 0) {
                throw new Error(
                    `Failed to install ${id} (exit code ${result.status}${result.error ? `, error: ${result.error.message}` : ''})`,
                );
            }
        }
    }

    console.log('Launching extension test host…');
    const exitCode = await runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath,
        extensionTestsPath,
        extensionTestsEnv: {
            DEBUGTELEMETRY: 'v',
        },
        launchArgs: [
            // Avoid prompting about workspace trust during the test run.
            '--disable-workspace-trust',
        ],
    });

    process.exit(exitCode);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
