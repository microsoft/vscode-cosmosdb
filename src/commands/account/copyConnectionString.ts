/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { MongoClusterItemBase } from '../../mongoClusters/tree/MongoClusterItemBase';
import { type CosmosDBAttachedAccountsResourceItem } from '../../tree/attached/CosmosDBAttachedAccountsResourceItem';
import { DocumentDBAccountAttachedResourceItem } from '../../tree/docdb/DocumentDBAccountAttachedResourceItem';
import { DocumentDBAccountResourceItem } from '../../tree/docdb/DocumentDBAccountResourceItem';
import { MongoAccountResourceItem } from '../../tree/mongo/MongoAccountResourceItem';
import { localize } from '../../utils/localize';

export async function copyConnectionString(
    context: IActionContext,
    node?:
        | DocumentDBAccountAttachedResourceItem // NoSQL and other DocuemntDB accounts (except Mongo RU) in the resource area
        | CosmosDBAttachedAccountsResourceItem // NoSQL and other DocumentDB accounts (except Mongo RU) in the workspace area
        | MongoAccountResourceItem // Mongo (RU), WIP/work in progress, currently only the resource area
        | MongoClusterItemBase, // Mongo Cluster (vCore), in buth, the resource and in the workspace area
): Promise<void> {
    if (!node) {
        throw new Error('WIP: No node selected.'); // wip, wire up a picker
        // node = await ext.rgApi.pickAppResource<MongoAccountTreeItem | DocDBAccountTreeItemBase>(context, {
        //     filter: [cosmosMongoFilter, cosmosTableFilter, cosmosGremlinFilter, sqlFilter],
        // });
    }

    const connectionString = await ext.state.runWithTemporaryDescription(
        node.id,
        localize('copyConnectionString.working', 'Working...'),
        async () => {
            if (node instanceof DocumentDBAccountResourceItem) {
                context.telemetry.properties.experience = node.experience.api;
                return await node.getConnectionString();
            }

            if (node instanceof MongoAccountResourceItem) {
                context.telemetry.properties.experience = node.experience.api;
                return node.discoverConnectionString();
            }

            if (node instanceof DocumentDBAccountAttachedResourceItem) {
                context.telemetry.properties.experience = node.experience.api;
                return node.account.connectionString;
            }

            if (node instanceof MongoClusterItemBase) {
                context.telemetry.properties.experience = node.mongoCluster.dbExperience?.api;
                return node.discoverConnectionString();
            }

            return undefined;
        },
    );

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
