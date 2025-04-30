/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';
import { bundlePath } from './constants.mjs';
import { l10nExportAllStrings, sortObjectByKeys } from './utils.mjs';

// Function to check if the localization bundle has changed
const checkLocalisationBundle = async () => {
    // Extract localization strings from the source files
    const output = await l10nExportAllStrings(['./src']);

    if (!output) {
        console.log('No localization strings found.');
        return;
    }

    // Read the existing localization bundle file
    const bundleOld = fs.readFileSync(bundlePath, 'utf8').trim().replace(/\r\n/g, '\n');
    // Serialize the merged localization data
    const bundleNew = JSON.stringify(sortObjectByKeys(output), null, 2).trim().replace(/\r\n/g, '\n');

    // Compare the old and new bundles to check for changes
    if (bundleOld !== bundleNew) {
        console.log('Localization file has changed. Please run "npm run l10n" to update it.');
        process.exit(1); // Exit with an error code if changes are detected
    } else {
        console.log('Localization file is up to date.');
    }
};

// Execute the function to check the localization bundle
await checkLocalisationBundle();
