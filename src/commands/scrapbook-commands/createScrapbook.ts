/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ScrapbookService } from '../../documentdb/scrapbook/ScrapbookService';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import * as vscodeUtil from '../../utils/vscodeUtils';

export async function createScrapbook(_context: IActionContext, node: DatabaseItem | CollectionItem): Promise<void> {
    const initialFileContents: string = '// MongoDB API Scrapbook: Use this file to run MongoDB API commands\n\n';

    // if (node instanceof CollectionItem) {
    //     initialFileContents += `\n\n// You are connected to the "${node.collectionInfo.name}" collection in the "${node.databaseInfo.name}" database.`;
    // } else if (node instanceof DatabaseItem) {
    //     initialFileContents += `\n\n// You are connected to the "${node.databaseInfo.name}" database.`;
    // }

    await ScrapbookService.setConnectedCluster(node.cluster, node.databaseInfo);

    await vscodeUtil.showNewFile(initialFileContents, 'Scrapbook', '.mongo');
}
