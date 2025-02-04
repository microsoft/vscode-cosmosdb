/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Document } from '../../Document/Document';
import { CollectionView } from '../../mongoClusters/collectionView/CollectionView';
import { DocumentView } from '../../mongoClusters/documentView/documentView';
import { DemoView } from '../../mongoMigration/demoView/demoView';
import { QueryEditor } from '../../QueryEditor/QueryEditor';

export const WebviewRegistry = {
    cosmosDbDocument: Document,
    cosmosDbQuery: QueryEditor,
    mongoClustersCollectionView: CollectionView,
    mongoClustersDocumentView: DocumentView,
    mongoMigrationDemoView: DemoView,
} as const;
