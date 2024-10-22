/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * entry-point for mongoClusters-related code. Activated from ./src/extension.ts
 *
 * We'll try to have everything related to mongoClusters-support managed from here.
 * In case of a failure with this plan, this comment section will be updated.
 */
import {
    callWithTelemetryAndErrorHandling,
    type IActionContext,
    registerCommand,
    registerCommandWithTreeNodeUnwrapping,
} from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { createCollection } from './commands/createCollection';
import { createDatabase } from './commands/createDatabase';
import { dropCollection } from './commands/dropCollection';
import { dropDatabase } from './commands/dropDatabase';
import { mongoClustersExportDocuments } from './commands/exportDocuments';
import { mongoClustersImportDocuments } from './commands/importDocuments';
import { openCollectionView } from './commands/openCollectionView';
import { openDocumentView } from './commands/openDocumentView';
import { MongoClustersBranchDataProvider } from './tree/MongoClustersBranchDataProvider';
import { isMongoClustersSupportenabled } from './utils/isMongoClustersSupportenabled';

export class MongoClustersExtension implements vscode.Disposable {
    dispose(): Promise<void> {
        return Promise.resolve();
    }

    async activate(): Promise<void> {
        await callWithTelemetryAndErrorHandling('mongoClusters.activate', async (activateContext: IActionContext) => {
            activateContext.telemetry.properties.isActivationEvent = 'true';

            const isMongoClustersEnabled: boolean = isMongoClustersSupportenabled() ?? false;

            activateContext.telemetry.properties.mongoClustersEnabled = isMongoClustersEnabled.toString();

            // allows to show/hide commands in the package.json file
            vscode.commands.executeCommand(
                'setContext',
                'vscodeDatabases.mongoClustersSupportEnabled',
                isMongoClustersEnabled,
            );

            if (!isMongoClustersEnabled) {
                return;
            }

            // // // MongoClusters / MongoDB (vCore) support is enabled // // //

            ext.mongoClustersBranchDataProvider = new MongoClustersBranchDataProvider();
            ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
                AzExtResourceType.MongoClusters,
                ext.mongoClustersBranchDataProvider,
            );

            // using registerCommand instead of vscode.commands.registerCommand for better telemetry:
            // https://github.com/microsoft/vscode-azuretools/tree/main/utils#telemetry-and-error-handling
            registerCommand('mongoClusters.cmd.hello', this.commandSayHello);

            registerCommand('mongoClusters.internal.containerView.open', openCollectionView);
            registerCommand('mongoClusters.internal.documentView.open', openDocumentView);

            registerCommandWithTreeNodeUnwrapping('mongoClusters.cmd.dropCollection', dropCollection);
            registerCommandWithTreeNodeUnwrapping('mongoClusters.cmd.dropDatabase', dropDatabase);

            registerCommandWithTreeNodeUnwrapping('mongoClusters.cmd.createCollection', createCollection);
            registerCommandWithTreeNodeUnwrapping('mongoClusters.cmd.createDatabase', createDatabase);

            registerCommandWithTreeNodeUnwrapping('mongoClusters.cmd.importDocuments', mongoClustersImportDocuments);
            registerCommandWithTreeNodeUnwrapping('mongoClusters.cmd.exportDocuments', mongoClustersExportDocuments);

            ext.outputChannel.appendLine(`mongoClusters: activated.`);
        });
    }

    // commands

    commandSayHello = (): void => {
        console.log(`Hello there here!!!`);
        void vscode.window.showInformationMessage('Saying hello here!');

        void vscode.window.showWarningMessage(
            `Are you sure?`,
            { modal: true, detail: "You are about to:\n\ndelete 5 documents.\n\nThis action can't be undone." },
            'Delete',
        );
    };
}
