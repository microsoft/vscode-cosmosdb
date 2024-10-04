/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, nonNullProp, type IActionContext } from '@microsoft/vscode-azext-utils';
import {
    type AzureResource,
    type AzureResourceBranchDataProvider,
    type ResourceModelBase,
    type ViewPropertiesModel,
} from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { createMongoClustersClient } from '../../utils/azureClients';
import { MongoClusterItem, type MongoClusterModel } from './MongoClusterItem';

class AsyncLock {
    disable: () => void;
    promise: Promise<void>;
    constructor() {
        this.disable = () => {
            return;
        };
        this.promise = Promise.resolve();
    }

    enable() {
        this.promise = new Promise((resolve) => (this.disable = resolve));
    }
}

export interface TreeElementBase extends ResourceModelBase {
    getChildren?(): vscode.ProviderResult<TreeElementBase[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;

    viewProperties?: ViewPropertiesModel;
}

export class MongoClustersBranchDataProvider
    extends vscode.Disposable
    implements AzureResourceBranchDataProvider<TreeElementBase>
{
    private detailsCacheUpdateRequested = true;
    private detailsCache: Map<string, MongoClusterModel> = new Map<string, MongoClusterModel>();

    // Create a new lock
    lock = new AsyncLock();

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
        return (await element.getChildren?.())?.map((child) => {
            if (child.id) {
                return ext.state.wrapItemInStateHandling(child as TreeElementBase & { id: string }, () =>
                    this.refresh(child),
                );
            }
            return child;
        });
    }

    async getResourceItem(element: AzureResource): Promise<TreeElementBase> {
        /**
         * This function is being called when the tree is being built, it is called for every element in the tree.
         *
         * It executes in a way that the caller doesn't wait for the first result to come back before
         * issuing another reqeust.
         * This is the reason why a 'lock' implementation is in place to load more details about mongoClusters.
         */

        const resourceItem = await callWithTelemetryAndErrorHandling(
            'mongoCluster.getResourceItem',
            async (_context: IActionContext) => {
                /**
                 * todo: discuss:
                 * this looks nice, we pull all the mongoClusters accounts and cache them when needed,
                 * and cache them for 10 seconds. Then we clear the cache to conserve memory.
                 * However, the 'resolveResource' functions is declared as async, so can it be called in parallel?
                 * If so, there is a problem here. JS/TS and race conditions? Is this a thing?
                 */
                // eslint-disable-next-line no-constant-condition
                if (this.detailsCacheUpdateRequested && false) {
                    void (await callWithTelemetryAndErrorHandling(
                        'mongoClusters.getResourceItem.cacheUpdate',
                        async (context: IActionContext) => {
                            try {
                                this.lock.enable();

                                this.detailsCacheUpdateRequested = false;

                                setTimeout(() => {
                                    this.detailsCache.clear();
                                    this.detailsCacheUpdateRequested = true;
                                }, 1000 * 10); // clear cache after 10 seconds == keep cache for 10 seconds

                                const client = await createMongoClustersClient(_context, element.subscription);
                                const accounts = await uiUtils.listAllIterator(client.mongoClusters.list());

                                accounts.map((MongoClustersAccount) => {
                                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                                    this.detailsCache.set(nonNullProp(MongoClustersAccount, 'id'), {
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
                                console.error({ ...context, ...element.subscription });
                                this.lock.disable();
                                throw e;
                            }

                            this.lock.disable();
                        },
                    ));
                }

                // make sure we've waited for the cache to be updated
                await this.lock.promise;

                let clusterInfo: MongoClusterModel = element as MongoClusterModel;

                if (this.detailsCache.has(clusterInfo.id)) {
                    clusterInfo = {
                        ...clusterInfo,
                        ...this.detailsCache.get(clusterInfo.id),
                    };
                }

                const cItem = new MongoClusterItem(element.subscription, clusterInfo);

                return cItem;
            },
        );

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return ext.state.wrapItemInStateHandling(resourceItem!, () => this.refresh(resourceItem));
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
