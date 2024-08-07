/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { DatabaseAccountGetResults, DatabaseAccountListKeysResult } from '@azure/arm-cosmosdb/src/models';
import { ILocationWizardContext, LocationListStep, ResourceGroupListStep, SubscriptionTreeItemBase, getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, AzureWizard, AzureWizardPromptStep, IActionContext, callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { API, Experience, getExperienceLabel, tryGetExperience } from '../AzureDBExperiences';
import { CosmosDBCredential, CosmosDBKeyCredential } from '../docdb/getCosmosClient';
import { DocDBAccountTreeItem } from "../docdb/tree/DocDBAccountTreeItem";
import { ext } from '../extensionVariables';
import { tryGetGremlinEndpointFromAzure } from '../graph/gremlinEndpoints';
import { GraphAccountTreeItem } from "../graph/tree/GraphAccountTreeItem";
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { PostgresAbstractServer, PostgresServerType } from '../postgres/abstract/models';
import { IPostgresServerWizardContext } from '../postgres/commands/createPostgresServer/IPostgresServerWizardContext';
import { ParsedPostgresConnectionString, createPostgresConnectionString, parsePostgresConnectionString } from '../postgres/postgresConnectionStrings';
import { PostgresServerTreeItem } from '../postgres/tree/PostgresServerTreeItem';
import { TableAccountTreeItem } from "../table/tree/TableAccountTreeItem";
import { createActivityContext } from '../utils/activityUtils';
import { createCosmosDBClient, createPostgreSQLClient, createPostgreSQLFlexibleClient } from '../utils/azureClients';
import { localize } from '../utils/localize';
import { nonNullProp } from '../utils/nonNull';
import { AzureDBAPIStep } from './AzureDBAPIStep';
import { ICosmosDBWizardContext } from './CosmosDBAccountWizard/ICosmosDBWizardContext';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public childTypeLabel: string = 'Account';

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {

        //Postgres
        const postgresSingleClient = await createPostgreSQLClient([context, this.subscription]);
        const postgresFlexibleClient = await createPostgreSQLFlexibleClient([context, this.subscription]);
        const postgresServers: PostgresAbstractServer[] = [
            ...(await uiUtils.listAllIterator(postgresSingleClient.servers.list())).map(s => Object.assign(s, { serverType: PostgresServerType.Single })),
            ...(await uiUtils.listAllIterator(postgresFlexibleClient.servers.list())).map(s => Object.assign(s, { serverType: PostgresServerType.Flexible })),
        ];

        const treeItemPostgres: AzExtTreeItem[] = await this.createTreeItemsWithErrorHandling(
            postgresServers,
            'invalidPostgreSQLAccount',
            async (server: PostgresAbstractServer) => await SubscriptionTreeItem.initPostgresChild(server, this),
            (server: PostgresAbstractServer) => server.name
        );

        //CosmosDB
        const client = await createCosmosDBClient([context, this]);
        const accounts = await uiUtils.listAllIterator(client.databaseAccounts.list());
        const treeItem: AzExtTreeItem[] = await this.createTreeItemsWithErrorHandling(
            accounts,
            'invalidCosmosDBAccount',
            async (db: DatabaseAccountGetResults) => await SubscriptionTreeItem.initCosmosDBChild(client, db, this),
            (db: DatabaseAccountGetResults) => db.name
        );

        treeItem.push(...treeItemPostgres);
        return treeItem;
    }

    public static async createChild(context: IActionContext & { defaultExperience?: Experience }, node: SubscriptionTreeItem): Promise<AzExtTreeItem> {
        const client = await createCosmosDBClient([context, node.subscription]);
        const wizardContext: IPostgresServerWizardContext & ICosmosDBWizardContext = Object.assign(context, node.subscription, { ...(await createActivityContext()) });

        const promptSteps: AzureWizardPromptStep<ILocationWizardContext>[] = [
            new AzureDBAPIStep(),
            new ResourceGroupListStep()
        ];
        LocationListStep.addStep(wizardContext, promptSteps);

        const wizard = new AzureWizard(wizardContext, {
            promptSteps,
            executeSteps: [],
            title: localize('createDBServerMsg', 'Create new Azure Database Server')
        });

        await wizard.prompt();

        wizardContext.telemetry.properties.defaultExperience = wizardContext.defaultExperience?.api;

        const newServerName: string = nonNullProp(wizardContext, 'newServerName');
        wizardContext.activityTitle = localize('createDBServerMsgActivityTitle', 'Create new Azure Database Server "{0}"', newServerName);

        await wizard.execute();
        await ext.rgApi.appResourceTree.refresh(context);
        if (wizardContext.defaultExperience?.api === API.PostgresSingle || wizardContext.defaultExperience?.api === API.PostgresFlexible) {
            const createMessage: string = localize('createdServerOutput', 'Successfully created PostgreSQL server "{0}".', wizardContext.newServerName);
            void vscode.window.showInformationMessage(createMessage);
            ext.outputChannel.appendLog(createMessage);
            const server = nonNullProp(wizardContext, 'server');
            const host = nonNullProp(server, 'fullyQualifiedDomainName');
            const username: string = wizardContext.serverType === PostgresServerType.Flexible ? nonNullProp(wizardContext, 'shortUserName') : nonNullProp(wizardContext, 'longUserName');
            const password: string = nonNullProp(wizardContext, 'adminPassword');
            const connectionString: string = createPostgresConnectionString(host, undefined, username, password);
            const parsedCS: ParsedPostgresConnectionString = parsePostgresConnectionString(connectionString);
            return new PostgresServerTreeItem(node, parsedCS, server);
        } else {
            return await SubscriptionTreeItem.initCosmosDBChild(client, nonNullProp(wizardContext, 'databaseAccount'), node);
        }
    }

    public isAncestorOfImpl(contextValue: string | RegExp): boolean {
        return typeof contextValue !== 'string' || !/attached/i.test(contextValue);
    }

    public static async initCosmosDBChild(client: CosmosDBManagementClient, databaseAccount: DatabaseAccountGetResults, parent: AzExtParentTreeItem): Promise<AzExtTreeItem> {
        const experience = tryGetExperience(databaseAccount);
        const id: string = nonNullProp(databaseAccount, 'id');
        const name: string = nonNullProp(databaseAccount, 'name');
        const documentEndpoint: string = nonNullProp(databaseAccount, 'documentEndpoint');

        const resourceGroup: string = getResourceGroupFromId(id);
        const accountKindLabel = getExperienceLabel(databaseAccount);
        const label: string = name + (accountKindLabel ? ` (${accountKindLabel})` : ``);
        const isEmulator: boolean = false;

        if (experience && experience.api === "MongoDB") {
            const result = await client.databaseAccounts.listConnectionStrings(resourceGroup, name);
            const connectionString: URL = new URL(nonNullProp(nonNullProp(result, 'connectionStrings')[0], 'connectionString'));
            // for any Mongo connectionString, append this query param because the Cosmos Mongo API v3.6 doesn't support retrywrites
            // but the newer node.js drivers started breaking this
            const searchParam: string = 'retrywrites';
            if (!connectionString.searchParams.has(searchParam)) {
                connectionString.searchParams.set(searchParam, 'false');
            }

            // Use the default connection string
            return new MongoAccountTreeItem(parent, id, label, connectionString.toString(), isEmulator, databaseAccount);
        } else {
            let keyCred: CosmosDBKeyCredential | undefined = undefined;

            const forceOAuth = vscode.workspace.getConfiguration().get<boolean>("azureDatabases.useCosmosOAuth");
            // disable key auth if the user has opted in to OAuth (AAD/Entra ID)
            if (!forceOAuth) {
                let keyResult: DatabaseAccountListKeysResult | undefined;
                await callWithTelemetryAndErrorHandling('cosmosDB.listAccountKeys', async (context: IActionContext) => {
                    try {
                        context.errorHandling.suppressDisplay = true;
                        const acc = await client.databaseAccounts.get(resourceGroup, name);
                        const localAuthDisabled = acc.disableLocalAuth === true;
                        context.telemetry.properties.localAuthDisabled = localAuthDisabled.toString();
                        // If the account has local auth disabled, don't even try to use key auth
                        if (!localAuthDisabled) {
                            keyResult = await client.databaseAccounts.listKeys(resourceGroup, name);
                            keyCred = keyResult?.primaryMasterKey ? {
                                type: "key",
                                key: keyResult.primaryMasterKey
                            } : undefined;
                        } else {
                            throw new Error("Local auth is disabled");
                        }
                    } catch (error) {
                        const message = localize("keyPermissionErrorMsg", "You do not have the required permissions to list auth keys for [{0}].\nFalling back to using Entra ID.\nYou can change the default authentication in the settings.", name);
                        const openSettingsItem = localize("openSettings", "Open Settings");
                        void vscode.window.showWarningMessage(message, ...[openSettingsItem]).then((item) => {
                            if (item === openSettingsItem) {
                                void vscode.commands.executeCommand('workbench.action.openSettings', 'azureDatabases.useCosmosOAuth');
                            }
                        });
                        throw error; // rethrow to log the failure
                    }
                });
            }

            // OAuth is always enabled for Cosmos DB and will be used as a fall back if key auth is unavailable
            const authCred = { type: "auth" };
            const credentials = [keyCred, authCred].filter((cred): cred is CosmosDBCredential => cred !== undefined);
            switch (experience && experience.api) {
                case "Table":
                    return new TableAccountTreeItem(parent, id, label, documentEndpoint, credentials, isEmulator, databaseAccount);
                case "Graph": {
                    const gremlinEndpoint = await tryGetGremlinEndpointFromAzure(client, resourceGroup, name);
                    return new GraphAccountTreeItem(parent, id, label, documentEndpoint, gremlinEndpoint, credentials, isEmulator, databaseAccount);
                }
                case "Core":
                default:
                    // Default to DocumentDB, the base type for all Cosmos DB Accounts
                    return new DocDBAccountTreeItem(parent, id, label, documentEndpoint, credentials, isEmulator, databaseAccount);

            }
        }
    }
    public static async initPostgresChild(server: PostgresAbstractServer, parent: AzExtParentTreeItem): Promise<AzExtTreeItem> {
        const connectionString: string = createPostgresConnectionString(nonNullProp(server, 'fullyQualifiedDomainName'));
        const parsedCS: ParsedPostgresConnectionString = parsePostgresConnectionString(connectionString);
        return new PostgresServerTreeItem(parent, parsedCS, server);
    }
}
