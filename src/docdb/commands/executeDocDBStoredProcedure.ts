/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import { localize } from '../../utils/localize';
import { DocDBStoredProcedureTreeItem } from '../tree/DocDBStoredProcedureTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function executeDocDBStoredProcedure(
    context: IActionContext,
    node?: DocDBStoredProcedureTreeItem,
): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickDocDBAccount<DocDBStoredProcedureTreeItem>(context, DocDBStoredProcedureTreeItem.contextValue);
    }

    const partitionKey = await context.ui.showInputBox({
        title: 'Partition Key',
        // @todo: add a learnMoreLink
    });

    const paramString = await context.ui.showInputBox({
        title: 'Parameters',
        placeHolder: localize(
            'executeCosmosStoredProcedureParameters',
            'empty or array of values e.g. [1, {key: value}]',
        ),
        // @todo: add a learnMoreLink
    });

    let parameters: (string | number | object)[] | undefined = undefined;
    if (paramString !== '') {
        try {
            parameters = JSON.parse(paramString) as (string | number | object)[];
        } catch {
            // Ignore parameters if they are invalid
        }
    }

    await node.execute(context, partitionKey, parameters);
}
