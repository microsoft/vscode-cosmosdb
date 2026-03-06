/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FabricTreeNode } from '@microsoft/vscode-fabric-api';
import type vscode from 'vscode';
import { isTreeElement, type TreeElement } from '../TreeElement';

export interface FabricTreeElement extends vscode.TreeItem {
    id: string;
    element: TreeElement;

    getChildNodes(): Promise<FabricTreeNode[]>; // Fabric specific method
}

export function isFabricTreeElement(node: unknown): node is FabricTreeElement {
    return !!(
        node &&
        typeof node === 'object' &&
        'getChildNodes' in node &&
        typeof node.getChildNodes === 'function' &&
        'element' in node &&
        isTreeElement(node.element)
    );
}
