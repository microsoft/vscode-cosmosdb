import { ViewColumn } from 'vscode';
import { ext } from '../../../extensionVariables';
import { ReactWebviewPanelController } from '../../api/extension-server/ReactWebviewController';
import { type RouterContext } from './documentsViewRouter';

export type DocumentsViewWebviewConfigurationType = {
    id: string; // move to base type

    liveConnectionId: string;
    databaseName: string;
    collectionName: string;
    documentId: string;

    mode: string; // 'add', 'view', 'edit'
};

export class DocumentsViewController extends ReactWebviewPanelController<DocumentsViewWebviewConfigurationType> {
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

        super(ext.context, title, 'mongoClustersDocumentView', initialData, ViewColumn.Beside);

        const trpcContext: RouterContext = {
            liveConnectionId: initialData.liveConnectionId,
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
