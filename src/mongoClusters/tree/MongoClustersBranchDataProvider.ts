/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, nonNullProp, type IActionContext } from '@microsoft/vscode-azext-utils';
import {
    type AzureResource,
    type AzureResourceBranchDataProvider,
    type AzureSubscription,
    type ResourceModelBase,
} from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { API, MongoClustersExprience } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { createMongoClustersManagementClient } from '../../utils/azureClients';
import { type MongoClusterModel } from './MongoClusterModel';
import { MongoClusterResourceItem } from './MongoClusterResourceItem';

export interface TreeElementBase extends ResourceModelBase {
    getChildren?(): vscode.ProviderResult<TreeElementBase[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}

export class MongoClustersBranchDataProvider
    extends vscode.Disposable
    implements AzureResourceBranchDataProvider<TreeElementBase>
{
    private detailsCacheUpdateRequested = true;
    private detailsCache: Map<string, MongoClusterModel> = new Map<string, MongoClusterModel>();
    private itemsToUpdateInfo: Map<string, MongoClusterResourceItem> = new Map<string, MongoClusterResourceItem>();

    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeElementBase | undefined>();

    constructor() {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
        });
    }

    get onDidChangeTreeData(): vscode.Event<TreeElementBase | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    async getChildren(element: TreeElementBase): Promise<TreeElementBase[] | null | undefined> {
        /**
         * getChildren is called for every element in the tree when expanding, the element being expanded is being passed as an argument
         */
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.experience = API.MongoClusters;
            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue || 'unknown';

            return (await element.getChildren?.())?.map((child) => {
                if (child.id) {
                    return ext.state.wrapItemInStateHandling(child as TreeElementBase & { id: string }, () =>
                        this.refresh(child),
                    );
                }
                return child;
            });
        });
    }

    async getResourceItem(element: AzureResource): Promise<TreeElementBase> {
        /**
         * This function is being called when the resource tree is being built, it is called for every resource element in the tree.
         */

        const resourceItem = await callWithTelemetryAndErrorHandling(
            'resolveResource',
            // disabling require-await, the async aspect is in there, but uses the .then pattern
            // eslint-disable-next-line @typescript-eslint/require-await
            async (context: IActionContext) => {
                context.telemetry.properties.experience = API.MongoClusters;

                if (this.detailsCacheUpdateRequested) {
                    void this.updateResourceCache(context, element.subscription, 1000 * 60 * 5).then(() => {
                        /**
                         * Instances of MongoClusterItem were  stored in the itemsToUpdateInfo map,
                         * so that when the cache is updated, the items can be refreshed.
                         * I had to keep all of them in the map becasuse refresh requires the actual MongoClusterItem instance.
                         */
                        this.itemsToUpdateInfo.forEach((value: MongoClusterResourceItem) => {
                            value.mongoCluster = {
                                ...value.mongoCluster,
                                ...this.detailsCache.get(value.mongoCluster.id),
                            };
                            this.refresh(value);
                        });

                        this.itemsToUpdateInfo.clear();
                    });
                }

                // 1. extract the basic info from the element (subscription, resource group, etc., provided by Azure Resources)
                let clusterInfo: MongoClusterModel = element as MongoClusterModel;
                clusterInfo.dbExperience = API.MongoClusters;

                // 2. lookup the details in the cache, on subsequent refreshes, the details will be available in the cache
                if (this.detailsCache.has(clusterInfo.id)) {
                    clusterInfo = {
                        ...clusterInfo,
                        ...this.detailsCache.get(clusterInfo.id),
                    };
                }

                const clusterItem = new MongoClusterResourceItem(element.subscription, clusterInfo);

                // 3. store the item in the update queue, so that when the cache is updated, the item can be refreshed
                this.itemsToUpdateInfo.set(clusterItem.id, clusterItem);

                return clusterItem;
            },
        );

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return ext.state.wrapItemInStateHandling(resourceItem!, () => this.refresh(resourceItem));
    }

    async updateResourceCache(
        _context: IActionContext,
        subscription: AzureSubscription,
        cacheDuration: number,
    ): Promise<void> {
        return callWithTelemetryAndErrorHandling(
            'resolveResource.updatingResourceCache',
            async (context: IActionContext) => {
                try {
                    context.telemetry.properties.experience = API.MongoClusters;

                    this.detailsCacheUpdateRequested = false;

                    setTimeout(() => {
                        this.detailsCache.clear();
                        this.detailsCacheUpdateRequested = true;
                    }, cacheDuration); // clear cache after 5 minutes == keep cache for 5 minutes 1000 * 60 * 5

                    const client = await createMongoClustersManagementClient(_context, subscription);
                    const accounts = await uiUtils.listAllIterator(client.mongoClusters.list());

                    accounts.map((MongoClustersAccount) => {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                        this.detailsCache.set(nonNullProp(MongoClustersAccount, 'id'), {
                            dbExperience: MongoClustersExprience,
                            id: MongoClustersAccount.id as string,
                            name: MongoClustersAccount.name as string,
                            resourceGroup: getResourceGroupFromId(MongoClustersAccount.id as string),

                            location: MongoClustersAccount.location as string,
                            serverVersion: MongoClustersAccount.serverVersion as string,

                            systemData: {
                                createdAt: MongoClustersAccount.systemData?.createdAt,
                            },

                            sku:
                                MongoClustersAccount.nodeGroupSpecs !== undefined
                                    ? (MongoClustersAccount.nodeGroupSpecs[0]?.sku as string)
                                    : undefined,
                            diskSize:
                                MongoClustersAccount.nodeGroupSpecs !== undefined
                                    ? (MongoClustersAccount.nodeGroupSpecs[0]?.diskSizeGB as number)
                                    : undefined,
                            nodeCount:
                                MongoClustersAccount.nodeGroupSpecs !== undefined
                                    ? (MongoClustersAccount.nodeGroupSpecs[0]?.nodeCount as number)
                                    : undefined,
                            enableHa:
                                MongoClustersAccount.nodeGroupSpecs !== undefined
                                    ? (MongoClustersAccount.nodeGroupSpecs[0]?.enableHa as boolean)
                                    : undefined,
                        });
                    });
                } catch (e) {
                    console.debug({ ...context, ...subscription });
                    throw e;
                }
            },
        );
    }

    // onDidChangeTreeData?: vscode.Event<void | TreeElementBase | TreeElementBase[] | null | undefined> | undefined;

    async getTreeItem(element: TreeElementBase): Promise<vscode.TreeItem> {
        const ti = await element.getTreeItem();
        return ti;
    }

    refresh(element?: TreeElementBase): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
