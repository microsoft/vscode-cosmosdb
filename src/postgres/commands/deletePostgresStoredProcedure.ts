/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DialogResponses, type IActionContext, type ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import { window } from 'vscode';
import { postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { PostgresStoredProcedureTreeItem } from '../tree/PostgresStoredProcedureTreeItem';

export async function deletePostgresStoredProcedure(
    context: IActionContext,
    treeItem?: PostgresStoredProcedureTreeItem,
): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!treeItem) {
        treeItem = await ext.rgApi.pickAppResource<PostgresStoredProcedureTreeItem>(
            { ...context, suppressCreatePick: true },
            {
                filter: [postgresSingleFilter, postgresFlexibleFilter],
                expectedChildContextValue: PostgresStoredProcedureTreeItem.contextValue,
            },
        );
    }

    const message: string = localize(
        'deleteStoredProcedure',
        'Are you sure you want to delete stored procedure "{0}"?',
        treeItem.label,
    );
    await context.ui.showWarningMessage(
        message,
        { modal: true, stepName: 'deletePostgresStoredProcedure' },
        DialogResponses.deleteResponse,
    );
    await treeItem.deleteTreeItem(context);
    const deleteMessage: string = localize(
        'successfullyDeletedStoredProcedure',
        'Successfully deleted stored procedure "{0}".',
        treeItem.label,
    );
    void window.showInformationMessage(deleteMessage);
    ext.outputChannel.appendLog(deleteMessage);
}
