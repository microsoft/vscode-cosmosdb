/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzExtTreeItem, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { checkAuthentication } from '../../postgres/commands/checkAuthentication';
import { addDatabaseToConnectionString, buildPostgresConnectionString } from '../../postgres/postgresConnectionStrings';
import { PostgresDatabaseTreeItem } from '../../postgres/tree/PostgresDatabaseTreeItem';
import { CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
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

export async function copyAzureConnectionString(
    context: IActionContext,
    node?: CosmosDBAccountResourceItemBase | ClusterItemBase,
) {
    if (!node) {
        node = await pickAppResource<CosmosDBAccountResourceItemBase | ClusterItemBase>(context, {
            type: [AzExtResourceType.AzureCosmosDb, AzExtResourceType.MongoClusters],
        });
    }

    if (!node) {
        return undefined;
    }

    await copyConnectionString(context, node);
}

export async function copyConnectionString(
    context: IActionContext,
    node: AzExtTreeItem | CosmosDBAccountResourceItemBase | ClusterItemBase,
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
    } else if (node instanceof CosmosDBAccountResourceItemBase || node instanceof ClusterItemBase) {
        connectionString = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
            if (node instanceof CosmosDBAccountResourceItemBase) {
                context.telemetry.properties.experience = node.experience.api;
                return await node.getConnectionString();
            }

            if (node instanceof ClusterItemBase) {
                context.telemetry.properties.experience = node.cluster.dbExperience?.api;
                return node.getConnectionString();
            }

            return undefined;
        });
    }

    if (!connectionString) {
        void vscode.window.showErrorMessage(
            l10n.t('Failed to extract the connection string from the selected account.'),
        );
    } else {
        await vscode.env.clipboard.writeText(connectionString);
        void vscode.window.showInformationMessage(l10n.t('The connection string has been copied to the clipboard'));
    }
}
