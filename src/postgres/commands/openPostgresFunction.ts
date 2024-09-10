/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { showPostgresQuery } from '../showPostgresQuery';
import { PostgresFunctionTreeItem } from '../tree/PostgresFunctionTreeItem';

export async function openPostgresFunction(
    context: IActionContext,
    treeItem?: PostgresFunctionTreeItem,
): Promise<void> {
    if (!treeItem) {
        treeItem = await ext.rgApi.pickAppResource<PostgresFunctionTreeItem>(context, {
            filter: [postgresSingleFilter, postgresFlexibleFilter],
            expectedChildContextValue: PostgresFunctionTreeItem.contextValue,
        });
    }

    await showPostgresQuery(treeItem);
}
