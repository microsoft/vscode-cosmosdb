/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Document } from '../../Document/Document';
import { CollectionView } from '../../mongoClusters/collectionView/CollectionView';
import { DocumentView } from '../../mongoClusters/documentView/documentView';
import { AssessmentWizardView } from '../../mongoMigration/assessmentWizardView/assessmentWizardView';
import { MigrationPanel } from '../../mongoMigration/migrationPanelView/MigrationPanel';
import { QueryEditor } from '../../QueryEditor/QueryEditor';

export const WebviewRegistry = {
    cosmosDbDocument: Document,
    cosmosDbQuery: QueryEditor,
    mongoClustersCollectionView: CollectionView,
    mongoClustersDocumentView: DocumentView,
    mongoMigrationPanel: MigrationPanel,
    assessmentWizard: AssessmentWizardView,
} as const;
