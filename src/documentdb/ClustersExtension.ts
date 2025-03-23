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
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { createMongoCollection } from '../commands/createContainer/createContainer';
import { createMongoDocument } from '../commands/createDocument/createDocument';
import { deleteAzureContainer } from '../commands/deleteContainer/deleteContainer';
import { deleteAzureDatabase } from '../commands/deleteDatabase/deleteDatabase';
import {
    mongoClustersExportEntireCollection,
    mongoClustersExportQueryResults,
} from '../commands/exportDocuments/exportDocuments';
import { importDocuments } from '../commands/importDocuments/importDocuments';
import { launchShell } from '../commands/launchShell/launchShell';
import { openCollectionView, openCollectionViewInternal } from '../commands/openCollectionView/openCollectionView';
import { openMongoDocumentView } from '../commands/openDocument/openDocument';
import { ext } from '../extensionVariables';
import { MongoVCoreBranchDataProvider } from '../tree/azure-resources-view/documentdb/mongo-vcore/MongoVCoreBranchDataProvider';
import { WorkspaceResourceType } from '../tree/workspace-api/SharedWorkspaceResourceProvider';
import { MongoClustersWorkspaceBranchDataProvider } from '../tree/workspace-view/documentdb/ClustersWorkbenchBranchDataProvider';
import { registerScrapbookCommands } from './scrapbook/registerScrapbookCommands';
import { isMongoClustersSupportenabled } from './utils/isMongoClustersSupportenabled';

export class ClustersExtension implements vscode.Disposable {
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

                ext.mongoClustersBranchDataProvider = new MongoVCoreBranchDataProvider();
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

                registerCommand('command.internal.mongoClusters.documentView.open', openMongoDocumentView);

                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.launchShell', launchShell);

                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.dropCollection', deleteAzureContainer);
                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.dropDatabase', deleteAzureDatabase);

                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.createCollection', createMongoCollection);

                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.createDocument', createMongoDocument);

                registerCommandWithTreeNodeUnwrapping('command.mongoClusters.importDocuments', importDocuments);

                registerScrapbookCommands();

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

                ext.outputChannel.appendLine(l10n.t('MongoDB Clusters: activated.'));
            },
        );
    }
}
