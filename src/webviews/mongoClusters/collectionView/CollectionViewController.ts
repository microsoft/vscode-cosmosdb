import { ViewColumn } from 'vscode';
import { ext } from '../../../extensionVariables';
import { ReactWebviewPanelController } from '../../api/extension-server/ReactWebviewController';
import { type RouterContext } from './collectionViewRouter';

export type CollectionViewWebviewConfigurationType = {
    id: string; // move to base type

    liveConnectionId: string;
    databaseName: string;
    collectionName: string;
};

export class CollectionViewController extends ReactWebviewPanelController<CollectionViewWebviewConfigurationType> {
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
