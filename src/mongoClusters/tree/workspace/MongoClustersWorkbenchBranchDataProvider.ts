/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { type WorkspaceResourceBranchDataProvider } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { type TreeItem } from 'vscode';
import { ext } from '../../../extensionVariables';
import { MongoDBAccountsItem } from './MongoDBAccountsWorkspaceItem';

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
        return (await element.getChildren?.())?.map((child) => {
            if (child.id) {
                return ext.state.wrapItemInStateHandling(child as TreeElementBase & { id: string }, () =>
                    this.refresh(child),
                );
            }
            return child;
        });
    }

    getResourceItem(): TreeElementBase | Thenable<TreeElementBase> {
        const resourceItem = new MongoDBAccountsItem();
        return ext.state.wrapItemInStateHandling(resourceItem!, () => this.refresh(resourceItem));
    }

    getTreeItem(element: TreeElementBase): TreeItem | Thenable<TreeItem> {
        return element.getTreeItem();
    }

    refresh(element?: TreeElementBase): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
