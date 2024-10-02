import { QueryEditor } from '../../QueryEditor/QueryEditor';
import { CollectionView } from '../../mongoClusters/collectionView/CollectionView';
import { DocumentView } from '../../mongoClusters/documentView/documentView';

export const WebviewRegistry = {
    cosmosDbQuery: QueryEditor,
    mongoClustersCollectionView: CollectionView,
    mongoClustersDocumentView: DocumentView,
} as const;

