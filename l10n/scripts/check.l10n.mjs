/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as diff from 'diff';
import fs from 'node:fs';
import { bundlePath } from './constants.mjs';
import { l10nExportAllStrings, sortObjectByKeys } from './utils.mjs';

/**
 * Compares two strings and returns a readable diff
 */
function getStringDiff(oldStr, newStr) {
    const differences = diff.diffLines(oldStr, newStr);
    let result = '';

    differences.forEach((part) => {
        // Format the output - added parts in green, removed in red
        const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
        const formattedText = part.value
            .split('\n')
            .filter((line) => line.trim() !== '')
            .map((line) => prefix + line)
            .join('\n');

        if (formattedText) {
            result += formattedText + '\n';
        }
    });

    return result;
}

// Function to check if the localization bundle has changed
const checkLocalisationBundle = async () => {
    // Extract localization strings from the source files
    const output = await l10nExportAllStrings(['./src']);

    if (!output) {
        console.log('No localization strings found.');
        return;
    }

    // Read the existing localization bundle file
    const bundleOld = JSON.stringify(sortObjectByKeys(JSON.parse(fs.readFileSync(bundlePath, 'utf8'))));
    // Serialize the merged localization data
    const bundleNew = JSON.stringify(sortObjectByKeys(output));

    // Compare the old and new bundles to check for changes
    if (getStringDiff(bundleOld, bundleNew)) {
        console.log('Localization file has changed. Please run "npm run l10n" to update it.');
        process.exit(1); // Exit with an error code if changes are detected
    } else {
        console.log('Localization file is up to date.');
    }
};

// Execute the function to check the localization bundle
await checkLocalisationBundle();
