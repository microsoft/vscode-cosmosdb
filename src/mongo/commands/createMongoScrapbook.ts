/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { DatabaseItem } from '../../mongoClusters/tree/DatabaseItem';
import * as vscodeUtil from '../../utils/vscodeUtils';
import { MongoScrapbookService } from '../MongoScrapbookService';

export async function createMongoSrapbook(_context: IActionContext, node: unknown): Promise<void> {
    await vscodeUtil.showNewFile('', 'Scrapbook', '.mongo');

    if (node instanceof DatabaseItem) {
        MongoScrapbookService.setConnectedCluster(node.mongoCluster, node.databaseInfo);
    }
}
