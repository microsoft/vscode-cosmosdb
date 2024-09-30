import type * as vscode from "vscode";
import { ReactWebviewPanelController } from '../../extension/ReactWebviewController';
import { type DocumentsViewWebviewSharedStateType } from '../../sharedTypes/mongoClusters/documentsView';

export class DocumentsViewController extends  ReactWebviewPanelController<DocumentsViewWebviewSharedStateType, unknown> {
    constructor(context: vscode.ExtensionContext, initialData: DocumentsViewWebviewSharedStateType) {
        super(context, 'MongoDB Documents', 'mongoClusters/documentView/documentView.js', initialData);
    }
}
