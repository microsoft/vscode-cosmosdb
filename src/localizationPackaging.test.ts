/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, resolveConfig } from 'vite';
import { expect, it } from 'vitest';
import manifest from '../package.json';

const root = path.resolve(import.meta.dirname, '..');

it.each(['development', 'production'])(
    'copies extension assets and every shipped localization bundle in %s',
    async (mode) => {
        const config = await resolveConfig(
            { root, configFile: path.join(root, 'vite.config.ext.mjs'), mode, logLevel: 'silent' },
            'build',
        );
        const copyPlugin = config.plugins.find((plugin) => plugin.name === 'copy-static-assets');
        expect(copyPlugin).toBeDefined();
        const outputDirectory = await mkdtemp(path.join(tmpdir(), 'cosmosdb-localization-'));

        try {
            await build({
                configFile: false,
                root,
                mode,
                logLevel: 'silent',
                publicDir: false,
                plugins: [copyPlugin],
                build: {
                    outDir: outputDirectory,
                    emptyOutDir: false,
                    minify: false,
                    lib: {
                        entry: path.join(root, 'src', 'tree', 'TreeElementWithContextValue.ts'),
                        formats: ['es'],
                        fileName: 'packaging-probe',
                    },
                },
            });

            expect(JSON.parse(await readFile(path.join(outputDirectory, 'package.json'), 'utf8'))).toMatchObject({
                l10n: manifest.l10n,
                main: './main.mjs',
            });
            const readme = await readFile(path.join(outputDirectory, 'README.md'), 'utf8');
            const sourceReadme = await readFile(path.join(root, 'README.md'), 'utf8');
            const marketplaceMarker = '<!-- region exclude-from-marketplace -->';
            expect(sourceReadme).toContain(marketplaceMarker);
            expect(readme.includes(marketplaceMarker)).toBe(mode === 'development');
            expect(readme === sourceReadme).toBe(mode === 'development');
            expect(await readFile(path.join(outputDirectory, 'resources', 'azurecosmosdb.png'))).toEqual(
                await readFile(path.join(root, 'resources', 'azurecosmosdb.png')),
            );
            expect(await readdir(path.join(outputDirectory, 'skills'))).toContain('cosmosdb-best-practices');
            expect(await readdir(path.join(outputDirectory, 'syntaxes'))).toContain('nosql.tmLanguage.json');
            const locales = (await readdir(outputDirectory))
                .map((filename) => /^package\.nls\.(.+)\.json$/.exec(filename)?.[1])
                .filter((locale) => locale !== undefined);
            expect(locales).toContain('fr');
            expect(locales).not.toContain('qps-plocm');

            const bundleNames = locales.map((locale) => `bundle.l10n.${locale}.json`).sort();
            const bundleDirectory = path.join(outputDirectory, manifest.l10n);
            expect((await readdir(bundleDirectory)).sort()).toEqual(bundleNames);
            for (const filename of bundleNames) {
                expect(await readFile(path.join(bundleDirectory, filename), 'utf8')).toBe(
                    await readFile(path.join(root, manifest.l10n, filename), 'utf8'),
                );
            }
        } finally {
            await rm(outputDirectory, { recursive: true, force: true });
        }
    },
);
