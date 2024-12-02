/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import {
    type AzureResource,
    type AzureResourceBranchDataProvider,
    type ResourceModelBase,
} from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { API } from '../AzureDBExperiences';
import { ext } from '../extensionVariables';
import { type MongoAccountModel } from './mongo/MongoAccountModel';
import { MongoAccountResourceItem } from './mongo/MongoAccountResourceItem';
import { type NoSqlAccountModel } from './nosql/NoSqlAccountModel';
import { NoSqlAccountResourceItem } from './nosql/NoSqlAccountResourceItem';

const resourceTypes = [
    'microsoft.documentdb/databaseaccounts', // then, investigate .kind for "MongoDB"
    'microsoft.dbforpostgresql/servers',
    'microsoft.dbforpostgresql/flexibleservers',
];

export interface TreeElementBase extends ResourceModelBase {
    getChildren?(): vscode.ProviderResult<TreeElementBase[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}

export class CosmosBranchDataProvider
    extends vscode.Disposable
    implements AzureResourceBranchDataProvider<TreeElementBase>
{
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
            //context.telemetry.properties.experience = API.MongoClusters;
            context.telemetry.properties.parentContext = (await element.getTreeItem()).contextValue ?? 'unknown';

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
                switch (element.azureResourceType.type.toLowerCase()) {
                    case resourceTypes[0]: {
                        if (element.azureResourceType.kinds?.includes('mongodb')) {
                            context.telemetry.properties.experience = API.MongoDB;

                            // 1. extract the basic info from the element (subscription, resource group, etc., provided by Azure Resources)
                            const accountInfo: MongoAccountModel = element as unknown as MongoAccountModel;
                            accountInfo.dbExperience = API.MongoDB;

                            const item = new MongoAccountResourceItem(element.subscription, accountInfo);

                            return item;
                        } else {
                            // TODO: just "else"? really? explore the other options for 'kind', don't we have table, graphapi etc. in there??
                            context.telemetry.properties.experience = API.Core; // TODO: verify whether 'else' is still a good choice here

                            // 1. extract the basic info from the element (subscription, resource group, etc., provided by Azure Resources)
                            const accountInfo: NoSqlAccountModel = element as unknown as NoSqlAccountModel;
                            accountInfo.dbExperience = API.Core;

                            const item = new NoSqlAccountResourceItem(element.subscription, accountInfo);

                            return item;
                        }

                        // const client = await createCosmosDBClient({ ...context, ...subContext });
                        // const databaseAccount = await client.databaseAccounts.get(resourceGroupName, name);
                        // dbChild = await SubscriptionTreeItem.initCosmosDBChild(
                        //     client,
                        //     databaseAccount,
                        //     nonNullValue(subNode),
                        // );
                        // const experience = tryGetExperience(databaseAccount);

                        // return experience?.api === API.MongoDB
                        //     ? new ResolvedMongoAccountResource(dbChild as MongoAccountTreeItem, resource)
                        //     : new ResolvedDocDBAccountResource(dbChild as DocDBAccountTreeItem, resource);
                        return null;
                        break;
                    }
                    case resourceTypes[1]:
                    case resourceTypes[2]: {
                        // const postgresClient =
                        //     resource.type.toLowerCase() === resourceTypes[1]
                        //         ? await createPostgreSQLClient({ ...context, ...subContext })
                        //         : await createPostgreSQLFlexibleClient({ ...context, ...subContext });

                        // postgresServer = await postgresClient.servers.get(resourceGroupName, name);
                        // dbChild = await SubscriptionTreeItem.initPostgresChild(postgresServer, nonNullValue(subNode));

                        // return new ResolvedPostgresServerResource(dbChild as PostgresServerTreeItem, resource);
                        return null;
                    }
                    default:
                        return null;
                }
            },
        );

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return ext.state.wrapItemInStateHandling(resourceItem!, () => this.refresh(resourceItem as TreeElementBase));
    }

    async getTreeItem(element: TreeElementBase): Promise<vscode.TreeItem> {
        const ti = await element.getTreeItem();
        return ti;
    }

    refresh(element?: TreeElementBase): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
