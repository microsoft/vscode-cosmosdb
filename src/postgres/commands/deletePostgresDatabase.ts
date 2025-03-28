/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DialogResponses, type IActionContext, type ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';

export async function deletePostgresDatabase(context: IActionContext, node?: PostgresDatabaseTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await ext.rgApi.pickAppResource<PostgresDatabaseTreeItem>(context, {
            filter: [postgresSingleFilter, postgresFlexibleFilter],
            expectedChildContextValue: PostgresDatabaseTreeItem.contextValue,
        });
    }
    const message = l10n.t('Are you sure you want to delete database "{0}"?', node.databaseName);
    const result = await context.ui.showWarningMessage(
        message,
        { modal: true, stepName: 'deletePostgresDatabase' },
        DialogResponses.deleteResponse,
    );
    if (result === DialogResponses.deleteResponse) {
        await node.deleteTreeItem(context);
    }
    const deleteMessage = l10n.t('Successfully deleted database "{0}".', node.databaseName);
    void vscode.window.showInformationMessage(deleteMessage);
    ext.outputChannel.appendLog(deleteMessage);
}
