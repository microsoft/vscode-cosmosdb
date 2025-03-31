/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createGenericElement,
    type IActionContext,
    parseError,
} from '@microsoft/vscode-azext-utils';
import { type BranchDataProvider } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API } from '../../../AzureDBExperiences';
import { ext } from '../../../extensionVariables';
import { type CosmosDBAccountModel } from '../../cosmosdb/models/CosmosDBAccountModel';
import { type TreeElement } from '../../TreeElement';
import { isTreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../TreeElementWithExperience';
import { CosmosDBWorkspaceItem } from './CosmosDBWorkspaceItem';

export class CosmosDBWorkspaceBranchDataProvider
    extends vscode.Disposable
    implements BranchDataProvider<CosmosDBAccountModel, TreeElement>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeElement | undefined>();

    private readonly childrenCache = new Map<string, TreeElement>();
    private resourcesCache = ext.state.wrapItemInStateHandling(new CosmosDBWorkspaceItem(), (item: TreeElement) =>
        this.refresh(item),
    ) as TreeElement;

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
                'CosmosDBWorkspaceBranchDataProvider.getChildren',
                async (context: IActionContext) => {
                    context.telemetry.properties.view = 'workspace';
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
                    return children.map((child) => {
                        if (!this.isAncestorOf(element, child.id)) {
                            child = createGenericElement({
                                contextValue: 'cosmosDB.workspace.item.error',
                                label: l10n.t(
                                    'Child element "{0}" is not a child of parent element "{1}".',
                                    child.id,
                                    element.id,
                                ),
                            }) as TreeElement;
                        }
                        if (this.childrenCache.has(child.id)) {
                            return this.childrenCache.get(child.id)!;
                        }
                        const wrapped = ext.state.wrapItemInStateHandling(child, (child: TreeElement) =>
                            this.refresh(child),
                        ) as TreeElement;
                        if (
                            !isTreeElementWithContextValue(child) ||
                            child.contextValue !== 'cosmosDB.workspace.item.error'
                        ) {
                            this.childrenCache.set(child.id, wrapped);
                        }
                        return wrapped;
                    });
                },
            );

            return result ?? [];
        } catch (error) {
            return [
                createGenericElement({
                    contextValue: 'cosmosDB.workspace.item.error',
                    label: l10n.t('Error: {0}', parseError(error).message),
                }) as TreeElement,
            ];
        }
    }

    /**
     * This function is being called when the resource tree is being built, it is called for every top level of resources.
     */
    async getResourceItem(): Promise<TreeElement> {
        const resourceItem = await callWithTelemetryAndErrorHandling(
            'CosmosDBWorkspaceBranchDataProvider.getResourceItem',
            () => {
                ext.cosmosDBWorkspaceBranchDataResource = this.resourcesCache as CosmosDBWorkspaceItem;
                return this.resourcesCache;
            },
        );

        if (resourceItem) {
            // Workspace picker relies on this value
            ext.cosmosDBWorkspaceBranchDataResource = this.resourcesCache as CosmosDBWorkspaceItem;
            return resourceItem;
        }

        return null as unknown as TreeElement;
    }

    getParent(element: TreeElement): TreeElement | null | undefined {
        const parentId = element.id.substring(0, element.id.lastIndexOf('/'));
        if (this.resourcesCache.id === parentId) {
            return this.resourcesCache;
        }
        if (parentId) {
            const parent = this.childrenCache.get(parentId);
            if (parent) {
                return parent;
            }
        }
        return undefined;
    }

    async getTreeItem(element: TreeElement): Promise<vscode.TreeItem> {
        return element.getTreeItem();
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
        this.onDidChangeTreeDataEmitter.fire(element);
    }

    protected isAncestorOf(element: TreeElement, id: string): boolean {
        const elementId = element.id + '/';
        return id.toLowerCase().startsWith(elementId.toLowerCase());
    }
}
