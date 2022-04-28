/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../../extensionVariables";
import { showPostgresQuery } from "../showPostgresQuery";
import { PostgresStoredProcedureTreeItem } from "../tree/PostgresStoredProcedureTreeItem";

export async function openPostgresStoredProcedure(context: IActionContext, treeItem?: PostgresStoredProcedureTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = <PostgresStoredProcedureTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(PostgresStoredProcedureTreeItem.contextValue, context);
    }

    await showPostgresQuery(treeItem);
}
