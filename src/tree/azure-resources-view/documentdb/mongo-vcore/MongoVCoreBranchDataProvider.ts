/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type GenericResource } from '@azure/arm-resources';
import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, nonNullProp, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureResource, type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { API, MongoClustersExperience } from '../../../../AzureDBExperiences';
import { createMongoClustersManagementClient } from '../../../../utils/azureClients';
import { BaseCachedBranchDataProvider } from '../../../BaseCachedBranchDataProvider';
import { type ClusterModel } from '../../../documentdb/ClusterModel';
import { type TreeElement } from '../../../TreeElement';
import { MongoVCoreResourceItem } from './MongoVCoreResourceItem';

export type MongoVCoreResource = AzureResource &
    GenericResource & {
        readonly raw: GenericResource; // Resource object from Azure SDK
    };

export class MongoVCoreBranchDataProvider extends BaseCachedBranchDataProvider<MongoVCoreResource> {
    protected get contextValue(): string {
        return 'mongoVCore.azure';
    }

    private detailsCacheUpdateRequested = true;
    private detailsCache: Map<string, ClusterModel> = new Map<string, ClusterModel>();
    private itemsToUpdateInfo: Map<string, MongoVCoreResourceItem> = new Map<string, MongoVCoreResourceItem>();

    protected createResourceItem(context: IActionContext, resource: MongoVCoreResource): TreeElement | undefined {
        // TODO: ClusterModel does not implement TreeElementWithExperience as other models do
        // and the base class will check isTreeElementWithExperience to set this property.
        // Since ClusterModel has a dbExperience property which is theoretically the same but named differently
        // set the experience to the API.MongoClusters explicitly here.
        context.telemetry.properties.experience = API.MongoClusters;

        if (this.detailsCacheUpdateRequested) {
            void this.updateResourceCache(context, resource.subscription, 1000 * 60 * 5).then(() => {
                /**
                 * Instances of MongoClusterItem were  stored in the itemsToUpdateInfo map,
                 * so that when the cache is updated, the items can be refreshed.
                 * I had to keep all of them in the map becasuse refresh requires the actual MongoClusterItem instance.
                 */
                this.itemsToUpdateInfo.forEach((value: MongoVCoreResourceItem) => {
                    value.cluster = {
                        ...value.cluster,
                        ...this.detailsCache.get(value.cluster.id),
                    };
                    this.refresh(value);
                });

                this.itemsToUpdateInfo.clear();
            });
        }

        // 1. extract the basic info from the element (subscription, resource group, etc., provided by Azure Resources)
        let clusterInfo: ClusterModel = {
            ...resource,
            dbExperience: MongoClustersExperience,
        } as ClusterModel;

        // 2. lookup the details in the cache, on subsequent refreshes, the details will be available in the cache
        if (this.detailsCache.has(clusterInfo.id)) {
            clusterInfo = {
                ...clusterInfo,
                ...this.detailsCache.get(clusterInfo.id),
            };
        }

        const clusterItem = new MongoVCoreResourceItem(resource.subscription, clusterInfo);

        // 3. store the item in the update queue, so that when the cache is updated, the item can be refreshed
        this.itemsToUpdateInfo.set(clusterItem.id, clusterItem);

        return clusterItem;
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
                            dbExperience: MongoClustersExperience,
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
}
