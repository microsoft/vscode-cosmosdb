/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createContextValue,
    createGenericElement,
    type IActionContext,
    parseError,
} from '@microsoft/vscode-azext-utils';
import {
    type AzureResource,
    type BranchDataProvider,
    type WorkspaceResource,
} from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API } from '../AzureDBExperiences';
import { ext } from '../extensionVariables';
import { hasRetryNode } from '../utils/treeUtils';
import { type TreeElement } from './TreeElement';
import { isTreeElementWithContextValue } from './TreeElementWithContextValue';
import { isTreeElementWithExperience } from './TreeElementWithExperience';

/**
 * Abstract base class that implements a cached tree data provider for Visual Studio Code extensions.
 *
 * This class provides a robust caching layer for tree-based data structures, optimizing performance
 * by storing and reusing tree elements. It implements the BranchDataProvider interface and extends
 * vscode.Disposable to properly handle resource cleanup.
 *
 * @template T - The resource type, which must extend either AzureResource or WorkspaceResource
 *
 * Key features:
 * - Maintains a node cache to avoid redundant element creation
 * - Tracks parent-child relationships for efficient traversal
 * - Integrates with telemetry and error handling systems
 * - Supports tree node refresh operations
 * - Provides tree traversal capabilities with findNodeById and findChildById
 *
 * Implementation notes:
 * - Subclasses must implement abstract methods to customize provider behavior
 * - Each tree element is wrapped with state handling capabilities before being returned
 * - Error states are represented as special tree elements
 * - The cache is automatically pruned during refresh operations
 *
 * @abstract
 * @extends vscode.Disposable
 * @implements {BranchDataProvider<T, TreeElement>}
 */
export abstract class BaseCachedBranchDataProvider<T extends AzureResource | WorkspaceResource>
    extends vscode.Disposable
    implements BranchDataProvider<T, TreeElement>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeElement | undefined>();
    private readonly nodeCache = new Map<string, TreeElement>();
    private readonly childToParentMap = new Map<string, string>();

    /**
     * Caches nodes whose getChildren() call has failed.
     *
     * This cache prevents repeated attempts to fetch children for nodes that have previously failed,
     * such as when a user enters invalid credentials. By storing the failed nodes, we avoid unnecessary
     * repeated calls until the error state is explicitly cleared.
     *
     * Key: Node ID (parent)
     * Value: Array of TreeElement representing the failed children (usually an error node)
     */
    private readonly errorNodeCache = new Map<string, TreeElement[]>();

    /**
     * Gets the name of the provider, used primarily in telemetry and logging.
     * By default, returns the name of the implementing subclass.
     * Subclasses can override this if they need a different naming scheme.
     *
     * @returns A string identifier for this provider (the class name by default)
     */
    protected get providerName(): string {
        return this.constructor.name;
    }

    /**
     * Gets the prefix used for context values in tree items created by this provider.
     * This helps identify which view/provider an item belongs to when constructing
     * context value strings for commands, menu visibility, and error elements.
     *
     * @returns A string prefix for context values (e.g., 'cosmosDB', 'cosmosDB.workspace')
     * @example
     * protected get contexValuePrefix(): string {
     *     return 'cosmosDB.workspace';
     * }
     */
    protected abstract get contextValue(): string;

    /**
     * Creates a resource tree item for the given resource.
     * This method is called by getResourceItem when no cached item exists.
     *
     * @param context - The action context for telemetry and error handling
     * @param resource - The resource to create a tree item for (may be undefined)
     * @returns A new tree element representing the resource, or undefined if
     * the resource couldn't be represented (which will cause an error element to be shown)
     *
     * @remarks
     * Implementations should:
     * - Create the appropriate tree element type based on the resource
     * - Return undefined for unsupported resource types
     * - Handle the case where resource is undefined (for workspace providers)
     * - Add relevant information to context.valuesToMask for sensitive data
     */
    protected abstract createResourceItem(context: IActionContext, resource?: T): TreeElement | undefined;

    constructor() {
        super(() => this.onDidChangeTreeDataEmitter.dispose());
    }

    get onDidChangeTreeData(): vscode.Event<TreeElement | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    async getChildren(element: TreeElement): Promise<TreeElement[]> {
        try {
            return (
                (await callWithTelemetryAndErrorHandling(
                    `${this.providerName}.getChildren`,
                    async (context: IActionContext) => {
                        context.errorHandling.suppressDisplay = true;
                        context.errorHandling.rethrow = true;
                        context.errorHandling.forceIncludeInReportIssueCommand = true;

                        // 1. Check if we have a cached error for this element
                        //
                        // This prevents repeated attempts to fetch children for nodes that have previously failed
                        // (e.g., due to invalid credentials or connection issues).
                        if (element.id && this.errorNodeCache.has(element.id)) {
                            context.telemetry.properties.usedCachedErrorNode = 'true';
                            return this.errorNodeCache.get(element.id) ?? [];
                        }

                        if (isTreeElementWithContextValue(element)) {
                            context.telemetry.properties.parentContext = element.contextValue;
                        }
                        if (isTreeElementWithExperience(element)) {
                            context.telemetry.properties.experience = element.experience?.api ?? API.Common;
                        }
                        context.telemetry.properties.parentNodeContext =
                            (await element.getTreeItem()).contextValue ?? 'unknown';

                        context.telemetry.properties.view = this.contextValue;

                        // TODO: values to mask. New TreeElements do not have valueToMask field
                        // I assume this array should be filled after element.getChildren() call
                        // And these values should be masked in the context

                        // TODO: we should return cached children instead of always calling getChildrenFromElement
                        // however this can only work if we can also cache the root resource elements, which is
                        // currently not possible because Refresh is not being called for them.
                        /*
                        // Cache lookup
                        const cached = this.getDirectChildNodesFromCache(element);
                        if (cached) {
                            context.telemetry.properties.cached = 'true';
                            return cached;
                        }
                        */
                        // Invalidate cache instead, to ensure getParent lookups work
                        this.pruneCache(element.id, false);
                        const children = await this.getChildrenFromElement(element);

                        // 2. Check if the returned children contain an error/retry node
                        // This means the operation failed (e.g. authentication)
                        if (hasRetryNode(children)) {
                            // Store the error node(s) in our cache for future refreshes
                            if (element.id) {
                                this.errorNodeCache.set(element.id, children);
                                context.telemetry.properties.cachedErrorNode = 'true';
                            }
                        }

                        return children.map((child) => this.processChild(child, element));
                    },
                )) ?? []
            );
        } catch (error) {
            const errorNodes = [
                this.createErrorElement(
                    l10n.t('Error: {0}', parseError(error).message),
                    `${element.id}/error-${Date.now()}`,
                ),
            ];
            
            // Cache the error nodes to prevent repeated attempts
            if (element.id) {
                this.errorNodeCache.set(element.id, errorNodes);
            }
            
            return errorNodes;
        }
    }

    async getResourceItem(resource?: T): Promise<TreeElement> {
        return (
            (await callWithTelemetryAndErrorHandling(
                `${this.providerName}.getResourceItem`,
                (context: IActionContext) => {
                    try {
                        if (resource) {
                            // TODO: refresh won't be called for root level resource elements,
                            // hence we don't know if we should refresh them. For now we'll use caching for lookups only
                            // and always invalidate the cache for root level elements when they are requested.
                            // This also applies to the getChildren method, since we don't know if children need to be refreshed.
                            /*
                            const cachedItem = this.nodeCache.get(resource.id);
                            if (cachedItem) {
                                context.telemetry.properties.cached = 'true';
                                this.onResourceItemRetrieved(cachedItem, resource, context, true);
                                return cachedItem;
                            }
                            */
                            this.pruneCache(resource.id);
                        }

                        // Let derived class create the appropriate resource item
                        const resourceItem = this.createResourceItem(context, resource);

                        // Wrap, cache and return the resource item if present
                        if (resourceItem) {
                            const wrapped = this.wrapElement(resourceItem);
                            if (resource?.id && wrapped) {
                                this.nodeCache.set(resource.id, wrapped);
                            }
                            this.onResourceItemRetrieved(wrapped, resource, context, false);
                            return wrapped;
                        }

                        if (resource) {
                            return this.createErrorElement(
                                l10n.t('Unsupported resource: {0}', resource.name),
                                `error-${Date.now()}`,
                            );
                        }
                        return undefined as unknown as TreeElement;
                    } catch (error) {
                        return this.createErrorElement(
                            l10n.t('Error creating resource: {0}', parseError(error).message),
                            `error-${Date.now()}`,
                        );
                    }
                },
            )) ?? (null as unknown as TreeElement)
        );
    }

    async getTreeItem(element: TreeElement): Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }

    // Common getParent implementation
    getParent(element: TreeElement): TreeElement | null | undefined {
        // Cache lookup
        if (element?.id && this.childToParentMap.has(element.id)) {
            const parentId = this.childToParentMap.get(element.id);
            if (parentId) {
                return this.nodeCache.get(parentId);
            }
        }

        // ID-based parent lookup
        const parentId = element.id?.substring(0, element.id.lastIndexOf('/'));
        if (parentId) {
            return this.nodeCache.get(parentId);
        }

        return undefined;
    }

    /**
     * Removes a node's error state from the failed node cache.
     * This allows the node to be refreshed and its children to be re-fetched on the next refresh call.
     * If not reset, the cached error children will always be returned for this node.
     * @param nodeId The ID of the node to clear from the failed node cache.
     */
    resetNodeErrorState(nodeId: string): void {
        this.errorNodeCache.delete(nodeId);
    }

    /**
     * Refreshes the tree data.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     *
     * @param element The element to refresh. If not provided, the entire tree will be refreshed.
     *
     * Note: This implementation handles both current and stale element references.
     * If a stale reference is provided but has an ID, it will attempt to find the current
     * reference in the tree before refreshing.
     */
    refresh(element?: TreeElement): void {
        if (element?.id) {
            // We have an element with an ID

            // Handle potential stale reference issue:
            // VS Code's TreeView API relies on object identity (reference equality),
            // not just ID equality. Find the current reference before clearing the cache.
            void this.findAndRefreshCurrentElement(element);
        } else {
            // No element or no ID, refresh the entire tree
            this.nodeCache.clear();
            this.childToParentMap.clear();
            this.errorNodeCache.clear();
            this.onDidChangeTreeDataEmitter.fire(element);
        }
    }

    /**
     * Helper method to find the current instance of an element by ID and refresh it.
     * This addresses the issue where stale references won't properly refresh the tree.
     *
     * @param element Potentially stale element reference
     */
    private async findAndRefreshCurrentElement(element: TreeElement): Promise<void> {
        try {
            // First try to find the current instance with this ID
            const currentElement = await this.findNodeById(element.id!);

            // AFTER finding the element, update the cache:
            // 1. Clear the cache for this ID to remove any stale references
            // (drops the element and its children)
            this.pruneCache(element.id!);

            // 2. Re-register the node (but not its children)
            if (currentElement?.id) {
                this.nodeCache.set(currentElement.id, currentElement);
            }

            if (currentElement) {
                // We found the current instance, use it for refresh
                this.onDidChangeTreeDataEmitter.fire(currentElement);
            } else {
                // Current instance not found, fallback to using the provided element
                // This may not work if it's truly a stale reference, but we've tried our best
                this.onDidChangeTreeDataEmitter.fire(element);
            }
        } catch (error) {
            // If anything goes wrong during the lookup, still attempt the refresh with the original element
            // and clear the cache for this ID
            console.log(`Error finding current element for refresh: ${error}`);
            this.pruneCache(element.id!);
            this.onDidChangeTreeDataEmitter.fire(element);
        }
    }

    /**
     * Retrieves child elements from a given tree element.
     * @param element - The tree element to get children from.
     * @returns A promise that resolves to an array of child tree elements. Returns an empty array if the element doesn't have a getChildren method or if it returns null/undefined.
     */
    protected async getChildrenFromElement(element: TreeElement): Promise<TreeElement[]> {
        // Get children from element's getChildren method if it exists
        return (await element.getChildren?.()) ?? [];
    }

    private pruneCache(elementId: string, includeElement: boolean = true): void {
        if (includeElement) {
            this.nodeCache.delete(elementId);
            this.childToParentMap.delete(elementId);
            this.errorNodeCache.delete(elementId);
        }

        const prefix = `${elementId}/`;
        const keysToDelete: string[] = [];

        this.nodeCache.forEach((_, key) => {
            if (key.startsWith(prefix)) {
                keysToDelete.push(key);
            }
        });

        // Also clean up error cache entries for child nodes
        const errorKeysToDelete: string[] = [];
        this.errorNodeCache.forEach((_, key) => {
            if (key.startsWith(prefix)) {
                errorKeysToDelete.push(key);
            }
        });

        keysToDelete.forEach((key) => {
            this.nodeCache.delete(key);
            this.childToParentMap.delete(key);
        });

        errorKeysToDelete.forEach((key) => {
            this.errorNodeCache.delete(key);
        });
    }

    private isAncestorOf(element: TreeElement, id: string | undefined): boolean {
        if (element.id === undefined || id === undefined) {
            return false;
        }
        const elementId = element.id + '/';
        return id.toLowerCase().startsWith(elementId.toLowerCase());
    }

    private processChild(child: TreeElement, parent: TreeElement): TreeElement {
        // If the child doesn't have an ID or is not part of the tree, return it as is
        // for temporary elements created by TreeElementStateManager like "Createing XYZ"
        if (!this.isAncestorOf(parent, child.id)) {
            return this.wrapElement(child);
        }

        // Cache and wrap new element
        const wrapped = this.wrapElement(child);
        if (child.id) {
            this.nodeCache.set(child.id, wrapped);
            if (parent.id) {
                this.childToParentMap.set(child.id, parent.id);
            }
        }
        return wrapped;
    }

    private wrapElement(element: TreeElement): TreeElement {
        try {
            return ext.state.wrapItemInStateHandling(element, (item: TreeElement) => this.refresh(item)) as TreeElement;
        } catch {
            //TODO: log the error to telemetry
            //context.telemetry.properties.wrapError = parseError(error).message;
            return element; // Return unwrapped if error
        }
    }

    private createErrorElement(message: string, id: string): TreeElement {
        return createGenericElement({
            contextValue: createContextValue([this.contextValue, 'item.error']),
            label: message,
            id: id,
        }) as TreeElement;
    }

    /**
     * Finds and returns a tree node by its ID.
     * @param id - The ID of the node to find
     * @returns A Promise that resolves to the found TreeElement or undefined if not found
     *
     * Search strategy:
     * 1. First checks the node cache for an exact match by ID
     * 2. If not found, looks for cache entries with keys that start with the given ID
     * 3. For each matching entry, attempts to recursively find a child with the target ID
     */
    async findNodeById(id: string): Promise<TreeElement | undefined> {
        const item = this.nodeCache.get(id);
        if (item) return item;

        for (const [key, value] of this.nodeCache.entries()) {
            if (key.startsWith(id)) {
                const child = await this.findChildById(value, id);
                if (child) return child;
            }
        }
        return undefined;
    }

    /**
     * Recursively searches for a child element with the specified ID within the tree structure.
     * The search starts from the given element and traverses down the tree hierarchy.
     *
     * @param element - The tree element from which to start the search
     * @param id - The ID of the child element to find
     * @returns A Promise that resolves to the found TreeElement or undefined if not found
     *
     * The method performs a breadth-first search by:
     * 1. Checking if the requested ID is potentially in this branch (starts with element's ID)
     * 2. For each level of children:
     *    - Returns the child if its ID matches the requested ID (case-insensitive)
     *    - Continues searching from a child if it's determined to be an ancestor of the target
     *    - Returns undefined if no matching child or potential ancestor is found
     */
    async findChildById(element: TreeElement, id: string): Promise<TreeElement | undefined> {
        if (!id.startsWith(element.id)) {
            return undefined;
        }
        let node = element;
        outerLoop: while (true) {
            const children: TreeElement[] | null | undefined = await this.getChildren(node);

            if (!children) {
                return;
            }

            for (const child of children) {
                if (child.id.toLowerCase() === id.toLowerCase()) {
                    return child;
                } else if (this.isAncestorOf(child, id)) {
                    node = child;
                    continue outerLoop;
                }
            }

            return undefined;
        }
    }

    /**
     * Called when a resource item is about to be returned by getResourceItem.
     * This method is invoked for both cached and newly created items.
     * Default implementation is a no-op, but subclasses can override to perform side effects.
     * Note: This method cannot modify which item is returned - the original item will always be used.
     *
     * @param item The resource item that will be returned (read-only)
     * @param resource The resource for which the item was requested
     * @param context The action context
     * @param fromCache Whether the item was retrieved from cache (true) or newly created (false)
     */
    protected onResourceItemRetrieved(
        _item: TreeElement,
        _resource?: T,
        _context?: IActionContext,
        _fromCache?: boolean,
    ): void {
        // Default implementation is a no-op
    }

    /**
     * Gets direct child nodes from the nodeCache.
     * @param element - The parent element
     * @returns An array of direct child elements from the cache
     */
    /*
    private getDirectChildNodesFromCache(element: TreeElement): TreeElement[] | undefined {
        if (!element.id) {
            return undefined;
        }

        const prefix = `${element.id}/`;
        const children: TreeElement[] = [];

        this.nodeCache.forEach((node, key) => {
            if (key.startsWith(prefix)) {
                // Check if this is a direct child (no additional slashes after prefix)
                const remaining = key.substring(prefix.length);
                if (!remaining.includes('/')) {
                    children.push(node);
                }
            }
        });

        return children.length > 0 ? children : undefined;
    }
    */
}
