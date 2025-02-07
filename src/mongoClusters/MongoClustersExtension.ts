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
import { createMongoCollection } from '../commands/createContainer/createContainer';
import { deleteAzureContainer } from '../commands/deleteContainer/deleteContainer';
import { deleteAzureDatabase } from '../commands/deleteDatabase/deleteDatabase';
import { launchShell } from '../commands/launchShell/launchShell';
import { ext } from '../extensionVariables';
import { WorkspaceResourceType } from '../tree/workspace/SharedWorkspaceResourceProvider';
import { createDocument } from './commands/createDocument';
import { mongoClustersExportEntireCollection, mongoClustersExportQueryResults } from './commands/exportDocuments';
import { mongoClustersImportDocuments } from './commands/importDocuments';
import { openCollectionView, openCollectionViewInternal } from './commands/openCollectionView';
import { openDocumentView } from './commands/openDocumentView';
import { MongoClustersBranchDataProvider } from './tree/MongoClustersBranchDataProvider';
import { MongoClustersWorkspaceBranchDataProvider } from './tree/workspace/MongoClustersWorkbenchBranchDataProvider';
import { isMongoClustersSupportenabled } from './utils/isMongoClustersSupportenabled';

export class MongoClustersExtension implements vscode.Disposable {
    dispose(): Promise<void> {
        return Promise.resolve();
    }

    async activate(): Promise<void> {
        await callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoClusters.activate',
            async (activateContext: IActionContext) => {
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

                // Moved to extension.ts
                // ext.workspaceDataProvider = new SharedWorkspaceResourceProvider();
                // ext.rgApiV2.resources.registerWorkspaceResourceProvider(ext.workspaceDataProvider);

                ext.mongoClustersWorkspaceBranchDataProvider = new MongoClustersWorkspaceBranchDataProvider();
                ext.rgApiV2.resources.registerWorkspaceResourceBranchDataProvider(
                    WorkspaceResourceType.MongoClusters,
                    ext.mongoClustersWorkspaceBranchDataProvider,
                );

                // using registerCommand instead of vscode.commands.registerCommand for better telemetry:
                // https://github.com/microsoft/vscode-azuretools/tree/main/utils#telemetry-and-error-handling

                /**
                 * Here, opening the collection view is done in two ways: one is accessible from the tree view
                 * via a context menu, and the other is accessible programmatically. Both of them
                 * use the same underlying function to open the collection view.
                 *
                 * openCollectionView calls openCollectionViewInternal with no additional parameters.
                 *
                 * It was possible to merge the two commands into one, but it would result in code that is
                 * harder to understand and maintain.
                 */
                registerCommand('command.internal.mongoClusters.containerView.open', openCollectionViewInternal);
                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.containerView.open', openCollectionView);

                registerCommand('command.internal.mongoClusters.documentView.open', openDocumentView);

                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.launchShell', launchShell);

                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.dropCollection', deleteAzureContainer);
                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.dropDatabase', deleteAzureDatabase);

                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.createCollection', createMongoCollection);

                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.createDocument', createDocument);

                registerCommandWithTreeNodeUnwrapping(
                    'command.mongoClusters.importDocuments',
                    mongoClustersImportDocuments,
                );

                /**
                 * Here, exporting documents is done in two ways: one is accessible from the tree view
                 * via a context menu, and the other is accessible programmatically. Both of them
                 * use the same underlying function to export documents.
                 *
                 * mongoClustersExportEntireCollection calls mongoClustersExportQueryResults with no queryText.
                 *
                 * It was possible to merge the two commands into one, but it would result in code that is
                 * harder to understand and maintain.
                 */
                registerCommand('command.internal.mongoClusters.exportDocuments', mongoClustersExportQueryResults);
                registerCommandWithTreeNodeUnwrapping(
                    'command.mongoClusters.exportDocuments',
                    mongoClustersExportEntireCollection,
                );

                ext.outputChannel.appendLine(`MongoDB Clusters: activated.`);
            },
        );
    }
}
