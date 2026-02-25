/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArtifactTreeNode, type FabricTreeNode } from '@microsoft/vscode-fabric-api';
import type vscode from 'vscode';
import { bindTreeElement } from '../../mixins/toTreeItem';
import { type TreeElement } from '../../TreeElement';
import { type FabricArtifact } from '../models/FabricArtifact';
import { FabricTreeNodeProxy } from './FabricTreeNodeProxy';

/**
 * This Proxy acquire the TreeElement properties and methods, and implement the FabricTreeNode interface to be used in the fabric tree view.
 */
export class FabricArtifactTreeNodeProxy extends ArtifactTreeNode {
    declare public id: string;

    constructor(
        protected readonly context: vscode.ExtensionContext,
        public readonly artifact: FabricArtifact,
        private readonly element: TreeElement,
    ) {
        super(context, artifact);
    }

    public async getChildNodes(): Promise<FabricTreeNode[]> {
        // If data provider attached we have to use it to take into consideration internal implementation of telemetry, cache and etc
        const nodes =
            (this.element.dataProvider
                ? await this.element.dataProvider.getChildren(this.element)
                : this.element.getChildren
                  ? await this.element.getChildren()
                  : []) ?? [];

        return Promise.all(nodes.map((node) => bindTreeElement(new FabricTreeNodeProxy(this.context, node), node)));
    }
}
