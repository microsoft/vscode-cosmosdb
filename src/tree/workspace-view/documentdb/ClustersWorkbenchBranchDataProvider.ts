/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    type IActionContext,
    type TreeElementBase,
} from '@microsoft/vscode-azext-utils';
import { type WorkspaceResourceBranchDataProvider } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { API } from '../../../AzureDBExperiences';
import { ext } from '../../../extensionVariables';
import { AccountsItem } from './AccountsItem';

export class MongoClustersWorkspaceBranchDataProvider
    extends vscode.Disposable
    implements WorkspaceResourceBranchDataProvider<TreeElementBase>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeElementBase | undefined>();

    get onDidChangeTreeData(): vscode.Event<TreeElementBase | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    constructor() {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
        });
    }

    async getChildren(element: TreeElementBase): Promise<TreeElementBase[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.experience = API.MongoClusters;
            context.telemetry.properties.view = 'workspace';
            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue ?? 'unknown';

            return (await element.getChildren?.())?.map((child) => {
                if (child.id) {
                    return ext.state.wrapItemInStateHandling(child as TreeElementBase & { id: string }, () =>
                        this.refresh(child),
                    );
                }
                return child;
            });
        });
    }

    getResourceItem(): TreeElementBase | Thenable<TreeElementBase> {
        const resourceItem = new AccountsItem();
        // Workspace picker relies on this value
        ext.mongoClusterWorkspaceBranchDataResource = resourceItem;
        return ext.state.wrapItemInStateHandling(resourceItem!, () => this.refresh(resourceItem));
    }

    getTreeItem(element: TreeElementBase): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    refresh(element?: TreeElementBase): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
