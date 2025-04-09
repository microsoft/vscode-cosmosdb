/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getL10nJson } from '@vscode/l10n-dev';
import * as glob from 'glob';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { utilsBundlePaths } from './constants.mjs';

const GLOB_DEFAULTS = {
    // We only want files.
    nodir: true,
    // Absolute paths are easier to work with.
    absolute: true,
    // Ultimately, we should remove this, but I worry that folks have already taken advantage of the fact that we handled Windows paths.
    // For now, we'll keep it, but in the future, we should remove it.
    windowsPathsNoEscape: true,
};

/**
 * Export strings from TypeScript/JavaScript files.
 * @param {Array} paths - The paths to search for files.
 * @returns {Promise<Object.<string, string>|undefined>} - The extracted strings as a JSON object.
 */
export async function l10nExportStrings(paths) {
    console.log('Searching for TypeScript/JavaScript files...');

    const matches = glob.sync(
        paths.map((p) => (/\.(ts|tsx|js|jsx)$/.test(p) ? p : path.posix.join(p, '{,**}', '*.{ts,tsx,js,jsx}'))),
        GLOB_DEFAULTS,
    );

    const tsFileContents = matches.map((m) => ({
        extension: path.extname(m),
        contents: readFileSync(path.resolve(m), 'utf8'),
    }));

    if (!tsFileContents.length) {
        console.log('No files found.');
        return;
    }

    console.log(`Found ${tsFileContents.length} files. Extracting strings...`);

    const jsonResult = await getL10nJson(tsFileContents);
    const stringsFound = Object.keys(jsonResult).length;

    if (!stringsFound) {
        console.log('No strings found.');
        return;
    }

    console.log(`Extracted ${stringsFound} strings...`);

    return jsonResult;
}

/**
 * Extract localization strings from the specified paths and merge them with utility bundle paths.
 * @param {string|string[]} paths
 * @returns {Promise<Object.<string, string>|undefined>}
 */
export const l10nExportAllStrings = async (paths) => {
    // Extract localization strings from the source files
    const output = await l10nExportStrings(Array.isArray(paths) ? paths : [paths]);

    // If no strings are found, exit the function
    if (!output) {
        return;
    }

    // Log the paths of all localization files being merged
    console.log(`Merging localization files: ${utilsBundlePaths.join(', ')}`);

    // Iterate over all utility bundle paths to merge their contents
    utilsBundlePaths.forEach((filename) => {
        // Read and parse the contents of the current localization file
        const contents = JSON.parse(readFileSync(filename, 'utf8'));

        // Skip invalid or non-object contents
        if (!contents || typeof contents !== 'object' || Array.isArray(contents)) {
            return;
        }

        // Iterate over each key-value pair in the localization file
        Object.entries(contents).forEach(([key, value]) => {
            // Warn if a duplicate key is found and overwrite its value
            if (output[key] && value !== output[key]) {
                console.warn(`Duplicate key found: ${key}. Overwriting with value from ${filename}`);
            }
        });

        // Merge the current file's contents into the output object
        Object.assign(output, contents);
    });

    // Log the total count of unique localization keys
    console.log(`Count of localization keys: ${Object.keys(output).length}`);

    return output;
};

/**
 * Sort an object by its keys.
 * @param {Object.<string, string>} obj
 * @returns {Object.<string, string>}
 */
export const sortObjectByKeys = (obj) => {
    return Object.keys(obj)
        .sort((a, b) => a.localeCompare(b))
        .reduce((acc, key) => {
            acc[key] = obj[key];
            return acc;
        }, {});
};
