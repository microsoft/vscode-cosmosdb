/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Opens an external URL in the default browser.
 * Only allows http, https, and vscode URIs for security.
 *
 * @param url The URL to open
 * @throws Error if the URL scheme is not allowed
 */
export async function openUrl(url: string): Promise<void> {
    // Validate URL scheme to prevent command injection
    const uri = vscode.Uri.parse(url);
    const allowedSchemes = ['http', 'https', 'vscode'];

    if (!allowedSchemes.includes(uri.scheme)) {
        throw new Error(`Invalid URL scheme: ${uri.scheme}. Only http, https, and vscode schemes are allowed.`);
    }

    // Using this functionality is blocked by https://github.com/Microsoft/vscode/issues/85930
    await vscode.env.openExternal(uri);
}
