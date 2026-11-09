/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

export async function confirmChatStopped(): Promise<boolean> {
    const confirm = l10n.t('Agent Has Stopped');
    const answer = await vscode.window.showWarningMessage(
        l10n.t(
            'Confirm that the agent has already stopped in Chat. This only clears local run tracking; it does not cancel Chat.',
        ),
        { modal: true },
        confirm,
    );
    return answer === confirm;
}
