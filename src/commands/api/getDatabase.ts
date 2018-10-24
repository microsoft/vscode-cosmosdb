/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocDBDatabaseTreeItem } from '../../docdb/tree/DocDBDatabaseTreeItem';
import { ext } from '../../extensionVariables';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';

export async function getDatabase(): Promise<string> {
    return (await ext.tree.showTreeItemPicker([MongoDatabaseTreeItem.contextValue, DocDBDatabaseTreeItem.contextValue])).fullId;
}
