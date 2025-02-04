/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type CollectionItem } from '../../mongoClusters/tree/CollectionItem';
import { type DatabaseItem } from '../../mongoClusters/tree/DatabaseItem';
import * as vscodeUtil from '../../utils/vscodeUtils';
import { MongoScrapbookService } from '../MongoScrapbookService';

export async function createMongoScrapbook(
    _context: IActionContext,
    node: DatabaseItem | CollectionItem,
): Promise<void> {
    const initialFileContents: string = '// MongoDB API Scrapbook: Use this file to run MongoDB API commands\n\n';

    await MongoScrapbookService.setConnectedCluster(node.mongoCluster, node.databaseInfo);

    await vscodeUtil.showNewFile(initialFileContents, 'Scrapbook', '.mongo');
}
