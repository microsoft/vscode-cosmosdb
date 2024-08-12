/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DialogResponses, IActionContext, ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import { window } from 'vscode';
import { postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { PostgresFunctionTreeItem } from '../tree/PostgresFunctionTreeItem';

export async function deletePostgresFunction(
    context: IActionContext,
    treeItem?: PostgresFunctionTreeItem,
): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!treeItem) {
        treeItem = await ext.rgApi.pickAppResource<PostgresFunctionTreeItem>(
            { ...context, suppressCreatePick: true },
            {
                filter: [postgresSingleFilter, postgresFlexibleFilter],
                expectedChildContextValue: PostgresFunctionTreeItem.contextValue,
            },
        );
    }

    const message: string = localize(
        'deleteFunction',
        'Are you sure you want to delete function "{0}"?',
        treeItem.label,
    );
    await context.ui.showWarningMessage(
        message,
        { modal: true, stepName: 'deletePostgresFunction' },
        DialogResponses.deleteResponse,
    );
    await treeItem.deleteTreeItem(context);
    const deleteMessage: string = localize(
        'successfullyDeletedFunction',
        'Successfully deleted function "{0}".',
        treeItem.label,
    );
    void window.showInformationMessage(deleteMessage);
    ext.outputChannel.appendLog(deleteMessage);
}
