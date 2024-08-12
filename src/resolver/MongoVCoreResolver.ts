/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import {
    IActionContext,
    ISubscriptionContext,
    callWithTelemetryAndErrorHandling,
    nonNullProp,
} from '@microsoft/vscode-azext-utils';
import { AppResource, AppResourceResolver } from '@microsoft/vscode-azext-utils/hostapi';
import { createvCoreClient } from '../utils/azureClients';
import { IMongoVCoreAccountDetails, ResolvedMongoVCoreAccountResource } from './ResolvedMongoVCoreAccountResource';

const supportedResourceTypes = ['microsoft.documentdb/mongoclusters'];

//only contains the fields we're currently interested in
interface IMongoVCoreDetails {
    serverVersion: string;
    sku?: string;
    diskSize?: number;
    provisioningState?: string;
    clusterStatus?: string;
    publicNetworkAccess?: string;
    location?: string;
}

export class MongoVCoreResolver implements AppResourceResolver {
    private vCoreDetailsCacheUpdateRequested = true;
    private vCoreDetailsCache: Map<string, IMongoVCoreDetails> = new Map<string, IMongoVCoreDetails>();

    public async resolveResource(
        subContext: ISubscriptionContext,
        resource: AppResource,
    ): Promise<ResolvedMongoVCoreAccountResource | null | undefined> {
        return await callWithTelemetryAndErrorHandling('resolveResource', async (context: IActionContext) => {
            try {
                console.log('🚀 Resolving: ' + resource.id);

                /**
                 * todo: discuss:
                 * this looks nice, we pull all the vCore accounts and cache them when needed,
                 * and cache them for 10 seconds. Then we clear the cache to conserve memory.
                 * However, the 'resolveResource' functions is declared as async, so can it be called in parallel?
                 * If so, there is a problem here. JS/TS and race conditions? Is this a thing?
                 */
                // eslint-disable-next-line no-constant-condition
                if (this.vCoreDetailsCacheUpdateRequested && false) {
                    // disabling for a sec, something is broken with the backend
                    await callWithTelemetryAndErrorHandling(
                        'vCore.resolveResources.cacheUpdate',
                        async (context: IActionContext) => {
                            try {
                                this.vCoreDetailsCacheUpdateRequested = false;

                                setTimeout(() => {
                                    this.vCoreDetailsCache.clear();
                                    this.vCoreDetailsCacheUpdateRequested = true;
                                }, 1000 * 10); // clear cache after 10 seconds == keep cache for 10 seconds

                                const vCoreManagementClient = await createvCoreClient({ ...context, ...subContext });
                                const vCoreAccounts = await uiUtils.listAllIterator(
                                    vCoreManagementClient.mongoClusters.list(),
                                );

                                vCoreAccounts.map((vCoreAccount) => {
                                    this.vCoreDetailsCache.set(nonNullProp(vCoreAccount, 'id'), {
                                        serverVersion: vCoreAccount.serverVersion as string,
                                        sku:
                                            vCoreAccount.nodeGroupSpecs !== undefined
                                                ? (vCoreAccount.nodeGroupSpecs[0]?.sku as string)
                                                : undefined,
                                        location: vCoreAccount.location as string,
                                        diskSize:
                                            vCoreAccount.nodeGroupSpecs !== undefined
                                                ? (vCoreAccount.nodeGroupSpecs[0]?.diskSizeGB as number)
                                                : undefined,
                                        clusterStatus: vCoreAccount.clusterStatus as string,
                                        provisioningState: vCoreAccount.provisioningState as string,
                                    });
                                });
                            } catch (e) {
                                console.error({ ...context, ...subContext });
                                throw e;
                            }
                        },
                    );
                }

                // todo: this is not really the best way to do this, why not just use the same definition for both? fix this.
                const vCoreDetails: IMongoVCoreAccountDetails = {
                    name: resource.name,
                    version: this.vCoreDetailsCache.get(resource.id)?.serverVersion || undefined,
                    sku: this.vCoreDetailsCache.get(resource.id)?.sku || undefined,
                    location: this.vCoreDetailsCache.get(resource.id)?.location || undefined,
                    diskSize: this.vCoreDetailsCache.get(resource.id)?.diskSize || undefined,
                    clusterStatus: this.vCoreDetailsCache.get(resource.id)?.clusterStatus || undefined,
                    provisioningState: this.vCoreDetailsCache.get(resource.id)?.provisioningState || undefined,
                };

                switch (resource.type.toLowerCase()) {
                    case supportedResourceTypes[0]: {
                        return new ResolvedMongoVCoreAccountResource(subContext, resource.id, vCoreDetails, resource);
                    }
                    default:
                        return null;
                }
            } catch (e) {
                console.error({ ...context, ...subContext });
                throw e;
            }
        });
    }

    public matchesResource(resource: AppResource): boolean {
        return supportedResourceTypes.includes(resource.type.toLowerCase());
    }
}
