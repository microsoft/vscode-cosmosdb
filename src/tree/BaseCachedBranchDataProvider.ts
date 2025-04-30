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

                        return children.map((child) => this.processChild(child, element));
                    },
                )) ?? []
            );
        } catch (error) {
            return [
                this.createErrorElement(
                    l10n.t('Error: {0}', parseError(error).message),
                    `${element.id}/error-${Date.now()}`,
                ),
            ];
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

    refresh(element?: TreeElement): void {
        if (element?.id) {
            this.pruneCache(element.id);
        } else {
            this.nodeCache.clear();
            this.childToParentMap.clear();
        }

        this.onDidChangeTreeDataEmitter.fire(element);
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
        }

        const prefix = `${elementId}/`;
        const keysToDelete: string[] = [];

        this.nodeCache.forEach((_, key) => {
            if (key.startsWith(prefix)) {
                keysToDelete.push(key);
            }
        });

        keysToDelete.forEach((key) => {
            this.nodeCache.delete(key);
            this.childToParentMap.delete(key);
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
        // eslint-disable-next-line no-constant-condition
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
