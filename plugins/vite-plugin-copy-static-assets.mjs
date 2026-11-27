/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomUUID } from 'node:crypto';
import {
    cp,
    glob,
    lstat,
    mkdir,
    readdir,
    readFile,
    realpath,
    rename,
    rm,
    rmdir,
    stat,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';

/** @import { CopyTarget } from './vite-plugin-copy-static-assets.d.mts' */

function isInside(directory, file) {
    const relative = path.relative(directory, file);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function readOwnership(inventory, outDir) {
    let contents;
    try {
        contents = await readFile(inventory, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { ownedFiles: new Set(), ownedDirectories: new Set() };
        }
        throw error;
    }
    const { files, directories } = JSON.parse(contents);
    const resolvePaths = (entries) => {
        if (!Array.isArray(entries)) {
            throw new Error(`Invalid static asset inventory "${inventory}".`);
        }
        return new Set(
            entries.map((entry) => {
                if (typeof entry !== 'string' || path.isAbsolute(entry)) {
                    throw new Error(`Invalid path in static asset inventory "${inventory}".`);
                }
                const output = path.resolve(outDir, entry);
                if (!isInside(outDir, output)) {
                    throw new Error(`Path escapes the output directory in static asset inventory "${inventory}".`);
                }
                return output;
            }),
        );
    };
    return { ownedFiles: resolvePaths(files), ownedDirectories: resolvePaths(directories) };
}

async function writeOwnership(inventory, outDir, { copiedFiles, ownedDirectories }) {
    const relativePaths = (entries) => [...entries].map((entry) => path.relative(outDir, entry)).sort();
    await mkdir(path.dirname(inventory), { recursive: true });
    const pending = `${inventory}.${randomUUID()}.tmp`;
    try {
        await writeFile(
            pending,
            JSON.stringify({ files: relativePaths(copiedFiles), directories: relativePaths(ownedDirectories) }),
        );
        await rename(pending, inventory);
    } finally {
        await rm(pending, { force: true });
    }
}

async function removeStaleFiles(outDir, { ownedFiles, copiedFiles, bundledFiles }) {
    const realOutDir = await realpath(outDir);
    const activeFiles = new Set([...copiedFiles, ...bundledFiles]);
    const activeByCaseFoldedPath = Map.groupBy(activeFiles, (file) => file.toLowerCase());
    for (const previousFile of ownedFiles) {
        if (activeFiles.has(previousFile)) {
            continue;
        }
        try {
            // A different build may have replaced the file or its parents. Never delete through a redirected path.
            if (!(await lstat(previousFile)).isFile()) {
                continue;
            }
            const realFile = await realpath(previousFile);
            if (
                !isInside(realOutDir, realFile) ||
                path.relative(realOutDir, realFile).toLowerCase() !== path.relative(outDir, previousFile).toLowerCase()
            ) {
                continue;
            }
            const aliases = activeByCaseFoldedPath.get(previousFile.toLowerCase()) ?? [];
            if ((await Promise.all(aliases.map((file) => realpath(file)))).includes(realFile)) {
                continue;
            }
            await rm(previousFile, { force: true });
        } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
                throw error;
            }
        }
    }
}

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

async function copyAsset(source, output, transform, state) {
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
        await mkdir(output, { recursive: true });
        // The directory may be shared. Before removing it, verify that every descendant is ours.
        ownedDirectories.add(output);
        for (const name of await readdir(source)) {
            await copyAsset(path.join(source, name), path.join(output, name), undefined, state);
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
    let cacheDir;
    let resolvedTargets;
    const matchedTargets = new Set();

    return {
        name: 'copy-static-assets',
        apply: 'build',
        configResolved(config) {
            root = config.root;
            cacheDir = config.cacheDir;
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
            const outputKey = createHash('sha256').update(outDir).digest('hex');
            // Keep the inventory outside dist so it survives a watcher restart without being packaged.
            const inventory = path.join(cacheDir, 'copy-static-assets', `${outputKey}.json`);
            const state = {
                ...(await readOwnership(inventory, outDir)),
                copiedFiles: new Set(),
                bundledFiles: new Set(Object.keys(bundle).map((filename) => path.join(outDir, filename))),
            };
            for (const { source, destination, transform } of resolvedTargets) {
                const output = path.join(outDir, destination);
                await mkdir(path.dirname(output), { recursive: true });
                await copyAsset(source, output, transform, state);
            }

            await removeStaleFiles(outDir, state);
            await writeOwnership(inventory, outDir, state);
        },
    };
}
