/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FabricTreeNode } from '@microsoft/vscode-fabric-api';
import type vscode from 'vscode';
import { TreeItemCollapsibleState } from 'vscode';
import { ext } from '../../../extensionVariables';
import { type TreeElement } from '../../TreeElement';
import { type FabricTreeElement } from '../../fabric-resources-view/FabricTreeElement';
import { toTreeItem } from '../../mixins/toTreeItem';

/**
 * This Proxy acquire the TreeElement properties and methods, and implement the FabricTreeNode interface to be used in the fabric tree view.
 */
export class FabricTreeNodeProxy extends FabricTreeNode implements FabricTreeElement {
    declare public id: string;

    constructor(private readonly element: TreeElement) {
        super(ext.context, 'FabricTreeNodeProxy', TreeItemCollapsibleState.None);

        return this.mapTreeElementToTreeItem();
    }

    public async getChildNodes(): Promise<FabricTreeNode[]> {
        // If data provider attached we have to use it to take into consideration internal implementation of telemetry, cache and etc
        if (this.element.dataProvider) {
            const nodes = (await this.element.dataProvider.getChildren(this.element)) ?? [];
            return nodes.map((node) => new FabricTreeNodeProxy(node));
        }

        // If no, try to call getChildren from element
        if (this.element.getChildren) {
            const nodes = (await this.element.getChildren()) ?? [];
            return nodes.map((node) => new FabricTreeNodeProxy(node));
        }

        return [];
    }

    public getTreeItem(): vscode.TreeItem {
        return this.element.getTreeItem();
    }

    private mapTreeElementToTreeItem(): this & vscode.TreeItem {
        const treeItem = this.getTreeItem();

        return toTreeItem(this, treeItem);
    }
}
