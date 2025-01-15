/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IAzExtLogOutputChannel, type TreeElementStateManager } from '@microsoft/vscode-azext-utils';
import { type AzureHostExtensionApi } from '@microsoft/vscode-azext-utils/hostapi';
import { type AzureResourcesExtensionApi } from '@microsoft/vscode-azureresources-api';
import { type ExtensionContext, type SecretStorage } from 'vscode';
import { type DatabasesFileSystem } from './DatabasesFileSystem';
import { type NoSqlCodeLensProvider } from './docdb/NoSqlCodeLensProvider';
import { type MongoDBLanguageClient } from './mongo/languageClient';
import { type MongoCodeLensProvider } from './mongo/services/MongoCodeLensProvider';
import { type MongoDatabaseTreeItem } from './mongo/tree/MongoDatabaseTreeItem';
import { type MongoClustersBranchDataProvider } from './mongoClusters/tree/MongoClustersBranchDataProvider';
import { type MongoClustersWorkspaceBranchDataProvider } from './mongoClusters/tree/workspace/MongoClustersWorkbenchBranchDataProvider';
import { type PostgresCodeLensProvider } from './postgres/services/PostgresCodeLensProvider';
import { type PostgresDatabaseTreeItem } from './postgres/tree/PostgresDatabaseTreeItem';
import { type AttachedAccountsTreeItem } from './tree/AttachedAccountsTreeItem';

/**
 * Namespace for common variables used throughout the extension. They must be initialized in the activate() method of extension.ts
 */
export namespace ext {
    export let connectedMongoDB: MongoDatabaseTreeItem | undefined;
    export let connectedPostgresDB: PostgresDatabaseTreeItem | undefined;
    export let context: ExtensionContext;
    export let outputChannel: IAzExtLogOutputChannel;
    export let attachedAccountsNode: AttachedAccountsTreeItem;
    export let isBundle: boolean | undefined;
    export let secretStorage: SecretStorage;
    export let postgresCodeLensProvider: PostgresCodeLensProvider | undefined;
    export const prefix: string = 'azureDatabases';
    export let fileSystem: DatabasesFileSystem;
    export let mongoCodeLensProvider: MongoCodeLensProvider;
    export let noSqlCodeLensProvider: NoSqlCodeLensProvider;
    export let mongoLanguageClient: MongoDBLanguageClient;
    export let rgApi: AzureHostExtensionApi;
    export let rgApiV2: AzureResourcesExtensionApi;

    export let state: TreeElementStateManager;

    // used for the resources tree
    export let mongoClustersBranchDataProvider: MongoClustersBranchDataProvider;

    // used for the workspace: these are the dedicated providers
    export let mongoClustersWorkspaceBranchDataProvider: MongoClustersWorkspaceBranchDataProvider;

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
