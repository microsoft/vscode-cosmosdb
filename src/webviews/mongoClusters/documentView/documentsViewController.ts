/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewColumn } from 'vscode';
import { API } from '../../../AzureDBExperiences';
import { ext } from '../../../extensionVariables';
import { WebviewController } from '../../api/extension-server/WebviewController';
import { type RouterContext } from './documentsViewRouter';

export type DocumentsViewWebviewConfigurationType = {
    id: string; // move to base type

    clusterId: string;
    databaseName: string;
    collectionName: string;
    documentId: string;

    mode: string; // 'add', 'view', 'edit'
};

export class DocumentsViewController extends WebviewController<DocumentsViewWebviewConfigurationType> {
    constructor(initialData: DocumentsViewWebviewConfigurationType) {
        // ext.context here is the vscode.ExtensionContext required by the ReactWebviewPanelController's original implementation
        // we're not modifying it here in order to be ready for future updates of the webview API.

        let title: string = `${initialData.databaseName}/${initialData.collectionName}/*new*`;
        switch (initialData.mode) {
            case 'view':
            case 'edit': {
                title = `${initialData.databaseName}/${initialData.collectionName}/${initialData.documentId}`;
                break;
            }
        }

        super(ext.context, API.MongoClusters, title, 'mongoClustersDocumentView', initialData, ViewColumn.Active);

        const trpcContext: RouterContext = {
            dbExperience: API.MongoClusters,
            webviewName: 'documentView',
            clusterId: initialData.clusterId,
            databaseName: initialData.databaseName,
            collectionName: initialData.collectionName,
            documentId: initialData.documentId,
            viewPanelTitleSetter: (title: string) => {
                this.panel.title = title;
            },
        };

        this.setupTrpc(trpcContext);
    }
}
