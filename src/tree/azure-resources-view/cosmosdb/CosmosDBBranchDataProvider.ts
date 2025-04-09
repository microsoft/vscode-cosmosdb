/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createGenericElement,
    parseError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type BranchDataProvider } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, CoreExperience, MongoExperience, tryGetExperience } from '../../../AzureDBExperiences';
import { databaseAccountType } from '../../../constants';
import { ext } from '../../../extensionVariables';
import { nonNullProp } from '../../../utils/nonNull';
import { type CosmosDBAccountModel } from '../../cosmosdb/models/CosmosDBAccountModel';
import { type ClusterModel } from '../../documentdb/ClusterModel';
import { GraphAccountResourceItem } from '../../graph/GraphAccountResourceItem';
import { NoSqlAccountResourceItem } from '../../nosql/NoSqlAccountResourceItem';
import { TableAccountResourceItem } from '../../table/TableAccountResourceItem';
import { type TreeElement } from '../../TreeElement';
import { isTreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../TreeElementWithExperience';
import { MongoRUResourceItem } from '../documentdb/mongo-ru/MongoRUResourceItem';

export class CosmosDBBranchDataProvider
    extends vscode.Disposable
    implements BranchDataProvider<CosmosDBAccountModel, TreeElement>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeElement | undefined>();

    private readonly nodeCache = new Map<string, TreeElement>();
    private readonly childToParentMap = new Map<string, string>();

    constructor() {
        super(() => this.onDidChangeTreeDataEmitter.dispose());
    }

    get onDidChangeTreeData(): vscode.Event<TreeElement | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    /**
     * This function is called for every element in the tree when expanding, the element being expanded is being passed as an argument
     */
    async getChildren(element: TreeElement): Promise<TreeElement[]> {
        try {
            const result = await callWithTelemetryAndErrorHandling(
                'CosmosDBBranchDataProvider.getChildren',
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

                    // TODO: values to mask. New TreeElements do not have valueToMask field
                    // I assume this array should be filled after element.getChildren() call
                    // And these values should be masked in the context

                    // TODO: return cached children instead of always calling getChildren? or we should invalidate the cache here.
                    const children = (await element.getChildren?.()) ?? [];
                    return children.map((child) => {
                        // If the child doesn't have an ID or is not part of the tree, return it as is
                        // This is for temporary elements created by TreeElementStateManager like "Createing XYZ"
                        if (!this.isAncestorOf(element, child.id)) {
                            return ext.state.wrapItemInStateHandling(child, (item: TreeElement) =>
                                this.refresh(item),
                            ) as TreeElement;
                        }

                        // Check cache first
                        const cached = this.nodeCache.get(child.id);
                        if (cached) {
                            context.telemetry.properties.cached = 'true';
                            return cached;
                        }

                        try {
                            // If not in cache, wrap and store
                            const wrapped = ext.state.wrapItemInStateHandling(child, (item: TreeElement) =>
                                this.refresh(item),
                            ) as TreeElement;

                            this.nodeCache.set(child.id, wrapped);
                            if (element.id) {
                                this.childToParentMap.set(child.id, element.id);
                            }

                            return wrapped;
                        } catch (wrapError) {
                            context.telemetry.properties.wrapError = parseError(wrapError).message;
                            return child; // Return unwrapped if wrapping fails
                        }
                    });
                },
            );

            return result ?? [];
        } catch (error) {
            return [
                this.createErrorElement(
                    l10n.t('Error: {0}', parseError(error).message),
                    `${element.id}/error-${Date.now()}`,
                ),
            ];
        }
    }

    /**
     * This function is being called when the resource tree is being built, it is called for every top level of resources.
     * @param resource
     */
    async getResourceItem(resource: CosmosDBAccountModel): Promise<TreeElement> {
        const resourceItem = await callWithTelemetryAndErrorHandling(
            'CosmosDBBranchDataProvider.getResourceItem',
            (context: IActionContext) => {
                const id = nonNullProp(resource, 'id');
                const name = nonNullProp(resource, 'name');
                const type = nonNullProp(resource, 'type');

                context.valuesToMask.push(id);
                context.valuesToMask.push(name);

                // Check unified cache first
                const cachedResourceItem = this.nodeCache.get(id);
                if (cachedResourceItem) {
                    context.telemetry.properties.cached = 'true';
                    return cachedResourceItem;
                }

                if (type.toLocaleLowerCase() === databaseAccountType.toLocaleLowerCase()) {
                    const accountModel = resource;
                    const experience = tryGetExperience(resource);

                    let resourceItem: TreeElement | null = null;

                    if (experience?.api === API.MongoDB) {
                        // 1. extract the basic info from the element (subscription, resource group, etc., provided by Azure Resources)
                        const clusterInfo: ClusterModel = {
                            ...resource,
                            dbExperience: MongoExperience,
                        } as ClusterModel;

                        resourceItem = new MongoRUResourceItem(resource.subscription, clusterInfo);
                    }

                    if (experience?.api === API.Cassandra) {
                        resourceItem = new NoSqlAccountResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Core) {
                        resourceItem = new NoSqlAccountResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Graph) {
                        resourceItem = new GraphAccountResourceItem(accountModel, experience);
                    }

                    if (experience?.api === API.Table) {
                        resourceItem = new TableAccountResourceItem(accountModel, experience);
                    }

                    if (!resourceItem) {
                        // Unknown experience fallback
                        resourceItem = new NoSqlAccountResourceItem(accountModel, CoreExperience);
                    }

                    if (resourceItem) {
                        const wrapped = ext.state.wrapItemInStateHandling(resourceItem, (item: TreeElement) =>
                            this.refresh(item),
                        ) as TreeElement;
                        this.nodeCache.set(id, wrapped);
                        return wrapped;
                    }
                }

                return this.createErrorElement(l10n.t('Unknown resource type'), `${resource.id}/error-${Date.now()}`);
            },
        );

        if (resourceItem) {
            return resourceItem;
        }

        return null as unknown as TreeElement;
    }

    async getTreeItem(element: TreeElement): Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }

    getParent(element: TreeElement): TreeElement | null | undefined {
        // First check if we have the parent-child relationship cached
        if (element?.id && this.childToParentMap.has(element.id)) {
            const parentId = this.childToParentMap.get(element.id);
            if (parentId) {
                return this.nodeCache.get(parentId);
            }
        }

        // Fall back if relationship not cached
        if (element.getParent && typeof element.getParent === 'function') {
            // some tree elements keep track of their parents (documentdb clusters).
            // we rely on this to get the parent element.
            return element.getParent();
        }

        const parentId = element.id.substring(0, element.id.lastIndexOf('/'));
        if (parentId) {
            return this.nodeCache.get(parentId);
        }

        return undefined;
    }

    async findNodeById(id: string): Promise<TreeElement | undefined> {
        const item = this.nodeCache.get(id);
        if (item) {
            return item;
        }
        // If the resource item is not found in the cache, search through all children
        for (const [key, value] of this.nodeCache.entries()) {
            if (key.startsWith(id)) {
                const child = await this.findChildById(value, id);
                if (child) {
                    return child;
                }
            }
        }
        // If the element is not found in the cache, return undefined
        return undefined;
    }

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

    protected isAncestorOf(element: TreeElement, id: string | undefined): boolean {
        if (element.id === undefined || id === undefined) {
            return false;
        }
        const elementId = element.id + '/';
        return id.toLowerCase().startsWith(elementId.toLowerCase());
    }

    refresh(element?: TreeElement): void {
        if (element?.id) {
            this.pruneElementCache(element.id);
        } else {
            this.nodeCache.clear();
            this.childToParentMap.clear();
        }

        // Notify the tree view to refresh
        this.onDidChangeTreeDataEmitter.fire(element);
    }

    private pruneElementCache(elementId: string): void {
        // Remove the element itself
        this.nodeCache.delete(elementId);

        // Remove all descendants
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
        // Clean up parent reference
        this.childToParentMap.delete(elementId);
    }

    private createErrorElement(message: string, id: string): TreeElement {
        return createGenericElement({
            contextValue: 'cosmosDB.item.error',
            label: message,
            id: id,
        }) as TreeElement;
    }
}
