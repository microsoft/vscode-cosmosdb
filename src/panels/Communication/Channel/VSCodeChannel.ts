/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { VSCodeTransport } from '../Transport/VSCodeTransport';
import { CommonChannel } from './CommonChannel';

export class VSCodeChannel extends CommonChannel {
    constructor(webview: vscode.Webview) {
        const transport = new VSCodeTransport(webview);

        super('vscode', transport);
    }

    dispose(): void {
        super.dispose();

        this.transport.dispose();
    }
}
