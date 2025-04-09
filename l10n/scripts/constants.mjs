/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'node:path';

export const localizationPath = './l10n';
export const bundleName = 'bundle.l10n.json';
export const bundlePath = path.join(localizationPath, bundleName);
export const utilsBundlePaths = [
    path.join(localizationPath, '@microsoft/vscode-azext-utils/', bundleName),
    path.join(localizationPath, '@microsoft/vscode-azext-azureutils/', bundleName),
    path.join(localizationPath, '@microsoft/vscode-azext-azureauth/', bundleName),
];
