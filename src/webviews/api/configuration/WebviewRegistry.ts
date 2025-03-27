/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Item } from '../../cosmosdb/Item/Item';
import { QueryEditor } from '../../cosmosdb/QueryEditor/QueryEditor';
import { CollectionView } from '../../documentdb/collectionView/CollectionView';
import { DocumentView } from '../../documentdb/documentView/documentView';

export const WebviewRegistry = {
    cosmosDBItem: Item,
    cosmosDBQuery: QueryEditor,
    mongoClustersCollectionView: CollectionView,
    mongoClustersDocumentView: DocumentView,
} as const;
