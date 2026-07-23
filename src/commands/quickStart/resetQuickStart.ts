/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { resetQuickStartState } from '../../utils/quickStart/quickStartStorage';

/**
 * Internal command (command palette only) that clears all persisted Quick Start
 * state, so the onboarding tour can be re-tested. After running it, reopen the
 * Query Editor to see the tips play again from the start.
 */
export async function resetQuickStart(_context: IActionContext): Promise<void> {
    await resetQuickStartState();
    void vscode.window.showInformationMessage(
        l10n.t('Quick Start tips have been reset. Reopen the Query Editor to see them again.'),
    );
}
