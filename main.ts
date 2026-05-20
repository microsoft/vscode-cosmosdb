/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Entry point for the extension bundle (Vite/Rolldown build).

import { type apiUtils } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import * as extension from './src/extension';

export async function activate(ctx: vscode.ExtensionContext): Promise<apiUtils.AzureExtensionApiProvider | void> {
    if (process.env['STOP_ON_ENTRY'] === 'true') {
        /**
         * It's useful to have a debugger statement here to stop the extension at the very beginning.
         * Otherwise, it's hard to attach the debugger to the extension host process before the extension starts.
         * In some environments (for example Windows+WSL), the extension host process starts quickly,
         * before the debugger can attach.
         */

        // oxlint-disable-next-line no-debugger -- intentional: helps attach debugger before fast startup
        debugger;
    }

    return extension.activateInternal(ctx);
}

export async function deactivate(ctx: vscode.ExtensionContext): Promise<void> {
    return extension.deactivateInternal(ctx);
}
