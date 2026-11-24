/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { copyStaticAssets } from '../plugins/vite-plugin-copy-static-assets.mjs';

it('refreshes copied assets after edits and additions without changing a bundled module', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cosmosdb-copy-watch-'));

    try {
        await mkdir(path.join(root, 'assets', 'nested'), { recursive: true });
        await mkdir(path.join(root, 'locales'));
        const entry = path.join(root, 'entry.js');
        const manifest = path.join(root, 'manifest.json');
        await writeFile(entry, 'export const entry = true;\n');
        await writeFile(manifest, '{"initial":true}\n');
        await writeFile(path.join(root, 'locales', 'fr.json'), '{"hello":"bonjour"}\n');

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
                minify: false,
                lib: { entry, formats: ['es'], fileName: 'probe' },
            },
        });
        if (!('close' in watcher)) {
            throw new Error('Vite did not return a build watcher.');
        }

        try {
            const expectCopied = async (file: string, contents: string) => {
                await expect
                    .poll(() => readFile(path.join(root, 'dist', file), 'utf8'), { timeout: 4_000 })
                    .toBe(contents);
            };
            await expectCopied('manifest.json', '{"initial":true}\n');
            await writeFile(manifest, '{"initial":false}\n');
            await expectCopied('manifest.json', '{"initial":false}\n');

            await writeFile(path.join(root, 'assets', 'nested', 'new.txt'), 'new asset');
            await expectCopied(path.join('assets', 'nested', 'new.txt'), 'new asset');

            await writeFile(path.join(root, 'locales', 'de.json'), '{"hello":"hallo"}\n');
            await expectCopied(path.join('locales', 'de.json'), '{"hello":"hallo"}\n');
        } finally {
            await watcher.close();
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
