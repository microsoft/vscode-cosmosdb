/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { builtinModules } from 'module';

/**
 * Fails the build immediately if any module in the browser bundle tries to
 * import 'vscode' or a Node.js built-in ('node:*', 'fs', 'path', 'os', …).
 *
 * This catches accidental extension-host code leaking into the webview bundle
 * at build time rather than at runtime.
 *
 * @returns {import('vite').Plugin}
 */
export function noExtensionImports() {
    // builtinModules: authoritative list from Node.js itself — no manual maintenance needed.
    const NODE_BUILTINS = new Set(builtinModules);

    return {
        name: 'no-extension-imports',
        enforce: 'pre',
        resolveId(source) {
            if (source === 'vscode') {
                throw new Error(
                    `[no-extension-imports] Importing 'vscode' is not allowed in webview code.\n` +
                        `  Check the import chain that led to this import.`,
                );
            }
            if (source.startsWith('node:') || NODE_BUILTINS.has(source)) {
                throw new Error(
                    `[no-extension-imports] Importing Node.js built-in '${source}' is not allowed in webview code.\n` +
                        `  Check the import chain that led to this import.`,
                );
            }
        },
    };
}
