/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { DataModelingWizardTab } from '../../panels/DataModelingWizardTab';
import { DataModelerProjectService } from '../../services/DataModelerProjectService';

export async function deleteAllDataModelerData(_context: IActionContext): Promise<void> {
    const deleteItem: vscode.MessageItem = { title: l10n.t('Delete All') };
    const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
    const choice = await vscode.window.showWarningMessage(
        l10n.t(
            'This will close all Data Modeler tabs and permanently delete all locally saved Data Modeler data for every account. Deployed databases and containers will not be deleted. This action cannot be undone.',
        ),
        { modal: true },
        deleteItem,
        cancelItem,
    );
    if (choice !== deleteItem) {
        return;
    }

    for (const tab of DataModelingWizardTab.openTabs) {
        tab.dispose();
    }
    await DataModelerProjectService.deleteAllData();
    void vscode.window.showInformationMessage(l10n.t('All local Data Modeler data has been deleted.'));
}
