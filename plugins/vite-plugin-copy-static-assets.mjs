/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cp, glob, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {{
 *     src: string,
 *     dest?: string,
 *     transform?: (content: string, source: string) => string | Promise<string>,
 * }} CopyTarget
 */

/**
 * Copy files or directories matched by `src` into `dest`, preserving each match's basename.
 * Sources are relative to the project root; destinations are relative to the output directory.
 *
 * @param {{ targets: CopyTarget[] }} options
 * @returns {import('vite').Plugin}
 */
export function copyStaticAssets({ targets }) {
    let root;

    return {
        name: 'copy-static-assets',
        apply: 'build',
        configResolved(config) {
            root = config.root;
        },
        async writeBundle({ dir }) {
            if (!dir) {
                throw new Error('Static asset copying requires an output directory.');
            }

            const outDir = path.resolve(root, dir);
            for (const { src, dest = '.', transform } of targets) {
                const matches = await Array.fromAsync(glob(src, { cwd: root }));
                if (matches.length === 0) {
                    throw new Error(`No static assets matched "${src}" in "${root}".`);
                }

                const destination = path.join(outDir, dest);
                await mkdir(destination, { recursive: true });
                for (const match of matches.sort()) {
                    const source = path.join(root, match);
                    const output = path.join(destination, path.basename(match));
                    if (transform) {
                        await writeFile(output, await transform(await readFile(source, 'utf8'), source));
                    } else {
                        await cp(source, output, { recursive: true, dereference: true });
                    }
                }
            }
        },
    };
}
