/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DialogResponses, type IActionContext, type ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import { window } from 'vscode';
import { postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { PostgresTableTreeItem } from '../tree/PostgresTableTreeItem';

export async function deletePostgresTable(context: IActionContext, node?: PostgresTableTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await ext.rgApi.pickAppResource<PostgresTableTreeItem>(
            { ...context, suppressCreatePick: true },
            {
                filter: [postgresSingleFilter, postgresFlexibleFilter],
                expectedChildContextValue: PostgresTableTreeItem.contextValue,
            },
        );
    }
    const message: string = localize(
        'deletesPostgresTable',
        'Are you sure you want to delete table "{0}"?',
        node.label,
    );
    await context.ui.showWarningMessage(
        message,
        { modal: true, stepName: 'deletePostgresTable' },
        DialogResponses.deleteResponse,
    );
    await node.deleteTreeItem(context);
    const deleteMessage: string = localize('successfullyDeletedTable', 'Successfully deleted table "{0}".', node.label);
    void window.showInformationMessage(deleteMessage);
    ext.outputChannel.appendLog(deleteMessage);
}
