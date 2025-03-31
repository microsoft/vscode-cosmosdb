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
import { isTreeElementWithExperience } from './tree/TreeElementWithExperience';
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
    await callWithTelemetryAndErrorHandling('handleExternalUri', async (context: IActionContext) => {
        try {
            // Extract and validate parameters
            const params = extractAndValidateParams(context, uri.query);

            // Process the URI
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: l10n.t('Opening Azure Databases resource…'),
                    cancellable: false,
                },
                async () => {
                    if (params.resourceId) {
                        await handleResourceIdRequest(context, params);
                    } else {
                        await handleConnectionStringRequest(context, params);
                    }
                },
            );
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            throw new Error(l10n.t('Failed to process URI: {0}', errMsg));
        }
    });
}

async function handleResourceIdRequest(
    context: IActionContext,
    params: ReturnType<typeof extractParams>,
): Promise<void> {
    if (!params.resourceId) {
        throw new Error('Resource ID is required');
    }

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
    // reveal the account first, this will open the Azure Resource Groups view,
    // select the resource in the tree and expand it, forcing it to load the children
    await revealAzureResourceInExplorer(resourceId.rawId, params.database, params.container);
    await openAppropriateEditorForAzure(context, resourceId.rawId, params.database, params.container);
}

async function handleConnectionStringRequest(
    context: IActionContext,
    params: ReturnType<typeof extractParams>,
): Promise<void> {
    if (!params.connectionString) {
        throw new Error('Connection string is required');
    }

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
        await revealAzureResourceInExplorer(resourceId, params.database, params.container);
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
            await revealAttachedInWorkspaceExplorer(
                parsedConnection.connectionString.accountId,
                parsedConnection.api,
                params.database,
                params.container,
            );
        } else {
            // Handle MongoDB and MongoClusters
            const accountId =
                parsedConnection.connectionString.username +
                '@' +
                parsedConnection.connectionString.redact().toString();
            await createAttachedForConnection(
                accountId,
                parsedConnection.connectionString.username + '@' + parsedConnection.connectionString.hosts.join(','),
                parsedConnection.api,
                params.connectionString,
            );
            ext.cosmosDBWorkspaceBranchDataProvider.refresh();
            await revealAttachedInWorkspaceExplorer(accountId, parsedConnection.api, params.database, params.container);
        }
    }

    if (!params.container) {
        throw new Error(l10n.t("Can't open the Query Editor, Container name is required"));
    }

    // Open appropriate editor based on API type
    await openAppropriateEditorForConnection(context, parsedConnection, params.container, params.database);
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
async function revealAzureResourceInExplorer(resourceId: string, database?: string, container?: string): Promise<void> {
    // will open the Azure Resource Groups view
    const fullResourceId = `${resourceId}${database ? `/${database}${container ? `/${container}` : ''}` : ''}`;
    await vscode.commands.executeCommand('azureResourceGroups.focus');
    await ext.rgApiV2.resources.revealAzureResource(fullResourceId, {
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
    const parentId = `${api === API.Core ? WorkspaceResourceType.AttachedAccounts : WorkspaceResourceType.MongoClusters}/accounts`;
    await ext.state.showCreatingChild(parentId, l10n.t('Creating "{nodeName}"…', { nodeName: accountId }), async () => {
        const storageItem: SharedWorkspaceStorageItem = {
            id: `${api === API.Core ? WorkspaceResourceType.AttachedAccounts : WorkspaceResourceType.MongoClusters}/accounts/${accountId}`,
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
async function revealAttachedInWorkspaceExplorer(
    accountId: string,
    api: API,
    database?: string,
    container?: string,
): Promise<void> {
    // Open the Azure Workspace view
    await vscode.commands.executeCommand('azureWorkspace.focus');
    const fullId = `${api === API.Core ? WorkspaceResourceType.AttachedAccounts : WorkspaceResourceType.MongoClusters}/accounts/${accountId}`;
    const fullResourceId = `${fullId}${database ? `/${database}${container ? `/${container}` : ''}` : ''}`;
    // TODO: use revealWorkspaceResource!
    await ext.rgApiV2.resources.revealAzureResource(fullResourceId, {
        select: true,
        focus: true,
        expand: true,
    });
}

/**
 * Opens the appropriate editor based on the API type
 */
async function openAppropriateEditorForConnection(
    context: IActionContext,
    parsedConnection:
        | { api: API.Core; connectionString: ParsedCosmosDBConnectionString }
        | { api: API.MongoDB | API.MongoClusters; connectionString: ConnectionString },
    database: string | undefined,
    container: string | undefined,
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

async function openAppropriateEditorForAzure(
    context: IActionContext,
    resourceId: string,
    database?: string,
    container?: string,
): Promise<void> {
    if (!database) {
        throw new Error(l10n.t("Can't open the Query Editor, Database name is required"));
    }
    if (!container) {
        throw new Error(l10n.t("Can't open the Query Editor, Container name is required"));
    }

    const resource = await ext.cosmosDBBranchDataProvider.findNodeById(`${resourceId}/${database}/${container}`);
    if (!resource) {
        throw new Error(
            l10n.t(
                'Unable to find database "{0}" and collection "{1}" in resource "{2}". Please ensure the resource exists and try again.',
                database,
                container,
                resourceId,
            ),
        );
    }
    if (isTreeElementWithExperience(resource)) {
        context.telemetry.properties.experience = resource.experience.api;
        await vscode.commands.executeCommand(
            resource.experience.api === API.Core ? 'cosmosDB.openNoSqlQueryEditor' : 'documentdb.openCollectionView',
            resource,
        );
    } else {
        throw new Error(l10n.t('Unable to determine the experience for the resource'));
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

function extractParams(query: string): {
    resourceId?: string;
    subscriptionId?: string;
    resourceGroup?: string;
    connectionString?: string;
    database?: string;
    container?: string;
} {
    const queryParams = new URLSearchParams(query);
    return {
        resourceId: queryParams.get('resourceId') ?? undefined,
        subscriptionId: queryParams.get('subscriptionId') ?? undefined,
        resourceGroup: queryParams.get('resourceGroup') ?? undefined,
        connectionString: queryParams.get('cs') ?? undefined,
        database: queryParams.get('database') ?? undefined,
        container: queryParams.get('container') ?? undefined,
    };
}

// Define a proper interface for parameters
interface UriParams {
    resourceId?: string | undefined;
    subscriptionId?: string | undefined;
    resourceGroup?: string | undefined;
    connectionString?: string | undefined;
    database?: string | undefined;
    container?: string | undefined;
}

// Improved parameter extraction with validation
function extractAndValidateParams(context: IActionContext, query: string): UriParams {
    const params = extractParams(query);

    // Validate that we have at least one of the required identifiers
    if (!params.resourceId && !params.connectionString) {
        throw new Error(l10n.t('Either resource ID or connection string is required'));
    }

    // Track which path we're taking
    const isResourceId = query.includes('resourceId=');
    const isConnectionString = query.includes('cs=');

    context.telemetry.properties.uriType = isResourceId
        ? 'resourceId'
        : isConnectionString
          ? 'connectionString'
          : 'unknown';

    // Track database and container presence with explicit true/false values
    context.telemetry.properties.hasDatabase = params.database ? 'true' : 'false';
    context.telemetry.properties.hasContainer = params.container ? 'true' : 'false';

    return params;
}
