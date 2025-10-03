/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This file is copy of main.js. It was created to not brake the old build process, but provides the same functionality as main.js.
// The old webpack config changes the source code of the main.js file to replace the import statements with require statements.
// The new webpack config does not do this anymore, uses swc for transpiling and does not change the source code.

// This is the extension entrypoint module, which imports extension.bundle.js, the actual extension code.
// This is in a separate file so we can properly measure extension.bundle.js load time.

import { type apiUtils } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import * as extension from './src/extension';

const perfStats = {
    loadStartTime: Date.now(),
    loadEndTime: -1,
};

export async function activate(ctx: vscode.ExtensionContext): Promise<apiUtils.AzureExtensionApiProvider> {
    if (process.env['STOP_ON_ENTRY'] === 'true') {
        /**
         * It's useful to have a debugger statement here to stop the extension at the very beginning.
         * Otherwise, it's hard to attach the debugger to the extension host process before the extension starts.
         * In some environments (for example Windows+WSL), the extension host process starts quickly,
         * before the debugger can attach.
         */

        // eslint-disable-next-line no-debugger
        debugger;
    }

    return extension.activateInternal(ctx, perfStats);
}

export async function deactivate(ctx: vscode.ExtensionContext): Promise<void> {
    return extension.deactivateInternal(ctx);
}

perfStats.loadEndTime = Date.now();

// Since not all unit/integration tests right now might be moved to jest, we need to export some classes/functions.
export * from './src/utils/getIp';
