/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { API } from '../../../AzureDBExperiences';
import { ext } from '../../../extensionVariables';
import { WebviewController } from '../../api/extension-server/WebviewController';
<<<<<<<< HEAD:src/webviews/mongoMigration/migrationPanelView/migrationPanelViewController.ts
import { type RouterContext } from './migrationPanelViewRouter';
========
import { type RouterContext } from './assessmentWizardViewRouter';
>>>>>>>> 4d612525 (Assessment Wizard):src/webviews/mongoMigration/assessmentWizardView/assessmentWizardViewController.ts

export type AssessmentWizardViewWebviewConfigurationType = {
    databaserName: string;
    moreSettings?: boolean;
};

<<<<<<<< HEAD:src/webviews/mongoMigration/migrationPanelView/migrationPanelViewController.ts
export class MigrationPanelViewController extends WebviewController<DemoViewWebviewConfigurationType> {
    constructor(initialData: DemoViewWebviewConfigurationType) {
========
export class AssessmentWizardViewController extends WebviewController<AssessmentWizardViewWebviewConfigurationType> {
    constructor(initialData: AssessmentWizardViewWebviewConfigurationType) {
>>>>>>>> 4d612525 (Assessment Wizard):src/webviews/mongoMigration/assessmentWizardView/assessmentWizardViewController.ts
        // ext.context here is the vscode.ExtensionContext required by the ReactWebviewPanelController's original implementation
        // we're not modifying it here in order to be ready for future updates of the webview API.

        const title: string = `Azure Cosmos DB Migration for MongoDB`;

        /**
         * initialData is passed to the webview as a prop, and can be used to initialize the webview's state.
         * use basic data types only, as complex objects may not be serializable.
         */

        /**
         * Note, the 'mongoMigrationDemoView' has to be defined here as well: WebviewRegistry in src/webviews/api/configuration/WebviewRegistry.ts
         * (we'll simplifiy this in the future)
         */
<<<<<<<< HEAD:src/webviews/mongoMigration/migrationPanelView/migrationPanelViewController.ts
        super(ext.context, API.Common, title, 'mongoMigrationPanel', initialData);

        const trpcContext: RouterContext = {
            dbExperience: API.Common,
            webviewName: 'migrationDashboardView',
========
        super(ext.context, API.Common, title, 'assessmentWizard', initialData);

        const trpcContext: RouterContext = {
            dbExperience: API.Common,
            webviewName: 'assessmentWizardView',
>>>>>>>> 4d612525 (Assessment Wizard):src/webviews/mongoMigration/assessmentWizardView/assessmentWizardViewController.ts
            databaseName: initialData.databaserName,
        };

        this.setupTrpc(trpcContext);
    }
}
