/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type WorkspaceResourceBranchDataProvider } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { API } from '../../../AzureDBExperiences';
import { ext } from '../../../extensionVariables';
import { type TreeElement } from '../../TreeElement';
import { AccountsItem } from './AccountsItem';

export class ClustersWorkspaceBranchDataProvider
    extends vscode.Disposable
    implements WorkspaceResourceBranchDataProvider<TreeElement>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeElement | undefined>();

    get onDidChangeTreeData(): vscode.Event<TreeElement | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    constructor() {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
        });
    }

    async getChildren(element: TreeElement): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.experience = API.MongoClusters;
            context.telemetry.properties.view = 'workspace';
            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue ?? 'unknown';

            return (await element.getChildren?.())?.map((child) => {
                if (child.id) {
                    return ext.state.wrapItemInStateHandling(child as TreeElement & { id: string }, () =>
                        this.refresh(child),
                    ) as TreeElement;
                }
                return child;
            });
        });
    }

    getResourceItem(): TreeElement | Thenable<TreeElement> {
        const resourceItem = new AccountsItem();
        // Workspace picker relies on this value
        ext.mongoClusterWorkspaceBranchDataResource = resourceItem;
        return ext.state.wrapItemInStateHandling(resourceItem, (item: TreeElement) =>
            this.refresh(item),
        ) as TreeElement;
    }

    getTreeItem(element: TreeElement): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    /**
     * Optional method to return the parent of `element`.
     * Return `null` or `undefined` if `element` is a child of root.
     *
     * **NOTE:** This method should be implemented in order to access {@link TreeView.reveal reveal} API.
     *
     * @param element The element for which the parent has to be returned.
     * @returns Parent of `element`.
     */
    getParent(element: TreeElement): vscode.ProviderResult<TreeElement | undefined | null> {
        return element.getParent?.() ?? null;
    }

    refresh(element?: TreeElement): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
