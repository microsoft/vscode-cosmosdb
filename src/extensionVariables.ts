/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IAzExtLogOutputChannel, type TreeElementStateManager } from '@microsoft/vscode-azext-utils';
import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import { type AzureHostExtensionApi } from '@microsoft/vscode-azext-utils/hostapi';
import { type ExtensionContext, type SecretStorage } from 'vscode';
import { type DatabasesFileSystem } from './DatabasesFileSystem';
import { type NoSqlCodeLensProvider } from './docdb/NoSqlCodeLensProvider';
import { type MongoDBLanguageClient } from './mongo/languageClient';
import { type MongoClustersBranchDataProvider } from './mongoClusters/tree/MongoClustersBranchDataProvider';
import { type MongoClustersWorkspaceBranchDataProvider } from './mongoClusters/tree/workspace/MongoClustersWorkbenchBranchDataProvider';
import { type MongoDBAccountsWorkspaceItem } from './mongoClusters/tree/workspace/MongoDBAccountsWorkspaceItem';
import { type PostgresCodeLensProvider } from './postgres/services/PostgresCodeLensProvider';
import { type PostgresDatabaseTreeItem } from './postgres/tree/PostgresDatabaseTreeItem';
import { type AttachedAccountsTreeItem } from './tree/AttachedAccountsTreeItem';
import { type CosmosDBBranchDataProvider } from './tree/CosmosDBBranchDataProvider';
import { type CosmosDBWorkspaceBranchDataProvider } from './tree/CosmosDBWorkspaceBranchDataProvider';
import { type CosmosDBWorkspaceItem } from './tree/workspace/CosmosDBWorkspaceItem';

/**
 * Namespace for common variables used throughout the extension. They must be initialized in the activate() method of extension.ts
 */
export namespace ext {
    export let connectedPostgresDB: PostgresDatabaseTreeItem | undefined;
    export let postgresCodeLensProvider: PostgresCodeLensProvider | undefined;

    export let context: ExtensionContext;
    export let outputChannel: IAzExtLogOutputChannel;
    export let attachedAccountsNode: AttachedAccountsTreeItem;
    export let isBundle: boolean | undefined;
    export let secretStorage: SecretStorage;
    export const prefix: string = 'azureDatabases';
    export let fileSystem: DatabasesFileSystem;
    export let noSqlCodeLensProvider: NoSqlCodeLensProvider;
    export let mongoLanguageClient: MongoDBLanguageClient;
    export let rgApi: AzureHostExtensionApi;

    // Since the Azure Resources extension did not update API interface, but added a new interface with activity
    // we have to use the new interface AzureResourcesExtensionApiWithActivity instead of AzureResourcesExtensionApi
    export let rgApiV2: AzureResourcesExtensionApiWithActivity;

    export let state: TreeElementStateManager;

    // TODO: To avoid these stupid variables below the rgApiV2 should have the following public fields (but they are private):
    // - AzureResourceProviderManager,
    // - AzureResourceBranchDataProviderManager,
    // - WorkspaceResourceProviderManager,
    // - WorkspaceResourceBranchDataProviderManager,

    // used for the resources tree and the workspace tree REFRESH
    export let cosmosDBBranchDataProvider: CosmosDBBranchDataProvider;
    // used for the workspace: these are the dedicated providers
    export let cosmosDBWorkspaceBranchDataProvider: CosmosDBWorkspaceBranchDataProvider;
    export let cosmosDBWorkspaceBranchDataResource: CosmosDBWorkspaceItem;

    // used for the resources tree
    export let mongoClustersBranchDataProvider: MongoClustersBranchDataProvider;
    // used for the workspace: these are the dedicated providers
    export let mongoClustersWorkspaceBranchDataProvider: MongoClustersWorkspaceBranchDataProvider;
    export let mongoClusterWorkspaceBranchDataResource: MongoDBAccountsWorkspaceItem;

    export namespace settingsKeys {
        export const mongoShellPath = 'mongo.shell.path';
        export const mongoShellArgs = 'mongo.shell.args';
        export const documentLabelFields = 'cosmosDB.documentLabelFields';
        export const enableEndpointDiscovery = 'cosmosDB.enableEndpointDiscovery';
        export const mongoShellTimeout = 'mongo.shell.timeout';
        export const batchSize = 'azureDatabases.batchSize';
        export const confirmationStyle = 'azureDatabases.confirmationStyle';
        export const showOperationSummaries = 'azureDatabases.showOperationSummaries';

        export namespace vsCode {
            export const proxyStrictSSL = 'http.proxyStrictSSL';
        }
    }
}
