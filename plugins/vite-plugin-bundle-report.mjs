/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';

/** @param {number} bytes */
function formatSize(bytes) {
    const thresh = 1024;
    if (bytes < thresh) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let u = -1;
    let value = bytes;
    do {
        value /= thresh;
        ++u;
    } while (value >= thresh && u < units.length - 1);
    return `${value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0)} ${units[u]}`;
}

/**
 * Writes `bundle-analysis/bundle-report.json` after every production build.
 * Each entry includes the file name, type, entry flag, imports, and size.
 *
 * This is a lightweight always-on companion to the opt-in HTML bundle
 * analyser (enabled via `BUNDLE_ANALYZE=true`). Both artefacts land in the
 * same `bundle-analysis/` folder, which is already in `.gitignore`.
 *
 * The JSON report is small and cheap to generate — useful for CI size
 * budgets and diffing across branches.
 *
 * @param {{ outFile?: string }} [options]
 * @returns {import('vite').Plugin}
 */
export function bundleReport({ outFile = 'bundle-analysis/bundle-report.json' } = {}) {
    return {
        name: 'bundle-report',

        generateBundle(_, bundle) {
            const report = Object.entries(bundle).map(([fileName, item]) => {
                if (item.type === 'chunk') {
                    const size = Buffer.byteLength(item.code, 'utf8');
                    return {
                        file: fileName,
                        type: item.type,
                        isEntry: item.isEntry,
                        imports: [...item.imports],
                        dynamicImports: [...item.dynamicImports],
                        size,
                        sizeHuman: formatSize(size),
                    };
                } else {
                    const rawSize =
                        typeof item.source === 'string'
                            ? Buffer.byteLength(item.source, 'utf8')
                            : item.source.byteLength;
                    return {
                        file: fileName,
                        type: item.type,
                        isEntry: false,
                        imports: [],
                        dynamicImports: [],
                        size: rawSize,
                        sizeHuman: formatSize(rawSize),
                    };
                }
            });

            // Make sure the destination directory exists. `bundle-analysis/` is
            // gitignored alongside the analyzer's HTML output, so no .gitignore
            // updates are needed.
            fs.mkdirSync(path.dirname(outFile), { recursive: true });
            fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2), {
                encoding: 'utf8',
            });
        },
    };
}
