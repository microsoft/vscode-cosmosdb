/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type TreeElement } from '../../TreeElement';

export type SortDirection = 'asc' | 'desc';

export type TreeItemStringProps = 'id' | 'label' | 'description' | 'contextValue';

export interface Sortable {
    /**
     * An array of property names that can be used for sorting.
     */
    sortProperties: TreeItemStringProps[];
    /**
     * The selected property name to sort by, e.g., 'name', 'id', etc.
     */
    sortProperty?: TreeItemStringProps;
    /**
     * The direction of sorting, either 'asc' for ascending or 'desc' for descending.
     */
    sortDirection: SortDirection;
    /**
     * Sorts an array of items based on the specified property name.
     * @param items The array of items to sort.
     * @param propertyName The property name to sort by.
     * @returns A new array sorted by the specified property.
     */
    sortItems: <U extends TreeElement>(items: U[], propertyName: string, sortDirection: SortDirection) => Promise<U[]>;
    /**
     * Handles the sort command, allowing the user to select a property and direction for sorting.
     * This method should be called when the user triggers a sort action.
     */
    handleSortCommand: () => Promise<void>;
}

/**
 * Guards to check if an instance is sortable.
 * @param instance
 */
export const isSortable = (instance: unknown): instance is Sortable => {
    return !!(
        instance &&
        typeof instance === 'object' &&
        'sortItems' in instance &&
        typeof instance.sortItems === 'function' &&
        'handleSortCommand' in instance &&
        typeof instance.handleSortCommand === 'function' &&
        'sortProperties' in instance &&
        Array.isArray(instance.sortProperties) &&
        instance.sortProperties.every((prop) => typeof prop === 'string') &&
        'sortProperty' in instance &&
        (typeof instance.sortProperty === 'string' || instance.sortProperty === undefined) &&
        'sortDirection' in instance &&
        (instance.sortDirection === 'asc' || instance.sortDirection === 'desc' || instance.sortDirection === undefined)
    );
};

/**
 * Makes an existing tree element instance sortable by adding sorting capabilities
 * @param instance The tree element instance to enhance
 * @param properties An array of property names that can be used for sorting (default: ['id'])
 * @returns The enhanced instance with sorting capabilities
 */
export function makeSortable<T extends TreeElement>(
    instance: T,
    properties: TreeItemStringProps[] = ['id'],
): T & Sortable {
    const enhanced = instance as T & Sortable;

    // Add sorting properties and methods
    enhanced.sortProperties = properties;
    enhanced.sortProperty = undefined;
    enhanced.sortDirection = 'asc'; // Default sort direction

    enhanced.sortItems = async function <U extends TreeElement>(
        items: U[],
        propertyName: TreeItemStringProps,
        sortDirection: SortDirection,
    ): Promise<U[]> {
        function getPropertyValue(item: vscode.TreeItem, prop: TreeItemStringProps): string | undefined {
            if (prop === 'id') {
                return item.id;
            } else if (prop === 'label') {
                return typeof item.label === 'string' ? item.label : String(item.label?.label);
            } else if (prop === 'description') {
                return typeof item.description === 'string' ? item.description : undefined;
            } else if (prop === 'contextValue') {
                return item.contextValue;
            }
            return undefined; // If the property is not recognized
        }

        async function getPropertyValues(items: U[]): Promise<Array<string | undefined>> {
            if (propertyName === 'id') {
                return items.map((item) => item.id);
            }

            // For other properties we have to call getTreeItem to ensure we have the correct value
            const promises = items.map((item) => item.getTreeItem());
            return Promise.allSettled(promises).then((results) => {
                return results.map((result) =>
                    result.status === 'fulfilled' && result.value
                        ? getPropertyValue(result.value, propertyName)
                        : undefined,
                );
            });
        }

        const propertyValues = await getPropertyValues(items);

        // Sort properties, undefined values will be sorted to the end, then sort the items based on the property values
        return items
            .map((item, index) => ({ item, value: propertyValues[index] }))
            .sort((a, b) => {
                // Handle undefined values by placing them at the end
                if (a.value === undefined || b.value === undefined) {
                    if (a.value === undefined && b.value === undefined) {
                        return 0; // Both are undefined, keep order
                    }
                    if (a.value === undefined) {
                        return 1; // `a` is undefined, b comes first
                    }
                    return -1; // `b` is undefined, a comes first
                }
                // Compare the values as strings
                const compareResult = String(a.value).localeCompare(String(b.value));
                return sortDirection === 'desc' ? -compareResult : compareResult;
            })
            .map(({ item }) => item); // Return the sorted items
    };

    // Store the original getTreeItem method to call it from our enhanced version
    const originalGetTreeItem = enhanced.getTreeItem.bind(enhanced) as () => Promise<vscode.TreeItem>;
    enhanced.getTreeItem = async function (): Promise<vscode.TreeItem> {
        const treeItem = await originalGetTreeItem();

        if (this.sortProperty) {
            // Update tooltip to show sorting info
            const sortInfo = `${l10n.t('Sorted by:')} ${this.sortProperty} (${this.sortDirection === 'desc' ? '↓' : '↑'})`;
            // Tooltip might be markdown
            treeItem.tooltip = treeItem.tooltip
                ? typeof treeItem.tooltip === 'string'
                    ? `${treeItem.tooltip}\n${sortInfo}`
                    : treeItem.tooltip.appendText(sortInfo)
                : sortInfo;
        }

        // Add to context value to indicate that this item is sortable
        // If contextValue is already set, append the filterable context with a semicolon
        if (treeItem.contextValue) {
            treeItem.contextValue += `;treeItem.sortable`;
        } else {
            treeItem.contextValue = 'treeItem.sortable';
        }

        return treeItem;
    };

    // Store the original getChildren method to call it from our enhanced version
    if (enhanced.getChildren === undefined) {
        // If getChildren is not defined, we cannot enhance it
    } else {
        const originalGetChildren = enhanced.getChildren.bind(enhanced) as () => Promise<TreeElement[]>;
        enhanced.getChildren = async function (): Promise<TreeElement[]> {
            const children = await originalGetChildren();

            // If sorting is applied, sort the children
            if (this.sortProperty && this.sortDirection) {
                return this.sortItems(children, this.sortProperty, this.sortDirection);
            }

            return children;
        };
    }

    enhanced.handleSortCommand = async function (): Promise<void> {
        if (!this.sortProperties || this.sortProperties.length === 0) {
            vscode.window.showErrorMessage(l10n.t('No properties available for sorting.'));
            return;
        }

        let property = this.sortProperty;
        let direction = this.sortDirection ? (this.sortDirection === 'asc' ? 'Ascending' : 'Descending') : undefined;

        // If only one property is available, we can skip the selection step
        if (this.sortProperties.length === 1) {
            property = this.sortProperties[0];
        } else {
            // Push the current sort property to the front of the list if it exists
            const properties = this.sortProperties.sort((a, b) => {
                if (a === property) return -1; // Move current property to the front
                if (b === property) return 1; // Keep other properties in order
                return a.localeCompare(b); // Sort alphabetically
            });

            property = (await vscode.window.showQuickPick(properties, {
                placeHolder: l10n.t('Select property to sort by'),
            })) as TreeItemStringProps | undefined;

            if (!property) {
                return; // User cancelled
            }
        }

        // If only one property is available, toggle the direction
        if (this.sortProperties.length === 1) {
            direction = direction === 'Ascending' ? 'Descending' : 'Ascending';
        } else {
            const directions = ['Ascending', 'Descending'];
            direction = await vscode.window.showQuickPick(directions, {
                placeHolder: l10n.t('Select sort direction'),
            });

            if (!direction) {
                return; // User cancelled
            }
        }

        this.sortProperty = property;
        this.sortDirection = direction === 'Ascending' ? 'asc' : 'desc';

        vscode.window.showInformationMessage(`Sorting by ${property} (${direction})`);
    };

    return enhanced;
}
