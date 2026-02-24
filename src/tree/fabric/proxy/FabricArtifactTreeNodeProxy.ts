/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArtifactTreeNode, type FabricTreeNode } from '@microsoft/vscode-fabric-api';
import type vscode from 'vscode';
import { type FabricTreeElement } from '../../fabric-resources-view/FabricTreeElement';
import { toTreeItem } from '../../mixins/toTreeItem';
import { type TreeElement } from '../../TreeElement';
import { type FabricArtifact } from '../models/FabricArtifact';
import { FabricTreeNodeProxy } from './FabricTreeNodeProxy';

/**
 * This Proxy acquire the TreeElement properties and methods, and implement the FabricTreeNode interface to be used in the fabric tree view.
 */
export class FabricArtifactTreeNodeProxy extends ArtifactTreeNode implements FabricTreeElement {
    declare public id: string;

    constructor(
        protected readonly context: vscode.ExtensionContext,
        public readonly artifact: FabricArtifact,
        private readonly element: TreeElement,
    ) {
        super(context, artifact);

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
