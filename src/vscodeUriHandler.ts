/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId, type ParsedAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import {
    callWithTelemetryAndErrorHandling,
    nonNullValue,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import ConnectionString from 'mongodb-connection-string-url';
import * as vscode from 'vscode';
import { API, getExperienceFromApi } from './AzureDBExperiences';
import { openCollectionViewInternal } from './commands/openCollectionView/openCollectionView';
import { openNoSqlQueryEditor } from './commands/openNoSqlQueryEditor/openNoSqlQueryEditor';
import {
    parseCosmosDBConnectionString,
    type ParsedCosmosDBConnectionString,
} from './cosmosdb/cosmosDBConnectionStrings';
import { ext } from './extensionVariables';
import { StorageNames, StorageService, type StorageItem } from './services/storageService';
import { getAccountInfo } from './tree/cosmosdb/AccountInfo';
import { type TreeElement } from './tree/TreeElement';
import { isTreeElementWithContextValue } from './tree/TreeElementWithContextValue';
import { isTreeElementWithExperience } from './tree/TreeElementWithExperience';
import { WorkspaceResourceType } from './tree/workspace-api/SharedWorkspaceResourceProvider';
import { getConfirmationAsInSettings } from './utils/dialogs/getConfirmation';
import { getEmulatorItemLabelForApi, getEmulatorItemUniqueId, getIsEmulatorConnection } from './utils/emulatorUtils';
import { generateMongoStorageId } from './utils/storageUtils';

const supportedProviders = [
    'Microsoft.DocumentDB/databaseAccounts',
    'Microsoft.DocumentDB/mongoClusters',
    //'Microsoft.DBforPostgreSQL/serverGroupsv2', // uncomment once we support Cosmos DB for PostgreSQL
];

/**
 * Global URI handler for processing external URIs related to Azure Databases.
 * This function handles URIs that contain either resource IDs or connection strings.
 *
 * @param uri - The VS Code URI to handle, typically from an external source
 * @returns {Promise<void>} A Promise that resolves when the URI has been handled
 * @throws {Error} Will throw an error if URI processing fails, wrapped with appropriate error message
 *
 * The handler shows a progress notification while:
 * 1. Extracting and validating parameters from the URI query
 * 2. Processing either resource ID based requests or connection string requests
 *
 * All operations are tracked with telemetry and error handling.
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

/**
 * Handles a request to process an Azure resource identified by a resource ID.
 *
 * This function verifies that the resource ID is valid and belongs to a supported provider,
 * then reveals the resource in the Azure explorer and opens the appropriate editor.
 *
 * @param context - The action context containing telemetry and other contextual information
 * @param params - Parameters extracted from the request containing resourceId and optional database/container info
 * @throws {Error} When resource ID is missing or when the provider is not supported
 * @returns {Promise<void>} A promise that resolves when the resource handling is complete
 */
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
    if (!supportedProviders.some((provider) => provider.toLowerCase() === resourceId.provider.toLowerCase())) {
        throw new Error(
            l10n.t(
                'Unsupported resource provider: {0}. This extension only supports Cosmos DB resources.',
                resourceId.provider,
            ),
        );
    }
    // reveal the account first, this will open the Azure Resource Groups view,
    // select the resource in the tree and expand it, forcing it to load the children
    const resource = await revealAzureResourceInExplorer(context, resourceId, params.database, params.container);
    if (params.database && params.container) {
        await openAppropriateEditorForAzure(resource);
    }
}

/**
 * Handles connection string requests by connecting to Azure Cosmos DB resources.
 *
 * This function processes a connection string and optional parameters to either:
 * 1. Connect to an Azure Cosmos DB resource identified by subscription ID and resource group, or
 * 2. Create an attached account from the connection string in the workspace explorer
 *
 * After establishing the connection, it will reveal the resource in the appropriate explorer
 * and open the query editor if a container is specified.
 *
 * @param context - The action context for telemetry and other VS Code operations
 * @param params - The parameters extracted from the request, including connection string,
 *                 subscription ID, resource group, database name, and container name
 * @throws {Error} when connection string is missing, account name can't be extracted,
 *        or container name is missing when trying to open the query editor
 * @returns {Promise<void>} A promise that resolves when the connection handling is complete
 */
async function handleConnectionStringRequest(
    context: IActionContext,
    params: ReturnType<typeof extractParams>,
): Promise<void> {
    if (!params.connectionString) {
        throw new Error('Connection string is required');
    }

    const parsedConnection = parseConnectionString(context, params.connectionString);
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
        context.telemetry.properties.resourceId = new vscode.TelemetryTrustedValue(resourceId.rawId);
        const resource = await revealAzureResourceInExplorer(context, resourceId, params.database, params.container);
        if (params.database && params.container) {
            await openAppropriateEditorForAzure(resource);
        }
    } else {
        // Create storage item for the connection
        if (parsedConnection.api === API.Core) {
            const isEmulator = getIsEmulatorConnection(parsedConnection.connectionString);
            const fullId = await createAttachedForConnection(
                parsedConnection.connectionString.accountId,
                parsedConnection.connectionString.accountName,
                parsedConnection.api,
                params.connectionString,
                isEmulator,
                parsedConnection.connectionString.port,
            );
            ext.cosmosDBWorkspaceBranchDataProvider.refresh();
            await revealAttachedInWorkspaceExplorer(fullId, params.database, params.container);
        } else {
            // Handle MongoDB and MongoClusters
            const accountId = generateMongoStorageId(parsedConnection.connectionString.toString()); // FYI: working with the prasedConnection string for to guarantee a consistent accountId in this file.

            const isEmulator =
                parsedConnection.connectionString.hosts?.length > 0 &&
                parsedConnection.connectionString.hosts[0].includes('localhost');

            const disableEmulatorSecurity =
                parsedConnection.connectionString.searchParams.get('tlsAllowInvalidCertificates') === 'true';

            const fullId = await createAttachedForConnection(
                accountId,
                parsedConnection.connectionString.username + '@' + parsedConnection.connectionString.hosts.join(','),
                parsedConnection.api,
                params.connectionString,
                isEmulator,
                parsedConnection.connectionString.port,
                disableEmulatorSecurity,
            );
            ext.mongoClustersWorkspaceBranchDataProvider.refresh();
            await revealAttachedInWorkspaceExplorer(fullId, params.database, params.container);
        }
        if (params.database && params.container) {
            // Open appropriate editor based on API type
            await openAppropriateEditorForConnection(context, parsedConnection, params.database, params.container);
        }
    }
}

/**
 * Generates an Azure resource ID for the specified Cosmos DB resource.
 *
 * @param api - The API type of the Cosmos DB resource
 * @param subscriptionId - The Azure subscription ID
 * @param resourceGroup - The resource group name
 * @param accountName - The account name of the Cosmos DB resource
 * @returns A formatted Azure resource ID string
 *
 * @remarks
 * Different API types require different resource ID formats:
 * - For MongoDB Clusters, it uses the Microsoft.DocumentDB/mongoClusters format
 * - For other APIs, it uses the Microsoft.DocumentDb/databaseAccounts format
 * - PostgreSQL Clusters support is not implemented yet
 */
function createAzureResourceId(
    api: API,
    subscriptionId: string,
    resourceGroup: string,
    accountName: string,
): ParsedAzureResourceId {
    switch (api) {
        case API.MongoClusters:
            // Document DB Clusters API resource ID format
            return parseAzureResourceId(
                `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB/mongoClusters/${accountName}`,
            );

        /** We don't support PG Clusters yet
        case API.PostgresSingle:
            return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DBforPostgreSQL/serverGroupsv2/sevoku-test-pg`;
        */

        default:
            // Cosmos DB Core resource ID format
            return parseAzureResourceId(
                `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDb/databaseAccounts/${accountName}`,
            );
    }
}

/**
 * Reveals an Azure resource in the Azure Resource Groups explorer.
 *
 * @param resourceId - The ID of the Azure resource to reveal.
 * @param database - Optional. The name of the database associated with the resource.
 * @param container - Optional. The name of the container associated with the database.
 * @returns A promise that resolves when the resource is revealed in the explorer.
 *
 * @remarks
 * This function:
 * 1. Constructs a full resource ID that may include database and container paths.
 * 2. Focuses the Azure Resource Groups view in the explorer.
 * 3. Reveals the specified Azure resource in the explorer with selection, focus, and expansion.
 */
async function revealAzureResourceInExplorer(
    context: IActionContext,
    resourceId: ParsedAzureResourceId,
    database?: string,
    container?: string,
): Promise<TreeElement> {
    await vscode.commands.executeCommand('azureResourceGroups.focus');
    await ext.rgApiV2.resources.revealAzureResource(resourceId.rawId, {
        select: true,
        focus: true,
        expand: true,
    });

    let fulId = resourceId.rawId;
    if (database && container) {
        fulId = `${resourceId.rawId}${database ? `/${database}${container ? `/${container}` : ''}` : ''}`;
        await ext.rgApiV2.resources.revealAzureResource(fulId, {
            select: true,
            focus: true,
            expand: true,
        });
    }

    let resource: TreeElement | undefined;
    const branchDataProvider =
        resourceId.provider === 'Microsoft.DocumentDB/mongoClusters'
            ? ext.mongoVCoreBranchDataProvider
            : ext.cosmosDBBranchDataProvider;
    const revealedId = await ext.rgApiV2.resources.getSelectedAzureNode();
    if (revealedId) {
        const strippedId = removeAzureTenantPrefix(revealedId);
        resource = await branchDataProvider.findNodeById(strippedId);
    } else {
        resource = await branchDataProvider.findNodeById(fulId);
    }

    if (!resource) {
        throw new Error(
            l10n.t('Unable to find resource "{0}". Please ensure the resource exists and try again.', resourceId.rawId),
        );
    }

    context.telemetry.properties.experience = isTreeElementWithExperience(resource)
        ? resource.experience.api
        : 'unknown';

    // Check if the selected resource is a collection if database and collection were provided
    if (database && container && !resource.id.endsWith(`/${container}`)) {
        throw new Error(
            l10n.t(
                'Unable to find database "{0}" and collection "{1}" in resource "{2}". Please ensure the resource exists and try again.',
                database,
                container,
                resourceId.rawId,
            ),
        );
    }
    return resource;
}

/**
 * Creates and attaches a database connection to the workspace.
 *
 * @param accountId - The ID of the account to attach
 * @param accountName - The display name of the account
 * @param api - The API type (Core, MongoDB, etc.) of the account
 * @param connectionString - The connection string used to connect to the account
 * @param isEmulator - Whether this connection is to a local emulator
 * @param emulatorPort - Optional port number for the emulator connection
 * @returns A Promise that resolves to the ID of the created/updated connection
 *
 * @remarks
 * This function will:
 * 1. Focus the Azure Workspace view
 * 2. Create the connection with the specified parameters
 * 3. If a connection with the same ID already exists, prompt the user to update it
 */
async function createAttachedForConnection(
    accountId: string,
    accountName: string,
    api: API,
    connectionString: string,
    isEmulator: boolean,
    emulatorPort?: string,
    disableEmulatorSecurity?: boolean,
): Promise<string> {
    const rootId = `${api === API.Core ? WorkspaceResourceType.AttachedAccounts : WorkspaceResourceType.MongoClusters}`;
    const parentId = `${rootId}${isEmulator ? '/localEmulators' : ''}`;
    const name = !isEmulator ? accountName : getEmulatorItemLabelForApi(api, emulatorPort);
    const id = !isEmulator ? accountId : getEmulatorItemUniqueId(connectionString);
    const fulId = `${parentId}/${id}`;
    // Open the Azure Workspace view
    await vscode.commands.executeCommand('azureWorkspace.focus');
    if (rootId !== parentId) {
        // TODO: this seems to be a bug in revealWorkspaceResource
        // If the parentId is not the root it will fail to drill down into the hierarchy,
        // we need to reveal the root first
        await ext.rgApiV2.resources.revealWorkspaceResource(rootId, {
            select: true,
            focus: true,
            expand: true,
        });
    }
    // Reveal the parent node to show progress in the tree
    await ext.rgApiV2.resources.revealWorkspaceResource(parentId, {
        select: true,
        focus: true,
        expand: true,
    });
    await ext.state.showCreatingChild(parentId, l10n.t('Creating "{nodeName}"…', { nodeName: accountId }), async () => {
        const storageItem: StorageItem = {
            id,
            name,
            properties: { isEmulator, api, ...(disableEmulatorSecurity && { disableEmulatorSecurity }) },
            secrets: [connectionString],
        };

        try {
            await StorageService.get(StorageNames.Workspace).push(
                api === API.Core ? WorkspaceResourceType.AttachedAccounts : WorkspaceResourceType.MongoClusters,
                storageItem,
                false,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('already exists')) {
                let confirmed: boolean = false;
                try {
                    confirmed = await getConfirmationAsInSettings(
                        l10n.t('Update existing {accountType} connection?', {
                            accountType: getExperienceFromApi(api).longName,
                        }),
                        l10n.t('The connection "{connectionName}" already exists. Do you want to update it?', {
                            connectionName: name,
                        }),
                        'update',
                    );
                } catch (error) {
                    if (error instanceof UserCancelledError) {
                        confirmed = false;
                    } else {
                        throw error;
                    }
                }

                if (confirmed) {
                    await StorageService.get(StorageNames.Workspace).push(
                        WorkspaceResourceType.AttachedAccounts,
                        storageItem,
                        true,
                    );
                }
            } else {
                throw error;
            }
        }
    });
    return fulId;
}

/**
 * Reveals an attached account in the Azure Workspace Explorer.
 * First focuses on the Azure Workspace view, then reveals the specified resource in the tree.
 *
 * @param accountId - The ID of the account to reveal
 * @param api - Specifies whether this is a Core or MongoDB API account
 * @param database - Optional database name to reveal within the account
 * @param container - Optional container name to reveal within the database
 * @returns A Promise that resolves when the resource has been revealed in the workspace explorer
 */
async function revealAttachedInWorkspaceExplorer(
    accountId: string,
    database?: string,
    container?: string,
): Promise<void> {
    const fullResourceId = `${accountId}${database ? `/${database}${container ? `/${container}` : ''}` : ''}`;
    await ext.rgApiV2.resources.revealWorkspaceResource(fullResourceId, {
        select: true,
        focus: true,
        expand: true,
    });
}

/**
 * Opens an appropriate editor for a Cosmos DB connection.
 *
 * @param context The action context.
 * @param parsedConnection The parsed connection information, containing either a Core API connection string or a MongoDB API connection string.
 * @param database The name of the database to connect to. If not provided, it will attempt to use the database name from the connection string.
 * @param container The name of the container (collection) to open.
 * @throws Error if container name is not provided, or if database name is not provided for Core API connections.
 * @returns A promise that resolves when the editor is opened.
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
        const accountId = generateMongoStorageId(parsedConnection.connectionString.toString()); // FYI: working with the prasedConnection string for to guarantee a consistent accountId in this file.
        const expectedClusterId = `${WorkspaceResourceType.MongoClusters}/${accountId}`;

        return openCollectionViewInternal(context, {
            clusterId: expectedClusterId,
            databaseName: nonNullValue(database),
            collectionName: nonNullValue(container),
        });
    }
}

/**
 * Opens the appropriate editor for a Cosmos DB resource in Azure.
 *
 * @param context - The action context for the operation.
 * @param resourceId - The Azure resource ID of the Cosmos DB account.
 * @param database - The name of the database to open. Required for query editor.
 * @param container - The name of the container to open. Required for query editor.
 * @throws Error if database or container names are not provided.
 * @throws Error if the specified database and container combination cannot be found.
 * @throws Error if the experience type for the resource cannot be determined.
 * @returns Promise that resolves when the appropriate editor has been opened.
 */
async function openAppropriateEditorForAzure(resource: TreeElement): Promise<void> {
    if (
        isTreeElementWithExperience(resource) &&
        isTreeElementWithContextValue(resource) &&
        (resource.contextValue.includes('treeItem.collection') || resource.contextValue.includes('treeItem.container'))
    ) {
        await vscode.commands.executeCommand(
            resource.experience.api === API.Core
                ? 'cosmosDB.openNoSqlQueryEditor'
                : 'command.mongoClusters.containerView.open',
            resource,
        );
    } else {
        throw new Error(l10n.t('Unable to determine the experience for the resource'));
    }
}

/**
 * Removes the Azure tenant prefix from an ID string.
 *
 * @param id - The ID string to process. If not provided, an empty string is returned.
 * @returns The processed ID string without the Azure tenant prefix.
 *
 * @remarks
 * Azure Resourcegroups maintains the whole ID hierarchy including accounts and tenants.
 * Since we contribute and maintain just a subtree, we need to remove the prefix:
 * https://github.com/microsoft/vscode-azureresourcegroups/blob/71a0b12ad4b8f9cafef497e673abfb79c9ad208d/src/tree/ResourceTreeDataProviderBase.ts#L168
 * This function uses a regular expression to remove the "/accounts/{accountName}/tenants/{tenantId}/" prefix
 * from the given ID string. If the input is undefined or empty, it returns an empty string.
 */
function removeAzureTenantPrefix(id?: string): string {
    return id?.replace(/\/accounts\/.+\/tenants\/[^/]+\//i, '/') || '';
}

/**
 * Parses a connection string to determine the API type and return the appropriate connection object.
 *
 * @param connectionString - The connection string to parse. Cannot be empty.
 * @returns An object containing:
 *   - api: The API type (Core, MongoDB, or MongoClusters)
 *   - connectionString: The parsed connection string object, either a ParsedCosmosDBConnectionString or ConnectionString
 * @throws Error if the connection string is empty
 */
function parseConnectionString(
    context: IActionContext,
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
        [parsedCS.username, parsedCS.password, parsedCS.port, ...(parsedCS.hosts || [])]
            .filter(Boolean)
            .forEach((value) => context.valuesToMask.push(value));
        return {
            api: parsedCS.isSRV ? API.MongoClusters : API.MongoDB,
            connectionString: parsedCS,
        };
    }

    // All other connection strings are treated as Core API
    const parsedCS = parseCosmosDBConnectionString(connectionString);
    [parsedCS.masterKey, parsedCS.databaseName]
        .filter((value): value is string => Boolean(value))
        .forEach((value) => context.valuesToMask.push(value));
    return {
        api: API.Core,
        connectionString: parsedCS,
    };
}

/**
 * Extracts query parameters from a URL query string.
 * @param query - The URL query string to extract parameters from.
 * @returns An object containing the extracted parameters:
 *   - resourceId - The Azure resource ID (if present).
 *   - subscriptionId - The Azure subscription ID (if present).
 *   - resourceGroup - The Azure resource group name (if present).
 *   - connectionString - The connection string for the Cosmos DB account (if present). Extracted from 'cs' parameter.
 *   - database - The name of the database (if present).
 *   - container - The name of the container (if present).
 */
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

/**
 * Interface for URI parameters used for connecting to Azure Cosmos DB resources.
 * @property resourceId - The Azure resource ID of the Cosmos DB account.
 * @property subscriptionId - The Azure subscription ID.
 * @property resourceGroup - The Azure resource group name containing the Cosmos DB account.
 * @property connectionString - The connection string to the Cosmos DB account.
 * @property database - The name of the database in the Cosmos DB account.
 * @property container - The name of the container/collection within the database.
 */
interface UriParams {
    resourceId?: string | undefined;
    subscriptionId?: string | undefined;
    resourceGroup?: string | undefined;
    connectionString?: string | undefined;
    database?: string | undefined;
    container?: string | undefined;
}

/**
 * Extracts and validates URI parameters from a query string.
 *
 * @param context - The action context used for telemetry tracking
 * @param query - The query string to extract parameters from
 * @returns The extracted URI parameters
 * @throws Error when neither resource ID nor connection string is provided
 *
 * @remarks
 * This function validates that either a resource ID or connection string is present in the query parameters.
 * It also tracks telemetry information about the URI type (resourceId/connectionString) and the presence
 * of database and container parameters.
 */
function extractAndValidateParams(context: IActionContext, query: string): UriParams {
    const params = extractParams(query);

    // Add sensitive values to valuesToMask to prevent sensitive data in logs
    Object.entries(params).forEach(([key, value]) => {
        switch (key) {
            case 'connectionString':
            case 'database':
            case 'container':
                if (value !== undefined) {
                    context.valuesToMask.push(value);
                }
                break;
        }
    });

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

    context.telemetry.properties.hasDatabase = params.database ? 'true' : 'false';
    context.telemetry.properties.hasContainer = params.container ? 'true' : 'false';

    return params;
}
