/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
    type WorkspaceResource,
    type WorkspaceResourceProvider
} from '@microsoft/vscode-azureresources-api';
import type * as vscode from 'vscode';

export enum WorkspaceResourceType {
    MongoClusters = 'vscode.cosmosdb.workspace.mongoclusters-resourceType'
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
export class WorkspaceDataProvider implements WorkspaceResourceProvider {
    getResources(): vscode.ProviderResult<WorkspaceResource[]> {
        return [
            {
                resourceType: WorkspaceResourceType.MongoClusters,
                id: 'vscode.cosmosdb.workspace.mongoclusters',
                name: 'MongoDB Accounts',
            }
        ];
    }
}
