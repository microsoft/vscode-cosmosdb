/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cp, glob, lstat, mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** @import { CopyTarget } from './vite-plugin-copy-static-assets.d.mts' */

async function removeOwnedDirectory(directory, { ownedFiles, ownedDirectories, copiedFiles, bundledFiles }) {
    const files = [];
    const directories = [];
    const conflict = () => new Error(`Cannot replace "${directory}" without removing unrelated build output.`);

    // Check the whole subtree before deleting anything. Never recursively remove shared output.
    async function collect(dir) {
        if (!ownedDirectories.has(dir)) {
            throw conflict();
        }
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const output = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await collect(output);
            } else if (!ownedFiles.has(output) || copiedFiles.has(output) || bundledFiles.has(output)) {
                throw conflict();
            } else {
                files.push(output);
            }
        }
        directories.push(dir);
    }
    await collect(directory);

    for (const file of files) {
        await rm(file, { force: true });
        ownedFiles.delete(file);
    }
    for (const dir of directories) {
        await rmdir(dir);
        ownedDirectories.delete(dir);
    }
}

async function copyFile(source, output, transform) {
    if (transform) {
        await writeFile(output, await transform(await readFile(source, 'utf8'), source));
    } else {
        await cp(source, output, { dereference: true });
    }
}

async function copyWatchedAsset(source, output, transform, state) {
    const { ownedFiles, ownedDirectories, copiedFiles, bundledFiles } = state;
    const sourceIsDirectory = !transform && (await stat(source)).isDirectory();
    const existing = await lstat(output).catch((error) => {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    });
    if (sourceIsDirectory) {
        if (existing && !existing.isDirectory()) {
            if (!ownedFiles.has(output) || copiedFiles.has(output) || bundledFiles.has(output)) {
                throw new Error(`Cannot replace "${output}" without removing unrelated build output.`);
            }
            await rm(output);
        }
        ownedFiles.delete(output);
        if (await mkdir(output, { recursive: true })) {
            ownedDirectories.add(output);
        }
        for (const name of await readdir(source)) {
            await copyWatchedAsset(path.join(source, name), path.join(output, name), undefined, state);
        }
    } else {
        if (existing?.isDirectory()) {
            await removeOwnedDirectory(output, state);
        }
        ownedDirectories.delete(output);
        await copyFile(source, output, transform);
        ownedFiles.add(output);
        copiedFiles.add(output);
    }
}

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
    const matchedTargets = new Set();
    const ownershipByOutDir = new Map();

    return {
        name: 'copy-static-assets',
        apply: 'build',
        configResolved(config) {
            root = config.root;
        },
        async buildStart() {
            resolvedTargets = [];
            for (const target of targets) {
                const { src, dest = '.', watchDir, transform } = target;
                if (this.meta.watchMode && watchDir) {
                    this.addWatchFile(path.resolve(root, watchDir));
                }

                const matches = await Array.fromAsync(glob(src, { cwd: root }));
                if (matches.length === 0) {
                    // Rolldown keeps previously registered paths watched even after deletion.
                    if (this.meta.watchMode && matchedTargets.has(target)) {
                        continue;
                    }
                    throw new Error(`No static assets matched "${src}" in "${root}".`);
                }
                matchedTargets.add(target);

                for (const match of matches.sort()) {
                    const source = path.join(root, match);
                    if (this.meta.watchMode) {
                        this.addWatchFile(source);
                    }
                    resolvedTargets.push({ source, destination: path.join(dest, path.basename(match)), transform });
                }
            }
        },
        async writeBundle({ dir }, bundle) {
            if (!dir) {
                throw new Error('Static asset copying requires an output directory.');
            }

            const outDir = path.resolve(root, dir);
            let state;
            if (this.meta.watchMode) {
                let ownership = ownershipByOutDir.get(outDir);
                if (!ownership) {
                    ownership = { ownedFiles: new Set(), ownedDirectories: new Set() };
                    ownershipByOutDir.set(outDir, ownership);
                }
                state = {
                    ...ownership,
                    copiedFiles: new Set(),
                    bundledFiles: new Set(Object.keys(bundle).map((filename) => path.join(outDir, filename))),
                };
            }
            for (const { source, destination, transform } of resolvedTargets) {
                const output = path.join(outDir, destination);
                await mkdir(path.dirname(output), { recursive: true });
                if (state) {
                    await copyWatchedAsset(source, output, transform, state);
                } else if (transform) {
                    await copyFile(source, output, transform);
                } else {
                    await cp(source, output, { recursive: true, dereference: true });
                }
            }

            if (state) {
                for (const previousFile of state.ownedFiles) {
                    if (!state.copiedFiles.has(previousFile)) {
                        if (!state.bundledFiles.has(previousFile)) {
                            await rm(previousFile, { force: true });
                        }
                        state.ownedFiles.delete(previousFile);
                    }
                }
            }
        },
    };
}
