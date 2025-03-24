/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';

const output = {};

const files = [
    './bundle.l10n.json',
    './@microsoft/vscode-azext-utils/bundle.l10n.json',
    './@microsoft/vscode-azext-azureutils/bundle.l10n.json',
    './@microsoft/vscode-azext-azureauth/bundle.l10n.json',
];

console.log(`Merging localization files: ${files.join(', ')}`);

files.forEach((filename) => {
    const contents = JSON.parse(fs.readFileSync(filename, 'utf8'));

    if (!contents) {
        return;
    }

    Object.entries(contents).forEach(([key, value]) => {
        if (output[key] && value !== output[key]) {
            console.warn(`Duplicate key found: ${key}. Overwriting with value from ${filename}`);
            process.exit(1);
        }
    });

    Object.assign(output, contents);
});

console.log(`Count of localization keys: ${Object.keys(output).length}`);
console.log(`Writing merged localization file: bundle.l10n.json`);

fs.writeFileSync('bundle.l10n.json', JSON.stringify(output, null, 2));
