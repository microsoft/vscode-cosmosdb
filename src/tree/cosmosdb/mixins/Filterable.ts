/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Minimatch } from 'minimatch';
import * as vscode from 'vscode';
import { type TreeElement } from '../../TreeElement';

export type TreeItemStringProps = 'id' | 'label' | 'description' | 'contextValue' | 'tooltip';

export interface Filterable {
    /**
     * An array of property names that can be used for filtering.
     * For example, ['name', 'id', 'type'].
     */
    filterProperties: TreeItemStringProps[];
    /**
     * The selected property name to filter by, e.g., 'name', 'id', etc.
     * This is optional and can be set to undefined if no specific property is selected.
     */
    filterProperty?: TreeItemStringProps;
    /**
     * An optional filter pattern to apply to the items.
     * This can be a glob pattern like "user*" or "*test*".
     */
    filterPattern?: string;
    /**
     * Filters an array of items based on the specified property name and the current filter pattern.
     * @param items The array of items to filter.
     * @param propertyName The property name to filter by.
     * @returns A new array containing only the items that match the filter pattern.
     */
    filterItems: <U extends TreeElement>(
        items: U[],
        propertyName: TreeItemStringProps,
        pattern: string,
    ) => Promise<U[]>;
    /**
     * Handles the filter command, allowing the user to input a filter pattern.
     * This method should be called when the user triggers a filter action.
     */
    handleFilterCommand: () => Promise<void>;
}

export const isFilterable = (instance: unknown): instance is Filterable => {
    return !!(
        instance &&
        typeof instance === 'object' &&
        'filterProperties' in instance &&
        Array.isArray(instance.filterProperties) &&
        instance.filterProperties.every((prop) => typeof prop === 'string') &&
        'filterProperty' in instance &&
        (typeof instance.filterProperty === 'string' || instance.filterProperty === undefined) &&
        'filterItems' in instance &&
        typeof instance.filterItems === 'function' &&
        'handleFilterCommand' in instance &&
        typeof instance.handleFilterCommand === 'function' &&
        'filterPattern' in instance &&
        (typeof instance.filterPattern === 'string' || instance.filterPattern === undefined)
    );
};

/**
 * Makes an existing tree element instance filterable by adding filtering capabilities
 * @param instance The tree element instance to enhance
 * @param properties An array of property names that can be used for filtering (default: ['id'])
 * @returns The enhanced instance with filtering capabilities
 */
export function makeFilterable<T extends TreeElement>(
    instance: T,
    properties: TreeItemStringProps[] = ['label'],
): T & Filterable {
    const enhanced = instance as T & Filterable;

    // Add filtering properties and methods
    enhanced.filterProperties = properties;
    enhanced.filterProperty = undefined; // Initially no property is selected
    enhanced.filterPattern = undefined; // Initially no filter pattern is set

    enhanced.filterItems = async function <U extends TreeElement>(
        items: U[],
        propertyName: TreeItemStringProps,
        pattern: string,
    ): Promise<U[]> {
        const mn = new Minimatch(pattern, { nocase: true, dot: true });
        const regex = mn.makeRe();

        if (!regex) {
            // If the pattern is invalid, return the original items
            void vscode.window.showErrorMessage(l10n.t('Invalid filter pattern: {pattern}', { pattern }));
            return items;
        }

        function getPropertyValue(item: vscode.TreeItem, prop: TreeItemStringProps): string | undefined {
            if (prop === 'id') {
                if (typeof item.id === 'string') {
                    const lastSlashIndex = item.id.lastIndexOf('/');
                    if (lastSlashIndex !== -1) {
                        return item.id.substring(0, lastSlashIndex);
                    }
                }
                // If id is not a string or does not contain a slash, return the full id
                return item.id;
            } else if (prop === 'label') {
                return typeof item.label === 'string' ? item.label : String(item.label?.label);
            } else if (prop === 'description') {
                return typeof item.description === 'string' ? item.description : undefined;
            } else if (prop === 'contextValue') {
                return item.contextValue;
            } else if (prop === 'tooltip') {
                return typeof item.tooltip === 'string' ? item.tooltip : item.tooltip?.value;
            }
            return undefined; // If the property is not recognized
        }

        async function getPropertyValues(items: U[]): Promise<Array<string | undefined>> {
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

        // Filter properties, undefined values will be skipped
        return items.filter((_item, index) => {
            const value = propertyValues[index];
            if (value === undefined) {
                return false; // Skip items with undefined property values
            }
            return regex.test(value); // Check if the value matches the filter pattern
        });
    };

    // Store the original getTreeItem method to call it from our enhanced version
    const originalGetTreeItem = enhanced.getTreeItem.bind(enhanced) as () => Promise<vscode.TreeItem>;
    enhanced.getTreeItem = async function (): Promise<vscode.TreeItem> {
        const treeItem = await originalGetTreeItem();

        if (this.filterPattern) {
            // Add * to label to indicate filtering is applied
            if (typeof treeItem.label === 'string') {
                treeItem.label = `${treeItem.label}*`;
            } else if (treeItem.label && typeof treeItem.label === 'object' && 'label' in treeItem.label) {
                treeItem.label.label = `${treeItem.label.label}*`;
            }

            const filterInfo = `${l10n.t('Filtered by:')} ${this.filterPattern}`;

            // Update tooltip to show filter
            treeItem.tooltip = treeItem.tooltip
                ? typeof treeItem.tooltip === 'string'
                    ? `${treeItem.tooltip}\n${filterInfo}`
                    : treeItem.tooltip.appendText(filterInfo)
                : filterInfo;
        }

        // Add context value to indicate that this item is filterable
        // If contextValue is already set, append the filterable context with a semicolon
        if (treeItem.contextValue) {
            treeItem.contextValue += ';treeItem.filterable';
        } else {
            treeItem.contextValue = 'treeItem.filterable';
        }

        return treeItem;
    };

    if (enhanced.getChildren === undefined) {
        // If getChildren is not defined, we cannot enhance it
    } else {
        // Store the original getChildren method to call it from our enhanced version
        const originalGetChildren = enhanced.getChildren.bind(enhanced) as () => Promise<TreeElement[]>;
        enhanced.getChildren = async function (): Promise<TreeElement[]> {
            const children = await originalGetChildren();

            // Apply filtering to the children
            if (this.filterProperty && this.filterPattern) {
                return this.filterItems(children, this.filterProperty, this.filterPattern);
            }

            return children;
        };
    }

    enhanced.handleFilterCommand = async function (): Promise<void> {
        if (!this.filterProperties || this.filterProperties.length === 0) {
            vscode.window.showErrorMessage(l10n.t('No properties available for filtering.'));
            return;
        }

        let property = this.filterProperty;

        // If only one property is available, we can skip the selection step
        if (this.filterProperties.length === 1) {
            property = this.filterProperties[0];
        } else {
            // Push the current filter property to the front of the list if it exists
            const properties = this.filterProperties.sort((a, b) => {
                if (a === property) return -1; // Move current property to the front
                if (b === property) return 1; // Keep other properties in order
                return a.localeCompare(b); // Sort alphabetically
            });

            property = (await vscode.window.showQuickPick(properties, {
                placeHolder: l10n.t('Select property to filter by'),
            })) as TreeItemStringProps | undefined;

            if (!property) {
                return; // User cancelled
            }
        }

        const pattern = await vscode.window.showInputBox({
            placeHolder: 'Filter pattern (e.g., "user*" or "*test*")',
            prompt: 'Enter glob pattern to filter items or leave empty to clear',
            value: this.filterPattern || '',
        });

        if (pattern === undefined) {
            return; // User cancelled
        }

        this.filterProperty = property;
        this.filterPattern = pattern;

        // Show feedback
        if (this.filterPattern) {
            vscode.window.showInformationMessage(`Filter applied: ${this.filterPattern}`);
        } else {
            vscode.window.showInformationMessage('Filter cleared');
        }
    };

    return enhanced;
}
