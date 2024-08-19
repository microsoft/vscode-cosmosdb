/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import {
    type AzureResource,
    type AzureResourceBranchDataProvider,
    type ResourceModelBase,
    type ViewPropertiesModel
} from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { MongoClusterItem, type MongoClusterModel } from './MongoClusterItem';

export interface TreeElementBase extends ResourceModelBase {
    getChildren?(): vscode.ProviderResult<TreeElementBase[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;

    viewProperties?: ViewPropertiesModel;
}

export class MongoClustersBranchDataProvider
    extends vscode.Disposable
    implements AzureResourceBranchDataProvider<TreeElementBase>
{
    private vCoreDetailsCacheUpdateRequested = true;
    // private vCoreDetailsCache: Map<string, MongoClusterModel> = new Map<string, MongoClusterModel>();


    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeElementBase | undefined>();

    constructor() {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
        });
    }

    async getChildren(element: TreeElementBase): Promise<TreeElementBase[] | null | undefined> {
        // element here is an instance of MongoClusterItem
        return (await element.getChildren?.())?.map((child) => {
            if (child.id) {
                return ext.state.wrapItemInStateHandling(child as TreeElementBase & { id: string }, () => this.refresh(child))
            }
            return child;
        });
    }

    async getResourceItem(element: AzureResource): Promise<TreeElementBase> {
        const resourceItem = await callWithTelemetryAndErrorHandling(
            'mongoCluster.getResourceItem',
            async (_context: IActionContext) => {



                /**
                 * todo: discuss:
                 * this looks nice, we pull all the vCore accounts and cache them when needed,
                 * and cache them for 10 seconds. Then we clear the cache to conserve memory.
                 * However, the 'resolveResource' functions is declared as async, so can it be called in parallel?
                 * If so, there is a problem here. JS/TS and race conditions? Is this a thing?
                 */
                // eslint-disable-next-line no-constant-condition
                if (this.vCoreDetailsCacheUpdateRequested) {
                    // disabling for a sec, something is broken with the backend
                    // await callWithTelemetryAndErrorHandling(
                    //     'vCore.resolveResources.cacheUpdate',
                    //     async (context: IActionContext) => {
                    //         try {
                    //             this.vCoreDetailsCacheUpdateRequested = false;

                    //             setTimeout(() => {
                    //                 this.vCoreDetailsCache.clear();
                    //                 this.vCoreDetailsCacheUpdateRequested = true;
                    //             }, 1000 * 10); // clear cache after 10 seconds == keep cache for 10 seconds

                    //             const vCoreManagementClient = await createvCoreClient({ ...context, ...subContext });
                    //             const vCoreAccounts = await uiUtils.listAllIterator(
                    //                 vCoreManagementClient.mongoClusters.list(),
                    //             );

                    //             vCoreAccounts.map((vCoreAccount) => {
                    //                 this.vCoreDetailsCache.set(nonNullProp(vCoreAccount, 'id'), {
                    //                     serverVersion: vCoreAccount.serverVersion as string,
                    //                     sku:
                    //                         vCoreAccount.nodeGroupSpecs !== undefined
                    //                             ? (vCoreAccount.nodeGroupSpecs[0]?.sku as string)
                    //                             : undefined,
                    //                     location: vCoreAccount.location as string,
                    //                     diskSize:
                    //                         vCoreAccount.nodeGroupSpecs !== undefined
                    //                             ? (vCoreAccount.nodeGroupSpecs[0]?.diskSizeGB as number)
                    //                             : undefined,
                    //                     clusterStatus: vCoreAccount.clusterStatus as string,
                    //                     provisioningState: vCoreAccount.provisioningState as string,
                    //                 });
                    //             });
                    //         } catch (e) {
                    //             console.error({ ...context, ...subContext });
                    //             throw e;
                    //         }
                    //     },
                    // );
                }

                const clusterInfo: MongoClusterModel = element as MongoClusterModel;
                return new MongoClusterItem(element.subscription, clusterInfo);
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

    refresh(_element?: TreeElementBase): void {
        // this.onDidChangeTreeDataEmitter.fire(element);
        console.log('wrapItemInStateHandling');
    }
}
