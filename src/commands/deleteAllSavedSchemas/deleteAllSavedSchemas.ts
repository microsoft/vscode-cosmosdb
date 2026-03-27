/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { SCHEMA_STORAGE_KEY } from '../../constants';
import { StorageNames, StorageService } from '../../services/StorageService';

export async function deleteAllSavedSchemas(_context: IActionContext): Promise<void> {
    const storage = StorageService.get(StorageNames.Default);
    const keys = storage.keys(SCHEMA_STORAGE_KEY);

    if (keys.length === 0) {
        void vscode.window.showInformationMessage(l10n.t('No saved schemas found.'));
        return;
    }

    const message = l10n.t(
        'This will delete all {0} saved container schemas. This action cannot be undone.',
        keys.length,
    );
    const deleteItem: vscode.MessageItem = { title: l10n.t('Delete All') };
    const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, deleteItem, cancelItem);

    if (choice !== deleteItem) {
        return;
    }

    for (const key of keys) {
        await storage.delete(SCHEMA_STORAGE_KEY, key);
    }

    void vscode.window.showInformationMessage(l10n.t('All saved schemas have been deleted.'));
}
