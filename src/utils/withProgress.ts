/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function withProgress<T>(
    promise: Thenable<T>,
    title: string,
    location: vscode.ProgressLocation = vscode.ProgressLocation.Notification,
): Thenable<T> {
    return vscode.window.withProgress<T>(
        {
            location: location,
            title: title,
        },
        (_progress) => {
            return promise;
        },
    );
}
