/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { wellKnownEmulatorPassword } from './cosmosdb-shared-constants';

/**
 * Guard against the well-known Cosmos DB emulator key being re-introduced as a
 * literal anywhere in code that ends up bundled into the published extension.
 *
 * The VS Code Marketplace credential scanner flags the literal as an "apparent
 * Azure Cosmos DB key" and blocks publishing. The key is intentionally stored
 * base64-encoded in cosmosdb-shared-constants.ts and decoded at runtime.
 *
 * This test sources the key from the runtime-decoded export so the literal
 * never appears in this test file either.
 */
describe('wellKnownEmulatorPassword literal guard', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');

    // File extensions that contribute to the published bundle.
    const scannedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

    // Directories that are NOT bundled into dist/main.mjs and are therefore
    // exempt from the literal-key ban (docs, build scripts, test fixtures, etc.).
    const excludedDirs = new Set([
        'node_modules',
        'dist',
        'out',
        '.vscode-test',
        'bundle-analysis',
        'docs',
        'skills',
        'skills-backup',
        'scripts',
        'l10n',
        'resources',
        '__mocks__',
        'test-fixtures',
        'test',
    ]);

    function collectFiles(dir: string, out: string[]): void {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (excludedDirs.has(entry.name)) continue;
                collectFiles(full, out);
            } else if (entry.isFile()) {
                out.push(full);
            }
        }
    }

    it('decoded key matches the documented well-known emulator key shape', () => {
        // Sanity check: 88 chars of base64 ending in "==".
        expect(wellKnownEmulatorPassword).toHaveLength(88);
        expect(wellKnownEmulatorPassword.endsWith('==')).toBe(true);
    });

    it('key literal does not appear in any bundled source file', () => {
        const offenders: string[] = [];
        const files: string[] = [];

        // Search both src/ and bundled packages/*/src (excluding test fixtures).
        for (const root of [path.join(repoRoot, 'src'), path.join(repoRoot, 'packages')]) {
            if (existsSync(root)) {
                collectFiles(root, files);
            }
        }

        for (const file of files) {
            // Skip test files — they're never bundled.
            if (/\.test\.[cm]?[jt]sx?$/.test(file)) continue;

            const ext = path.extname(file);
            if (!scannedExtensions.has(ext)) continue;

            const content = readFileSync(file, 'utf8');
            if (content.includes(wellKnownEmulatorPassword)) {
                offenders.push(path.relative(repoRoot, file));
            }
        }

        if (offenders.length > 0) {
            throw new Error(
                `The well-known Cosmos DB emulator key literal was found in bundled source files. ` +
                    `Import 'wellKnownEmulatorPassword' from 'src/cosmosdb/cosmosdb-shared-constants.ts' ` +
                    `instead of inlining the literal — the Marketplace credscan will reject it. ` +
                    `Offending files:\n  ${offenders.join('\n  ')}`,
            );
        }
        expect(offenders).toEqual([]);
    });
});
