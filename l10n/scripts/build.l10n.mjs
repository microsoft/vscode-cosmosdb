/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';
import { bundlePath } from './constants.mjs';
import { l10nExportStrings, sortObjectByKeys } from './utils.mjs';

// Function to build the localization bundle
const buildLocalisationBundle = async () => {
    // Extract localization strings from the source files
    const output = await l10nExportStrings(['./src']);

    // Log the path of the merged localization file being written
    console.log(`Writing merged localization file: ${bundlePath}`);

    // Write the merged localization data to the output file in a formatted JSON structure
    fs.writeFileSync(bundlePath, JSON.stringify(sortObjectByKeys(output), null, 2));
};

// Execute the function to build the localization bundle
await buildLocalisationBundle();
