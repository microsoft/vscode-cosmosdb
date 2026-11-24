/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cp, glob, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** @import { CopyTarget } from './vite-plugin-copy-static-assets.d.mts' */

/**
 * Copy files or directories matched by `src` into `dest`, preserving each match's basename.
 * Sources are relative to the project root; destinations are relative to the output directory.
 * Watch mode tracks matches and, with `watchDir`, a source directory where new glob matches may appear.
 *
 * @param {{ targets: CopyTarget[] }} options
 * @returns {import('vite').Plugin}
 */
export function copyStaticAssets({ targets }) {
    let root;
    let resolvedTargets;

    return {
        name: 'copy-static-assets',
        apply: 'build',
        configResolved(config) {
            root = config.root;
        },
        async buildStart() {
            resolvedTargets = [];
            for (const { src, dest = '.', watchDir, transform } of targets) {
                if (this.meta.watchMode && watchDir) {
                    this.addWatchFile(path.resolve(root, watchDir));
                }

                const matches = await Array.fromAsync(glob(src, { cwd: root }));
                if (matches.length === 0) {
                    throw new Error(`No static assets matched "${src}" in "${root}".`);
                }

                for (const match of matches.sort()) {
                    const source = path.join(root, match);
                    if (this.meta.watchMode) {
                        this.addWatchFile(source);
                    }
                    resolvedTargets.push({ source, destination: path.join(dest, path.basename(match)), transform });
                }
            }
        },
        async writeBundle({ dir }) {
            if (!dir) {
                throw new Error('Static asset copying requires an output directory.');
            }

            const outDir = path.resolve(root, dir);
            for (const { source, destination, transform } of resolvedTargets) {
                const output = path.join(outDir, destination);
                await mkdir(path.dirname(output), { recursive: true });
                if (transform) {
                    await writeFile(output, await transform(await readFile(source, 'utf8'), source));
                } else {
                    await cp(source, output, { recursive: true, dereference: true });
                }
            }
        },
    };
}
