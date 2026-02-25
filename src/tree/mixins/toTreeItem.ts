/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type TreeElement } from '../TreeElement';

/**
 * TreeItem interface property keys as defined in VS Code API
 */
const treeItemPropertyKeys: Set<keyof vscode.TreeItem> = new Set([
    'id',
    'label',
    'iconPath',
    'description',
    'resourceUri',
    'tooltip',
    'command',
    'collapsibleState',
    'contextValue',
    'accessibilityInformation',
    'checkboxState',
]);

/**
 * Symbol used to store the bound TreeElement reference
 */
const treeElementBoundSymbol = Symbol('treeElementBound');

/**
 * Type for objects that have the bound TreeElement
 */
type TreeElementBoundHolder = {
    [treeElementBoundSymbol]: TreeElement;
};

/**
 * Checks if an object already has the TreeElement binding applied
 */
export function hasTreeElementBinding(obj: object): obj is TreeElementBoundHolder {
    return treeElementBoundSymbol in obj;
}

/**
 * Gets the bound TreeElement from an object, if any
 */
export function getBoundTreeElement(obj: object): TreeElement | undefined {
    if (hasTreeElementBinding(obj)) {
        return obj[treeElementBoundSymbol];
    }
    return undefined;
}

export async function bindTreeElement<T extends object>(to: T, from: TreeElement): Promise<T & vscode.TreeItem> {
    const treeItem = await from.getTreeItem();

    const result = toTreeItem(to, treeItem);

    // If binding was already applied, just update the TreeElement reference and TreeItem
    if (hasTreeElementBinding(to)) {
        (to as TreeElementBoundHolder)[treeElementBoundSymbol] = from;
        return result;
    }

    // Store the TreeElement reference (writable so it can be updated)
    Object.defineProperty(to, treeElementBoundSymbol, {
        value: from,
        writable: true,
        enumerable: false,
        configurable: false,
    });

    if (from.getTreeItem) {
        const originalGetTreeItem = from.getTreeItem.bind(from) as () => Promise<vscode.TreeItem>;
        from.getTreeItem = async function (): Promise<vscode.TreeItem> {
            const treeItem = await originalGetTreeItem();

            toTreeItem(to, treeItem);

            return treeItem;
        };
    }

    return result;
}

/**
 * Symbol used to store the TreeItem reference
 */
const treeItemSymbol = Symbol('treeItem');

/**
 * Type for objects that have the treeItem symbol
 */
type TreeItemHolder = {
    [treeItemSymbol]: vscode.TreeItem;
};

/**
 * Checks if an object already has the TreeItem mixin applied
 */
export function hasTreeItemMixin(obj: object): obj is TreeItemHolder {
    return treeItemSymbol in obj;
}

/**
 * Creates a Proxy that wraps the target object and delegates all TreeItem property
 * access to the original TreeItem instance.
 * If the mixin was already applied, updates the stored TreeItem reference.
 *
 * @param toObj - The target object to wrap
 * @param fromTreeItem - The source TreeItem instance to proxy TreeItem properties from
 * @returns A Proxy that delegates TreeItem properties to fromTreeItem, all other properties to toObj
 */
export function toTreeItem<T extends object>(toObj: T, fromTreeItem: vscode.TreeItem): T & vscode.TreeItem {
    // If mixin was already applied, just update the stored reference
    if (hasTreeItemMixin(toObj)) {
        (toObj as TreeItemHolder)[treeItemSymbol] = fromTreeItem;
        return toObj as T & vscode.TreeItem;
    }

    // Store the TreeItem reference using a Symbol (writable so it can be updated)
    Object.defineProperty(toObj, treeItemSymbol, {
        value: fromTreeItem,
        writable: true,
        enumerable: false,
        configurable: false,
    });

    return new Proxy(toObj as T & TreeItemHolder, {
        get(target, prop, receiver) {
            if (treeItemPropertyKeys.has(prop as keyof vscode.TreeItem)) {
                return target[treeItemSymbol][prop as keyof vscode.TreeItem];
            }
            return Reflect.get(target, prop, receiver) as unknown;
        },
        set(target, prop, value, receiver) {
            if (treeItemPropertyKeys.has(prop as keyof vscode.TreeItem)) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
                target[treeItemSymbol][prop as keyof vscode.TreeItem] = value as any;
                return true;
            }
            return Reflect.set(target, prop, value, receiver);
        },
        has(target, prop) {
            if (treeItemPropertyKeys.has(prop as keyof vscode.TreeItem)) {
                return true;
            }
            return Reflect.has(target, prop);
        },
        ownKeys(target) {
            const targetKeys = Reflect.ownKeys(target);
            const treeItemKeys = [...treeItemPropertyKeys] as (string | symbol)[];
            return [...new Set([...targetKeys, ...treeItemKeys])];
        },
        getOwnPropertyDescriptor(target, prop) {
            if (treeItemPropertyKeys.has(prop as keyof vscode.TreeItem)) {
                return {
                    enumerable: true,
                    configurable: true,
                    writable: true,
                    value: target[treeItemSymbol][prop as keyof vscode.TreeItem],
                };
            }
            return Reflect.getOwnPropertyDescriptor(target, prop);
        },
    }) as T & vscode.TreeItem;
}
