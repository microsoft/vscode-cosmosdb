/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { localize } from '../localize';

export function showConfirmationAsInSettings(message: string) {
    const showSummary: boolean | undefined = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.showOperationSummaries);

    if (showSummary) {
        vscode.window.showInformationMessage(message, localize('showConfirmation.ok', 'OK'));
    }
}
