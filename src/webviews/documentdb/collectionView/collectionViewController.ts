/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { API } from '../../../AzureDBExperiences';
import { ext } from '../../../extensionVariables';
import { WebviewController } from '../../api/extension-server/WebviewController';
import { type RouterContext } from './collectionViewRouter';

export type CollectionViewWebviewConfigurationType = {
    sessionId: string;
    clusterId: string;
    databaseName: string;
    collectionName: string;
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
            clusterId: initialData.clusterId,
            databaseName: initialData.databaseName,
            collectionName: initialData.collectionName,
        };

        this.setupTrpc(trpcContext);
    }
}
