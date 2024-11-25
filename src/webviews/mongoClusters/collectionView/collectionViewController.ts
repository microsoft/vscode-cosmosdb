/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { API } from '../../../AzureDBExperiences';
import { ext } from '../../../extensionVariables';
import { type CollectionItem } from '../../../mongoClusters/tree/CollectionItem';
import { WebviewController } from '../../api/extension-server/WebviewController';
import { type RouterContext } from './collectionViewRouter';

export type CollectionViewWebviewConfigurationType = {
    id: string; // move to base type

    sessionId: string;
    databaseName: string;
    collectionName: string;
    collectionTreeItem: CollectionItem; // needed to execute commands on the collection as the tree APIv2 doesn't support id-based search for tree items.
};

export class CollectionViewController extends WebviewController<CollectionViewWebviewConfigurationType> {
    constructor(initialData: CollectionViewWebviewConfigurationType) {
        // ext.context here is the vscode.ExtensionContext required by the ReactWebviewPanelController's original implementation
        // we're not modifying it here in order to be ready for future updates of the webview API.

        const title: string = `${initialData.databaseName}/${initialData.collectionName}`;

        super(ext.context, API.MongoClusters, title, 'mongoClustersCollectionView', initialData);

        const trpcContext: RouterContext = {
            dbExperience: API.MongoClusters,
            webviewName: 'collectionView',
            sessionId: initialData.sessionId,
            databaseName: initialData.databaseName,
            collectionName: initialData.collectionName,
            collectionTreeItem: initialData.collectionTreeItem,
        };

        this.setupTrpc(trpcContext);
    }
}
