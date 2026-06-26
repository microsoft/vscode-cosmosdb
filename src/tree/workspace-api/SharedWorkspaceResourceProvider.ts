/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WorkspaceResource, type WorkspaceResourceProvider } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { isMigrationFeatureEnabled } from '../../commands/migration/migrationFeatureFlag';

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
 * ```
 */
export enum WorkspaceResourceType {
    AttachedAccounts = 'vscode.cosmosdb.workspace.attachedaccounts-resourceType',
    Migrations = 'vscode.cosmosdb.workspace.migrations-resourceType',
}

/**
 * This class serves as the entry point for the workspace resources view.
 * It implements the `WorkspaceResourceProvider` interface to provide resources
 * that will be displayed in the workspace.
 *
 * In this implementation, we register the resource type we want to support,
 * which in this case is `Azure Cosmos DB`. The `getResources` method returns
 * an array of `WorkspaceResource` objects, each representing a resource type
 * that will be available in the workspace.
 *
 * By implementing and registering `WorkspaceResourceBranchDataProvider`,
 * we can create dedicated providers for each resource type, allowing for
 * more specialized handling and display of different types of resources
 * within the workspace.
 */
export class SharedWorkspaceResourceProvider implements WorkspaceResourceProvider {
    private readonly onDidChangeResourceEmitter = new vscode.EventEmitter<WorkspaceResource | undefined>();

    /**
     * Fired when the set of workspace resources changes (e.g. the experimental Cosmos DB
     * Migration feature is toggled), prompting the Workspace view to re-query {@link getResources}.
     */
    public readonly onDidChangeResource = this.onDidChangeResourceEmitter.event;

    // keep signature non-async; return a Thenable (ProviderResult) by returning the helper promise
    getResources(): vscode.ProviderResult<WorkspaceResource[]> {
        const resources: WorkspaceResource[] = [
            {
                resourceType: WorkspaceResourceType.AttachedAccounts,
                id: 'vscode.cosmosdb.workspace.attachedaccounts',
                name: l10n.t('Cosmos DB Accounts'),
            },
        ];

        // The Cosmos DB Migration (Preview) feature can be turned off via an experimental
        // setting; when disabled, hide its workspace node entirely.
        if (isMigrationFeatureEnabled()) {
            resources.push({
                resourceType: WorkspaceResourceType.Migrations,
                id: 'vscode.cosmosdb.workspace.migrations',
                name: l10n.t('Cosmos DB Migrations'),
            });
        }

        return resources;
    }

    /**
     * Trigger a refresh of the workspace resources view (re-invokes {@link getResources}).
     */
    public refresh(): void {
        this.onDidChangeResourceEmitter.fire(undefined);
    }
}
