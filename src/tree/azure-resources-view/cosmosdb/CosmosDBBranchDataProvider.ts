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

    private readonly childrenCache = new Map<string, TreeElement>();
    private readonly resourcesCache = new Map<string, TreeElement>();

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

                    const children = (await element.getChildren?.()) ?? [];
                    const wrappedChildren = children.map((child) => {
                        if (!this.isAncestorOf(element, child.id)) {
                            //TODO: improve error handling, right now we throw and the whole tree is not being built
                            // we should use createGenericElement with error for each failed child
                            throw new Error(
                                l10n.t(
                                    'Child element "{0}" is not a child of parent element "{1}".',
                                    child.id,
                                    element.id,
                                ),
                            );
                        }
                        if (this.childrenCache.has(child.id)) {
                            return this.childrenCache.get(child.id)!;
                        }
                        const wrapped = ext.state.wrapItemInStateHandling(child, (child: TreeElement) =>
                            this.refresh(child),
                        ) as TreeElement;
                        this.childrenCache.set(child.id, wrapped);
                        return wrapped;
                    });

                    return wrappedChildren;
                },
            );

            return result ?? [];
        } catch (error) {
            return [
                createGenericElement({
                    contextValue: 'cosmosDB.item.error',
                    label: l10n.t('Error: {0}', parseError(error).message),
                }) as TreeElement,
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

                const cachedResourceItem = this.resourcesCache.get(id);
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
                    this.resourcesCache.set(id, resourceItem);
                    return ext.state.wrapItemInStateHandling(resourceItem, (item: TreeElement) =>
                        this.refresh(item),
                    ) as TreeElement;
                } else {
                    // Unknown resource type
                }

                return null as unknown as TreeElement;
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
        if (element.getParent && typeof element.getParent === 'function') {
            // some tree elements keep track of their parents (documentdb clusters).
            // we rely on this to get the parent element.
            return element.getParent();
        }

        // use local caches otherwise

        const parentId = element.id.substring(0, element.id.lastIndexOf('/'));
        if (parentId) {
            const parent = this.childrenCache.get(parentId);
            if (parent) {
                return parent;
            }
            const resourceItem = this.resourcesCache.get(parentId);
            if (resourceItem) {
                return resourceItem;
            }
        }
        return undefined;
    }

    async findNodeById(id: string): Promise<TreeElement | undefined> {
        const item = this.resourcesCache.get(id) ?? this.childrenCache.get(id);
        // If the resource item is found in the cache, return it
        if (item) {
            return item;
        }
        // If the resource item is not found in the cache, search through all children
        for (const [key, value] of this.childrenCache.entries()) {
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

    protected isAncestorOf(element: TreeElement, id: string): boolean {
        const elementId = element.id + '/';
        return id.toLowerCase().startsWith(elementId.toLowerCase());
    }

    refresh(element?: TreeElement): void {
        if (element) {
            // Get the cache key for this element
            const cacheKey = element.id;

            // Clear this element's children from cache
            this.childrenCache.delete(cacheKey);

            // Also clear any potential child caches using prefix
            const elementId = element.id;
            for (const key of this.childrenCache.keys()) {
                if (key.startsWith(`${elementId}/`)) {
                    this.childrenCache.delete(key);
                }
            }
        } else {
            // If no element specified, clear the entire cache
            this.childrenCache.clear();
        }

        // Notify the tree view to refresh
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
