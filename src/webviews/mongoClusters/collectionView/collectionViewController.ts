/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewColumn } from 'vscode';
import { ext } from '../../../extensionVariables';
import { WebviewController } from '../../api/extension-server/WebviewController';
import { type RouterContext } from './collectionViewRouter';

export type CollectionViewWebviewConfigurationType = {
    id: string; // move to base type

    liveConnectionId: string;
    databaseName: string;
    collectionName: string;
};

export class CollectionViewController extends WebviewController<CollectionViewWebviewConfigurationType> {
    constructor(initialData: CollectionViewWebviewConfigurationType) {
        // ext.context here is the vscode.ExtensionContext required by the ReactWebviewPanelController's original implementation
        // we're not modifying it here in order to be ready for future updates of the webview API.

        const title: string = `${initialData.databaseName}/${initialData.collectionName}`;

        super(ext.context, title, 'mongoClustersCollectionView', initialData, ViewColumn.Beside);

        const trpcContext: RouterContext = {
            liveConnectionId: initialData.liveConnectionId,
            databaseName: initialData.databaseName,
            collectionName: initialData.collectionName,
        };

        this.setupTrpc(trpcContext);
    }
}