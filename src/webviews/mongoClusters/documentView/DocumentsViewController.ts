import { ViewColumn } from 'vscode';
import { ext } from '../../../extensionVariables';
import { type DocumentsViewWebviewConfigurationType } from '../../api/configuration/mongoClusters/documentsView';
import { ReactWebviewPanelController } from '../../api/extension-server/ReactWebviewController';

export class DocumentsViewController extends  ReactWebviewPanelController<DocumentsViewWebviewConfigurationType, unknown> {
    constructor(initialData: DocumentsViewWebviewConfigurationType) {

        // ext.context here is the vscode.ExtensionContext required by the ReactWebviewPanelController's original implementation
        // we're not modifying it here in order to be ready for future updates of the webview API.

        super(ext.context, 'Document View Title', 'mongoClustersDocumentView', initialData, ViewColumn.Beside);

        // register rpc handlers

        // initialize
    }


}
