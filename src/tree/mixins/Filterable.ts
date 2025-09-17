/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type TreeElement } from '../TreeElement';

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
    if (isFilterable(instance)) {
        return instance; // If already filterable, return the instance as is
    }

    const enhanced = instance as T & Filterable;

    // Add filtering properties and methods
    enhanced.filterProperties = [...properties]; // Copy the provided properties
    enhanced.filterProperty = undefined; // Initially no property is selected
    enhanced.filterPattern = undefined; // Initially no filter pattern is set

    enhanced.filterItems = async function <U extends TreeElement>(
        items: U[],
        propertyName: TreeItemStringProps,
        pattern: string,
    ): Promise<U[]> {
        pattern = pattern.trim();

        if (!pattern) {
            // If no pattern is provided, return the items as is
            return items;
        }

        const escapedPattern = escapeSpecialCharacters(pattern);
        const regex = new RegExp(`(${escapedPattern})`, 'gim');
        const propertyValues = await getPropertyValues(items, propertyName);

        // Move filtered items to the top of the list, others to the bottom
        return items
            .map((item, index) => {
                const value = propertyValues[index] || '';
                const normalizedValue = removeDiacritics(value);
                // Reset regex for each test
                regex.lastIndex = 0;
                return {
                    item,
                    value,
                    match: regex.test(normalizedValue),
                    originalIndex: index,
                };
            })
            .sort((a, b) => {
                // First sort by match status (matched items first)
                if (a.match && !b.match) return -1;
                if (!a.match && b.match) return 1;

                // Within each group (matched or non-matched), preserve original order
                return a.originalIndex - b.originalIndex;
            })
            .map(({ item, match }) => {
                // Substitute the item getTreeItem method to highlight the matched property
                if (item.getTreeItem && propertyName === 'label' && match) {
                    const originalGetTreeItem = item.getTreeItem.bind(item) as () => Promise<vscode.TreeItem>;
                    item.getTreeItem = async function (): Promise<vscode.TreeItem> {
                        const treeItem = await originalGetTreeItem();
                        const propertyValue = getPropertyValue(treeItem, propertyName);

                        // If the property value matches the filter pattern, highlight it
                        if (propertyValue) {
                            regex.lastIndex = -1; // Reset regex index for global match
                            const match = regex.exec(removeDiacritics(propertyValue));
                            if (!match) {
                                return treeItem; // No match found, return original item
                            }
                            // If a match is found, highlight it
                            treeItem.label = {
                                label:
                                    typeof treeItem.label === 'string' ? treeItem.label : (treeItem.label?.label ?? ''),
                                highlights: match[0] ? [[match.index, match.index + match[0].length]] : undefined,
                            };
                        }
                        return treeItem;
                    };
                }

                return item;
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
            placeHolder: l10n.t('Filter pattern (e.g., "user*" or "*test*")'),
            prompt: l10n.t('Enter filter pattern or leave empty to clear filtration'),
            value: this.filterPattern || '',
        });

        if (pattern === undefined) {
            return; // User cancelled
        }

        this.filterProperty = property;
        this.filterPattern = pattern;

        // Show feedback
        if (this.filterPattern) {
            vscode.window.showInformationMessage(
                l10n.t('Filter applied: {filterPattern}', { filterPattern: this.filterPattern }),
            );
        } else {
            vscode.window.showInformationMessage(l10n.t('Filter cleared'));
        }
    };

    return enhanced;
}

/**
 * Escapes special characters in a string for use in a regular expression.
 * This function replaces asterisks (*) with .* to allow for wildcard matching.
 * @param str The string to escape.
 * @returns The escaped string suitable for regex matching.
 */
function escapeSpecialCharacters(str: string): string {
    return str
        .replace(/\*/g, '§§ASTERISK§§') // Use a placeholder for asterisks
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special regex characters
        .replace(/§§ASTERISK§§/g, '.*'); // Replace placeholders with .*
}

/**
 * Removes diacritics from a string, converting accented characters to their base form.
 * For example, "é" becomes "e", "ñ" becomes "n", etc.
 * @param str The string from which to remove diacritics.
 * @returns The string without diacritics.
 */
function removeDiacritics(str: string): string {
    return str
        .normalize('NFD') // Decompose accented characters
        .replace(/[\u0300-\u036f]/g, ''); // Remove combining diacritical marks
}

/**
 * Retrieves the value of a specific property from a TreeItem.
 * If the property is 'id', it returns the part before the last slash.
 * If the property is 'label', it returns the label string or its label property.
 * If the property is 'description', it returns the description string.
 * If the property is 'contextValue', it returns the context value string.
 * If the property is 'tooltip', it returns the tooltip string or its value property.
 * @param item The TreeItem to retrieve the property from.
 * @param prop The property to retrieve.
 * @returns The value of the specified property, or undefined if not found.
 */
function getPropertyValue(item: vscode.TreeItem, prop: TreeItemStringProps): string | undefined {
    if (prop === 'id') {
        if (typeof item.id === 'string') {
            const lastSlashIndex = item.id.lastIndexOf('/');
            if (lastSlashIndex !== -1) {
                return item.id.substring(lastSlashIndex + 1);
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

async function getPropertyValues<U extends TreeElement>(
    items: U[],
    propertyName: TreeItemStringProps,
): Promise<Array<string | undefined>> {
    // For other properties we have to call getTreeItem to ensure we have the correct value
    const promises = items.map((item) => item.getTreeItem());
    return Promise.allSettled(promises).then((results) => {
        return results.map((result) =>
            result.status === 'fulfilled' && result.value ? getPropertyValue(result.value, propertyName) : undefined,
        );
    });
}
