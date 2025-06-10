/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { API } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { WebviewController } from '../api/extension-server/WebviewController';
import { type RouterContext } from './migrationPanelViewRouter';

export type MigrationPanelWebviewConfigurationType = {
    moreSettings?: boolean;
};

export class MigrationPanelViewController extends WebviewController<MigrationPanelWebviewConfigurationType> {
    constructor(initialData: MigrationPanelWebviewConfigurationType) {
        // ext.context here is the vscode.ExtensionContext required by the ReactWebviewPanelController's original implementation
        // we're not modifying it here in order to be ready for future updates of the webview API.

        const title: string = `Azure Cosmos DB Assessment for MongoDB`;

        /**
         * initialData is passed to the webview as a prop, and can be used to initialize the webview's state.
         * use basic data types only, as complex objects may not be serializable.
         */

        /**
         * Note, the 'mongoMigrationDemoView' has to be defined here as well: WebviewRegistry in src/webviews/api/configuration/WebviewRegistry.ts
         * (we'll simplifiy this in the future)
         */
        super(ext.context, API.Common, title, 'mongoMigrationPanel', initialData);

        const trpcContext: RouterContext = {
            dbExperience: API.Common,
            webviewName: 'MigrationPanel',
        };

        this.setupTrpc(trpcContext);
    }
}
