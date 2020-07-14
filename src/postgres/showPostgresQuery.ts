/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { postgresBaseFileName, postgresFileExtension } from '../constants';
import * as vscodeUtil from '../utils/vscodeUtils';
import { PostgresFunctionTreeItem } from "./tree/PostgresFunctionTreeItem";
import { PostgresStoredProcedureTreeItem } from "./tree/PostgresStoredProcedureTreeItem";

export async function showPostgresQuery(treeItem: PostgresFunctionTreeItem | PostgresStoredProcedureTreeItem): Promise<void> {
    const fileName: string = `${treeItem.label}-${postgresBaseFileName}`;
    await vscodeUtil.showNewFile(treeItem.definition, fileName, postgresFileExtension);
}
