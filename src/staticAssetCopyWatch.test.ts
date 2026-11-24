/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { copyStaticAssets } from '../plugins/vite-plugin-copy-static-assets.mjs';

it('refreshes copied assets after edits, additions, renames, and deletions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cosmosdb-copy-watch-'));

    try {
        await mkdir(path.join(root, 'assets', 'nested'), { recursive: true });
        await mkdir(path.join(root, 'locales'));
        const entry = path.join(root, 'entry.js');
        const manifest = path.join(root, 'manifest.json');
        await writeFile(entry, 'export const entry = true;\n');
        await writeFile(manifest, '{"initial":true}\n');
        await writeFile(path.join(root, 'locales', 'fr.json'), '{"hello":"bonjour"}\n');
        const outDir = path.join(root, 'dist');

        const watcher = await build({
            root,
            configFile: false,
            publicDir: false,
            logLevel: 'silent',
            plugins: [
                copyStaticAssets({
                    targets: [
                        { src: 'manifest.json' },
                        { src: 'assets' },
                        { src: 'locales/*.json', dest: 'locales', watchDir: 'locales' },
                    ],
                }),
            ],
            build: {
                watch: {},
                emptyOutDir: false,
                minify: false,
                lib: { entry, formats: ['es'], fileName: 'probe' },
            },
        });
        if (!('close' in watcher)) {
            throw new Error('Vite did not return a build watcher.');
        }

        try {
            const expectCopied = async (file: string, contents: string) => {
                await expect.poll(() => readFile(path.join(outDir, file), 'utf8'), { timeout: 4_000 }).toBe(contents);
            };
            await expectCopied('manifest.json', '{"initial":true}\n');
            await writeFile(manifest, '{"initial":false}\n');
            await expectCopied('manifest.json', '{"initial":false}\n');

            await writeFile(path.join(root, 'assets', 'nested', 'new.txt'), 'new asset');
            await expectCopied(path.join('assets', 'nested', 'new.txt'), 'new asset');

            await writeFile(path.join(root, 'locales', 'de.json'), '{"hello":"hallo"}\n');
            await expectCopied(path.join('locales', 'de.json'), '{"hello":"hallo"}\n');

            const sourceAssets = path.join(root, 'assets', 'nested');
            const copiedAssets = path.join(outDir, 'assets', 'nested');
            await writeFile(path.join(copiedAssets, 'webview.txt'), 'unrelated output');
            await rename(path.join(sourceAssets, 'new.txt'), path.join(sourceAssets, 'renamed.txt'));
            const copiedNames = () => readdir(copiedAssets).then((names) => names.sort());
            await expect.poll(copiedNames, { timeout: 4_000 }).toEqual(['renamed.txt', 'webview.txt']);

            await rm(path.join(sourceAssets, 'renamed.txt'));
            await expect.poll(copiedNames, { timeout: 4_000 }).toEqual(['webview.txt']);
            await expectCopied(path.join('assets', 'nested', 'webview.txt'), 'unrelated output');

            await rm(path.join(root, 'locales', 'fr.json'));
            await rm(path.join(root, 'locales', 'de.json'));
            await expect.poll(() => readdir(path.join(outDir, 'locales')), { timeout: 4_000 }).toEqual([]);

            await rm(manifest);
            await expect.poll(() => readdir(outDir), { timeout: 4_000 }).not.toContain('manifest.json');
            await writeFile(manifest, '{"restored":true}\n');
            await expectCopied('manifest.json', '{"restored":true}\n');
        } finally {
            await watcher.close();
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
