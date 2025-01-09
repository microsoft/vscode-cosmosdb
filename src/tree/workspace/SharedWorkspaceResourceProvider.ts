/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { type WorkspaceResource, type WorkspaceResourceProvider } from '@microsoft/vscode-azureresources-api';
import type * as vscode from 'vscode';

/**
 * Enum representing the types of resources that can be registered in the workspace.
 *
 * This enum is used to define the types of resources that can be registered within the workspace.
 * By defining a type here, you can then implement and register a `WorkspaceResourceBranchDataProvider`
 * and use the type defined here during the registration process.
 *
 * Example usage:
 *
 * ```typescript
 * // Implement your WorkspaceResourceBranchDataProvider
 * class MongoClustersWorkspaceBranchDataProvider implements WorkspaceResourceBranchDataProvider<TreeElementBase> {
 *     // Implementation details...
 * }
 *
 * // Register the provider with the type defined in the enum
 * ext.rgApiV2.resources.registerWorkspaceResourceBranchDataProvider(
 *     WorkspaceResourceType.MongoClusters,
 *     new MongoClustersWorkspaceBranchDataProvider(),
 * );
 * workspace.registerResourceProvider(WorkspaceResourceType.MongoClusters, new MongoClustersDataProvider());
 * ```
 */
export enum WorkspaceResourceType {
    MongoClusters = 'vscode.cosmosdb.workspace.mongoclusters-resourceType',
    AttachedAccounts = 'vscode.cosmosdb.workspace.attachedaccounts-resourceType',
}

/**
 * This class serves as the entry point for the workspace resources view.
 * It implements the `WorkspaceResourceProvider` interface to provide resources
 * that will be displayed in the workspace.
 *
 * In this implementation, we register the resource type we want to support,
 * which in this case is `MongoClusters`. The `getResources` method returns
 * an array of `WorkspaceResource` objects, each representing a resource type
 * that will be available in the workspace.
 *
 * By implementing and registering `WorkspaceResourceBranchDataProvider`,
 * we can create dedicated providers for each resource type, allowing for
 * more specialized handling and display of different types of resources
 * within the workspace.
 */
export class SharedWorkspaceResourceProvider implements WorkspaceResourceProvider {
    getResources(): vscode.ProviderResult<WorkspaceResource[]> {
        return [
            {
                resourceType: WorkspaceResourceType.MongoClusters,
                id: 'vscode.cosmosdb.workspace.mongoclusters',
                name: 'MongoDB Cluster Accounts', // this name will be displayed in the workspace view, when no WorkspaceResourceBranchDataProvider is registered
            },
            {
                resourceType: WorkspaceResourceType.AttachedAccounts,
                id: 'vscode.cosmosdb.workspace.attachedaccounts',
                name: 'Attached Database Accounts',
            },
        ];
    }
}
