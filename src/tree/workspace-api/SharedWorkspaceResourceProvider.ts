/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { type TreeElementWithId } from '@microsoft/vscode-azext-utils';
import { type WorkspaceResource, type WorkspaceResourceProvider } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
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
 * class ClustersWorkspaceBranchDataProvider implements WorkspaceResourceBranchDataProvider<TreeElementBase> {
 *     // Implementation details...
 * }
 *
 * // Register the provider with the type defined in the enum
 * ext.rgApiV2.resources.registerWorkspaceResourceBranchDataProvider(
 *     WorkspaceResourceType.MongoClusters,
 *     new ClustersWorkspaceBranchDataProvider(),
 * );
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
                name: l10n.t('MongoDB Cluster Accounts'), // this name will be displayed in the workspace view, when no WorkspaceResourceBranchDataProvider is registered
            },
            {
                resourceType: WorkspaceResourceType.AttachedAccounts,
                id: 'vscode.cosmosdb.workspace.attachedaccounts',
                name: l10n.t('CosmosDB Accounts'),
            },
        ];
    }
}

/**
 * Extracts the workspace resource ID from a tree item's full ID.
 *
 * @param node - The tree item node containing an ID property
 * @returns The extracted resource ID (the last segment of the full ID path)
 * @throws Error if the ID is not a valid workspace resource ID or doesn't contain a path separator
 *
 * @remarks We store the workspace resources by their initial Id based on their endpoint,
 * however when building the Tree branch we nest the Ids with their parents resulting
 * in node.id being like `${WorkspaceResourceType.AttachedAccounts}/${resourceId}`
 *
 * When mapping back to Ids being used in the storage, always use this function to validate the node
 * and get the right storage Id for a node.
 */
export function getWorkspaceResourceIdFromTreeItem(node: TreeElementWithId): string {
    if (getWorkspaceResourceTypeFromFullId(node.id) === undefined) {
        throw new Error(l10n.t('Invalid workspace resource ID: {0}', node.id));
    }

    const trimmedId = node.id.endsWith('/') ? node.id.slice(0, -1) : node.id;
    const lastIndex = trimmedId.lastIndexOf('/');
    if (lastIndex === -1) {
        throw new Error(l10n.t('Invalid workspace resource ID: {0}', node.id));
    }
    // Extract the last segment of the ID
    return trimmedId.substring(lastIndex + 1);
}

/**
 * Extracts the workspace resource ID from a MongoDB tree item.
 *
 * Unlike standard tree items, MongoDB items contain '/' characters in their IDs,
 * requiring special handling to correctly extract the resource identifier.
 *
 * This function removes the expected prefix structure to isolate the actual resource ID.
 *
 * @param node - The MongoDB tree item node containing an ID property
 * @returns The extracted MongoDB resource ID
 * @throws Error if the ID is not a valid workspace resource ID
 *
 * @remarks Long-term solution would be to avoid '/' characters within individual ID segments.
 */
export function getWorkspaceResourceIdFromMongoTreeItem(node: TreeElementWithId): string {
    if (getWorkspaceResourceTypeFromFullId(node.id) === undefined) {
        throw new Error(l10n.t('Invalid workspace resource ID: {0}', node.id));
    }

    const trimmedId = node.id.endsWith('/') ? node.id.slice(0, -1) : node.id;

    const prefix = `${WorkspaceResourceType.MongoClusters}/`;
    const cleanId = trimmedId.startsWith(prefix + 'localEmulators/')
        ? trimmedId.substring(prefix.length + 'localEmulators/'.length)
        : trimmedId.substring(prefix.length);

    return cleanId;
}

function getWorkspaceResourceTypeFromFullId(fullId: string): WorkspaceResourceType | undefined {
    if (fullId.startsWith(WorkspaceResourceType.AttachedAccounts)) {
        return WorkspaceResourceType.AttachedAccounts;
    } else if (fullId.startsWith(WorkspaceResourceType.MongoClusters)) {
        return WorkspaceResourceType.MongoClusters;
    }
    return undefined;
}
