/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'node:path';

export const currentDir = process.cwd();
export const localizationPath = path.join(currentDir, 'l10n');
export const nodeModulesPath = path.join(currentDir, 'node_modules');
export const bundleName = 'bundle.l10n.json';
export const bundlePath = path.join(localizationPath, bundleName);
export const utilsBundlePaths = [
    path.join(nodeModulesPath, '@microsoft/vscode-azext-utils/', 'l10n', bundleName),
    path.join(nodeModulesPath, '@microsoft/vscode-azext-azureutils/', 'l10n', bundleName),
    path.join(localizationPath, '@microsoft/vscode-azext-azureauth/', bundleName),
];
