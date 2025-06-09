/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createGenericElement, type GenericElementOptions } from '@microsoft/vscode-azext-utils';
import { type TreeElement } from '../tree/TreeElement';

/**
 * Options for creating a generic tree element with context support
 */
export interface GenericElementWithContextOptions extends Omit<GenericElementOptions, 'contextValue'> {
    /**
     * The context value to set on the tree item.
     * This is used for commands, menu visibility, and error identification.
     */
    contextValue?: string;
}

/**
 * Creates a generic tree element with context value support.
 * This extends the default createGenericElement function to allow setting the contextValue property,
 * which is needed for error node identification and retry functionality.
 *
 * @param options Options for creating the element, including contextValue
 * @returns A tree element with the specified context value
 */
export function createGenericElementWithContext(options: GenericElementWithContextOptions): TreeElement {
    // Create base options without contextValue for createGenericElement
    const baseOptions: GenericElementOptions = {
        ...options,
        contextValue: options.contextValue || 'generic', // Provide default value since it's required
    };
    
    const element = createGenericElement(baseOptions) as TreeElement;
    
    // Override contextValue if needed
    if (options.contextValue && options.contextValue !== 'generic') {
        // Override getTreeItem to include the custom contextValue
        const originalGetTreeItem = element.getTreeItem.bind(element);
        element.getTreeItem = async () => {
            const treeItem = await originalGetTreeItem();
            treeItem.contextValue = options.contextValue;
            return treeItem;
        };
    }
    
    return element;
}

/**
 * Checks if a tree element has a retry node (error node) as a child.
 * Retry nodes are identified by having an ID that ends with '/reconnect'.
 *
 * @param children Array of tree elements to check
 * @returns True if any child has an ID ending with '/reconnect'
 */
export function hasRetryNode(children: TreeElement[] | null | undefined): boolean {
    return !!(children && children.length > 0 && children.some((child) => child.id?.endsWith('/reconnect')));
}