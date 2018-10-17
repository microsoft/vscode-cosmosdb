/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocDBDatabaseTreeItem } from '../../../src/docdb/tree/DocDBDatabaseTreeItem';
import { MongoDatabaseTreeItem } from '../../../src/mongo/tree/MongoDatabaseTreeItem';
import { ext } from '../../extensionVariables';

export async function getDatabase(): Promise<String> {
    return (await ext.tree.showTreeItemPicker([MongoDatabaseTreeItem.contextValue, DocDBDatabaseTreeItem.contextValue])).fullId;
}
