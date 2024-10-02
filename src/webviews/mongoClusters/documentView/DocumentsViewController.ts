import { ext } from '../../../extensionVariables';
import { ReactWebviewPanelController } from '../../api/extension/ReactWebviewController';
import { type DocumentsViewWebviewSharedStateType } from '../../api/configuration/mongoClusters/documentsView';

export class DocumentsViewController extends  ReactWebviewPanelController<DocumentsViewWebviewSharedStateType, unknown> {
    constructor(initialData: DocumentsViewWebviewSharedStateType) {

        // ext.context here is the vscode.ExtensionContext required by the ReactWebviewPanelController's original implementation
        // we're not modifying it here in order to be ready for future updates of the webview API.
        super(ext.context, 'Document View Title', 'mongoClustersDocumentView', initialData);

        // register rpc handlers

        // initialize
    }


}
