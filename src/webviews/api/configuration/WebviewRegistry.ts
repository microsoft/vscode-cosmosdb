/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Document } from '../../cosmosdb/Document/Document';
import { QueryEditor } from '../../cosmosdb/QueryEditor/QueryEditor';
import { CollectionView } from '../../documentdb/collectionView/CollectionView';
import { DocumentView } from '../../documentdb/documentView/documentView';

export const WebviewRegistry = {
    cosmosDbDocument: Document,
    cosmosDbQuery: QueryEditor,
    mongoClustersCollectionView: CollectionView,
    mongoClustersDocumentView: DocumentView,
} as const;
