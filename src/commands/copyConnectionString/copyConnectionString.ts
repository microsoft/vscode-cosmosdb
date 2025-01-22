/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzExtTreeItem, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import {
    cosmosGremlinFilter,
    cosmosMongoFilter,
    cosmosTableFilter,
    postgresFlexibleFilter,
    postgresSingleFilter,
    sqlFilter,
} from '../../constants';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { ext } from '../../extensionVariables';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoClusterItemBase } from '../../mongoClusters/tree/MongoClusterItemBase';
import { checkAuthentication } from '../../postgres/commands/checkAuthentication';
import { addDatabaseToConnectionString, buildPostgresConnectionString } from '../../postgres/postgresConnectionStrings';
import { PostgresDatabaseTreeItem } from '../../postgres/tree/PostgresDatabaseTreeItem';
import { CosmosDBAccountResourceItemBase } from '../../tree/CosmosDBAccountResourceItemBase';
import { localize } from '../../utils/localize';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function copyPostgresConnectionString(
    context: IActionContext,
    node?: PostgresDatabaseTreeItem,
): Promise<void> {
    if (!node) {
        node = await ext.rgApi.pickAppResource<PostgresDatabaseTreeItem>(context, {
            filter: [postgresSingleFilter, postgresFlexibleFilter],
            expectedChildContextValue: PostgresDatabaseTreeItem.contextValue,
        });
    }

    if (!node) {
        return;
    }

    await copyConnectionString(context, node);
}

export async function cosmosDBCopyConnectionString(
    context: IActionContext,
    node?: MongoAccountTreeItem | DocDBAccountTreeItemBase,
): Promise<void> {
    const message = 'The connection string has been copied to the clipboard';
    if (!node) {
        node = await ext.rgApi.pickAppResource<MongoAccountTreeItem | DocDBAccountTreeItemBase>(context, {
            filter: [cosmosMongoFilter, cosmosTableFilter, cosmosGremlinFilter, sqlFilter],
        });
    }

    await vscode.env.clipboard.writeText(node.connectionString);
    void vscode.window.showInformationMessage(message);
}

export async function copyAzureConnectionString(
    context: IActionContext,
    node?: CosmosDBAccountResourceItemBase | MongoClusterItemBase,
) {
    if (!node) {
        node = await pickAppResource<CosmosDBAccountResourceItemBase | MongoClusterItemBase>(context, {
            type: [AzExtResourceType.AzureCosmosDb, AzExtResourceType.MongoClusters],
            expectedChildContextValue: ['treeItem.account', 'treeItem.mongoCluster'],
        });
    }

    if (!node) {
        return undefined;
    }

    await copyConnectionString(context, node);
}

export async function copyConnectionString(
    context: IActionContext,
    node: AzExtTreeItem | CosmosDBAccountResourceItemBase | MongoClusterItemBase, // Mongo Cluster (vCore), in both, the resource and in the workspace area
): Promise<void> {
    let connectionString: string | undefined;

    if (node instanceof PostgresDatabaseTreeItem) {
        await checkAuthentication(context, node);
        const parsedConnectionString = await node.parent.getFullConnectionString();
        if (node.parent.azureName) {
            const parsedCS = await node.parent.getFullConnectionString();
            connectionString = buildPostgresConnectionString(
                parsedCS.hostName,
                parsedCS.port,
                parsedCS.username,
                parsedCS.password,
                node.databaseName,
            );
        } else {
            connectionString = addDatabaseToConnectionString(
                parsedConnectionString.connectionString,
                node.databaseName,
            );
        }
    } else if (node instanceof DocDBAccountTreeItemBase || node instanceof MongoAccountTreeItem) {
        connectionString = node.connectionString;
    } else if (node instanceof CosmosDBAccountResourceItemBase || node instanceof MongoClusterItemBase) {
        connectionString = await ext.state.runWithTemporaryDescription(
            node.id,
            localize('copyConnectionString.working', 'Working...'),
            async () => {
                if (node instanceof CosmosDBAccountResourceItemBase) {
                    context.telemetry.properties.experience = node.experience.api;
                    return await node.getConnectionString();
                }

                if (node instanceof MongoClusterItemBase) {
                    context.telemetry.properties.experience = node.mongoCluster.dbExperience?.api;
                    return node.getConnectionString();
                }

                return undefined;
            },
        );
    }

    if (!connectionString) {
        void vscode.window.showErrorMessage(
            localize(
                'copyConnectionString.noConnectionString',
                'Failed to extract the connection string from the selected account.',
            ),
        );
    } else {
        await vscode.env.clipboard.writeText(connectionString);
        void vscode.window.showInformationMessage(
            localize('copyConnectionString.success', 'The connection string has been copied to the clipboard'),
        );
    }
}
