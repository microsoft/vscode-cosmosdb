/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IAzExtLogOutputChannel, type TreeElementStateManager } from '@microsoft/vscode-azext-utils';
import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import type * as vscode from 'vscode';
import { type DatabasesFileSystem } from './DatabasesFileSystem';
import { type CosmosDBBranchDataProvider } from './tree/azure-resources-view/cosmosdb/CosmosDBBranchDataProvider';
import { type CosmosDBWorkspaceBranchDataProvider } from './tree/workspace-view/cosmosdb/CosmosDBWorkspaceBranchDataProvider';
import { type CosmosDBWorkspaceItem } from './tree/workspace-view/cosmosdb/CosmosDBWorkspaceItem';

/**
 * Namespace for common variables used throughout the extension. They must be initialized in the activate() method of extension.ts
 */
export namespace ext {
    export const prefix: string = 'azureDatabases';
    export let context: vscode.ExtensionContext;
    export let outputChannel: IAzExtLogOutputChannel;
    export let isBundle: boolean | undefined;
    export let secretStorage: vscode.SecretStorage;
    export let fileSystem: DatabasesFileSystem;
    export let rgApiV2: AzureResourcesExtensionApiWithActivity;

    export let state: TreeElementStateManager;

    // TODO: To avoid these three below variables below the rgApiV2 should have the following public fields (but they are private):
    // - AzureResourceProviderManager,
    // - AzureResourceBranchDataProviderManager,
    // - WorkspaceResourceProviderManager,
    // - WorkspaceResourceBranchDataProviderManager,

    // used for the resources tree and the workspace tree REFRESH
    export let cosmosDBBranchDataProvider: CosmosDBBranchDataProvider;
    // used for the workspace: these are the dedicated providers
    export let cosmosDBWorkspaceBranchDataProvider: CosmosDBWorkspaceBranchDataProvider;
    export let cosmosDBWorkspaceBranchDataResource: CosmosDBWorkspaceItem;

    // Tracks whether AI features (chat participant, AI button) are enabled
    // This is set to true when GitHub Copilot and Copilot Chat extensions are installed
    export let isAIFeaturesEnabled: boolean;

    export namespace settingsKeys {
        export const documentLabelFields = 'cosmosDB.documentLabelFields';
        export const enableEndpointDiscovery = 'cosmosDB.enableEndpointDiscovery';
        export const batchSize = 'azureDatabases.batchSize';
        export const confirmationStyle = 'azureDatabases.confirmationStyle';
        export const showOperationSummaries = 'azureDatabases.showOperationSummaries';
        export const cosmosDbAuthentication = 'azureDatabases.cosmosDB.preferredAuthenticationMethod';
        export const authManagedIdentityClientId = 'azureDatabases.authentication.managedIdentity.clientID';

        export namespace vsCode {
            export const proxyStrictSSL = 'http.proxyStrictSSL';
        }
    }
}
