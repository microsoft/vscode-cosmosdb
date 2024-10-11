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

    documentContent: string;
};

export class DocumentsViewController extends ReactWebviewPanelController<DocumentsViewWebviewConfigurationType> {
    constructor(initialData: DocumentsViewWebviewConfigurationType) {
        // ext.context here is the vscode.ExtensionContext required by the ReactWebviewPanelController's original implementation
        // we're not modifying it here in order to be ready for future updates of the webview API.

        super(ext.context, 'Document View Title', 'mongoClustersDocumentView', initialData, ViewColumn.Beside);

        const trpcContext: RouterContext = {
            liveConnectionId: 'shared context works!',
            databaseName: initialData.databaseName,
            collectionName: initialData.collectionName,
        };

        this.setupTrpc(trpcContext)
    }
}
