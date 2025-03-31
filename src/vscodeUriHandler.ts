/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import ConnectionString from 'mongodb-connection-string-url';
import * as vscode from 'vscode';
import { API } from './AzureDBExperiences';
import { openNoSqlQueryEditor } from './commands/openNoSqlQueryEditor/openNoSqlQueryEditor';
import {
    parseCosmosDBConnectionString,
    type ParsedCosmosDBConnectionString,
} from './cosmosdb/cosmosDBConnectionStrings';
import { ext } from './extensionVariables';
import { getAccountInfo } from './tree/cosmosdb/AccountInfo';
import { WorkspaceResourceType } from './tree/workspace-api/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage, type SharedWorkspaceStorageItem } from './tree/workspace-api/SharedWorkspaceStorage';

const supportedProviders = [
    'Microsoft.DocumentDB/databaseAccounts',
    'Microsoft.DocumentDB/mongoClusters',
    //'Microsoft.DBforPostgreSQL/serverGroupsv2', // uncomment once we support Cosmos DB for PostgreSQL
];
/**
 * Handles external URIs directed to the extension
 * @param uri The URI to handle
 */
export async function globalUriHandler(uri: vscode.Uri): Promise<void> {
    return await callWithTelemetryAndErrorHandling('handleExternalUri', async (context: IActionContext) => {
        const queryParams = new URLSearchParams(uri.query);
        const params = {
            resourceId: queryParams.get('resourceId'),
            subscriptionId: queryParams.get('subscriptionId'),
            resourceGroup: queryParams.get('resourceGroup'),
            connectionString: queryParams.get('cs'),
            database: queryParams.get('database'),
            container: queryParams.get('container'),
        };

        if (params.resourceId) {
            const resourceId = parseAzureResourceId(params.resourceId);
            context.telemetry.properties.subscriptionId = resourceId.subscriptionId;
            context.telemetry.properties.resourceId = new vscode.TelemetryTrustedValue(resourceId.rawId);
            // Check if the provider is supported, even if revealing works for any resource,
            // we don't want to handle resources unsupported by this extension
            if (!supportedProviders.includes(resourceId.provider)) {
                throw new Error(
                    l10n.t(
                        'Unsupported resource provider: {0}. This extension only supports Cosmos DB resources.',
                        resourceId.provider,
                    ),
                );
            }
            await revealAzureResourceInExplorer(resourceId.rawId);

            // TODO: Currently we can't reveal the database and container in the Azure Explorer
            // We need to either implement this functionality in the BranchDataProvider impls
            // and run the appropriate command on the revelad collection node,
            // or provide the connection string in addition to the resource ID (currently supported for NoSQL only)
            /**
            // Open appropriate editor based on API type
            if (!params.database) {
                throw new Error(l10n.t('Database name is required'));
            }
            if (!params.container) {
                throw new Error(l10n.t('Container name is required'));
            }
            await openAppropriateEditor(context, parsedConnection, params.container);
            */
        } else if (params.connectionString) {
            const parsedConnection = parseConnectionString(params.connectionString);
            context.telemetry.properties.experience = parsedConnection.api;

            if (params.subscriptionId && params.resourceGroup) {
                // If subscriptionId and resourceGroup are provided, we need to extract the account name from the connection string
                context.telemetry.properties.subscriptionId = params.subscriptionId;
                let accountName: string | undefined;
                switch (parsedConnection.api) {
                    case API.Core:
                        accountName = parsedConnection.connectionString.accountName;
                        break;
                    case API.MongoDB:
                        accountName = parsedConnection.connectionString.username;
                        break;
                    case API.MongoClusters:
                        accountName =
                            parsedConnection.connectionString.hosts?.length > 0
                                ? // The hostname is in the format of "accountname.mongocluster.cosmos.azure.com"
                                  // Extract the first subdomain component by splitting the hostname on dots
                                  parsedConnection.connectionString.hosts[0]?.split('.')[0]
                                : undefined;
                        break;
                    default:
                        accountName = undefined;
                        break;
                }
                if (!accountName || accountName.length === 0) {
                    throw new Error(l10n.t('Unable to extract account name from connection string'));
                }
                const resourceId = createAzureResourceId(
                    parsedConnection.api,
                    params.subscriptionId,
                    params.resourceGroup,
                    accountName,
                );
                context.telemetry.properties.resourceId = new vscode.TelemetryTrustedValue(resourceId);
                await revealAzureResourceInExplorer(resourceId);
            } else {
                // Create storage item for the connection
                if (parsedConnection.api === API.Core) {
                    await createAttachedForConnection(
                        parsedConnection.connectionString.accountId,
                        parsedConnection.connectionString.accountName,
                        parsedConnection.api,
                        params.connectionString,
                    );
                    ext.cosmosDBWorkspaceBranchDataProvider.refresh();
                    await revealAttachedInWorkspaceExplorer(parsedConnection.connectionString.accountId);
                } else {
                    // Handle MongoDB and MongoClusters
                    const accountId =
                        parsedConnection.connectionString.username +
                        '@' +
                        parsedConnection.connectionString.redact().toString();
                    await createAttachedForConnection(
                        accountId,
                        parsedConnection.connectionString.username +
                            '@' +
                            parsedConnection.connectionString.hosts.join(','),
                        parsedConnection.api,
                        params.connectionString,
                    );
                    ext.cosmosDBWorkspaceBranchDataProvider.refresh();
                    await revealAttachedInWorkspaceExplorer(accountId);
                }
            }

            if (!params.container) {
                throw new Error(l10n.t("Can't open the Query Editor, Container name is required"));
            }

            // Open appropriate editor based on API type
            await openAppropriateEditor(context, parsedConnection, params.container, params.database);
        }
    });
}

function createAzureResourceId(api: API, subscriptionId: string, resourceGroup: string, accountName: string): string {
    switch (api) {
        case API.MongoClusters:
            // Document DB Clusters API resource ID format
            return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB/mongoClusters/${accountName}`;

        /** We don't support PG Clusters yet
        case API.PostgresSingle:
            return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DBforPostgreSQL/serverGroupsv2/sevoku-test-pg`;
        */

        default:
            // Cosmos DB Core resource ID format
            return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDb/databaseAccounts/${accountName}`;
    }
}

/**
 * Reveals the resource in Azure Explorer
 */
async function revealAzureResourceInExplorer(resourceId: string): Promise<void> {
    // will open the Azure Resource Groups view
    await vscode.commands.executeCommand('azureResourceGroups.focus');
    await ext.rgApiV2.resources.revealAzureResource(resourceId, {
        select: true,
        focus: true,
        expand: true,
    });
}

/**
 * Creates storage for the connection
 */
async function createAttachedForConnection(
    accountId: string,
    accountName: string,
    api: API,
    connectionString: string,
): Promise<void> {
    const parentId = '';
    await ext.state.showCreatingChild(parentId, l10n.t('Creating "{nodeName}"…', { nodeName: accountId }), async () => {
        const storageItem: SharedWorkspaceStorageItem = {
            id: accountId,
            name: accountName,
            properties: { isEmulator: false, api },
            secrets: [connectionString],
        };

        await SharedWorkspaceStorage.push(WorkspaceResourceType.AttachedAccounts, storageItem, true);
    });
}

/**
 * Reveals the resource in Azure Explorer
 */
async function revealAttachedInWorkspaceExplorer(_accountId: string): Promise<void> {
    // Open the Azure Workspace view
    await vscode.commands.executeCommand('azureWorkspace.focus');

    //TODO: we need to implement a refresh and revealTreeItem methods for attached accounts
    // await ext.rgApiV2.resources.revealWorkspaceItem(
    //     WorkspaceResourceType.AttachedAccounts,
    //     accountId,
    //     { select: true, focus: true, expand: true }
    // );
    return Promise.resolve();
}

/**
 * Opens the appropriate editor based on the API type
 */
async function openAppropriateEditor(
    context: IActionContext,
    parsedConnection:
        | { api: API.Core; connectionString: ParsedCosmosDBConnectionString }
        | { api: API.MongoDB | API.MongoClusters; connectionString: ConnectionString },
    database: string | null,
    container: string | null,
): Promise<void> {
    if (!container) {
        throw new Error(l10n.t("Can't open the Query Editor, Container name is required"));
    }

    if (parsedConnection.api === API.Core) {
        const info = await getAccountInfo(parsedConnection.connectionString);
        const parsedCS = parsedConnection.connectionString as ParsedCosmosDBConnectionString;
        const databaseName = database || parsedCS.databaseName;
        if (!databaseName) {
            throw new Error(l10n.t("Can't open the Query Editor, Database name is required"));
        }
        // Open NoSQL editor
        await openNoSqlQueryEditor(context, {
            databaseId: databaseName,
            containerId: container,
            endpoint: info.endpoint,
            credentials: info.credentials,
            isEmulator: false,
        });
    } else {
        // Open MongoDB editor
        // TODO: openCollectionViewInternal requires a valid Collection node that we don't have here
        // There are several options:
        // 1. Implement a new openCollectionView that opens the MongoDB editor with a connection string and a given database and collection
        // 2. revealAzureResourceInExplorer will reveal the MongoDB account in the Azure Explorer, but currently not the database and collection
        //    once that is supported (TODO above), we can use that to reveal the collection first then pass the selected
        //    CollectionItem node to openCollectionViewInternal
        /** meanwhile commended out:
        return openCollectionViewInternal(context, {
            id: node.id,
            clusterId: node.cluster.id,
            databaseName: node.databaseInfo.name,
            collectionName: node.collectionInfo.name,
            collectionTreeItem: node,
        });
        */
    }
}

/**
 * Parses a connection string to determine the API type and structure
 * @returns An object with the appropriate API type that always corresponds to the connection string type
 * TODO: we could reuse this to infer API from conection string when attaching new accounts and skip API selection where possible
 */
function parseConnectionString(
    connectionString: string,
):
    | { api: API.Core; connectionString: ParsedCosmosDBConnectionString }
    | { api: API.MongoDB | API.MongoClusters; connectionString: ConnectionString } {
    if (!connectionString) {
        throw new Error(l10n.t('Connection string cannot be empty'));
    }

    const MONGODB_PREFIX = 'mongodb';

    // MongoDB API connection strings always start with "mongodb"
    if (connectionString.startsWith(MONGODB_PREFIX)) {
        const parsedCS = new ConnectionString(connectionString);
        return {
            api: parsedCS.isSRV ? API.MongoClusters : API.MongoDB,
            connectionString: parsedCS,
        };
    }

    // All other connection strings are treated as Core API
    const parsedCS = parseCosmosDBConnectionString(connectionString);
    return {
        api: API.Core,
        connectionString: parsedCS,
    };
}
