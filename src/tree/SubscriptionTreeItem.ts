/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { DatabaseAccountGetResults, DatabaseAccountListKeysResult } from '@azure/arm-cosmosdb/src/models';
import { ILocationWizardContext, LocationListStep, ResourceGroupListStep, SubscriptionTreeItemBase, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeItem, AzureWizard, AzureWizardPromptStep, IActionContext, ICreateChildImplContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { API, Experience, getExperienceLabel, tryGetExperience } from '../AzureDBExperiences';
import { DocDBAccountTreeItem } from "../docdb/tree/DocDBAccountTreeItem";
import { ext } from '../extensionVariables';
import { tryGetGremlinEndpointFromAzure } from '../graph/gremlinEndpoints';
import { GraphAccountTreeItem } from "../graph/tree/GraphAccountTreeItem";
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { PostgresAbstractServer, PostgresServerType } from '../postgres/abstract/models';
import { IPostgresServerWizardContext } from '../postgres/commands/createPostgresServer/IPostgresServerWizardContext';
import { createPostgresConnectionString, ParsedPostgresConnectionString, parsePostgresConnectionString } from '../postgres/postgresConnectionStrings';
import { PostgresServerTreeItem } from '../postgres/tree/PostgresServerTreeItem';
import { TableAccountTreeItem } from "../table/tree/TableAccountTreeItem";
import { createCosmosDBClient, createPostgreSQLClient, createPostgreSQLFlexibleClient } from '../utils/azureClients';
import { azureUtils } from '../utils/azureUtils';
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
        const postgresSingleClient = await createPostgreSQLClient([context, this]);
        const postgresFlexibleClient = await createPostgreSQLFlexibleClient([context, this]);
        const postgresServers: PostgresAbstractServer[] = [
            ...(await uiUtils.listAllIterator(postgresSingleClient.servers.list())).map(s => Object.assign(s, { serverType: PostgresServerType.Single })),
            ...(await uiUtils.listAllIterator(postgresFlexibleClient.servers.list())).map(s => Object.assign(s, { serverType: PostgresServerType.Flexible })),
        ];

        const treeItemPostgres: AzExtTreeItem[] = await this.createTreeItemsWithErrorHandling(
            postgresServers,
            'invalidPostgreSQLAccount',
            async (server: PostgresAbstractServer) => await this.initPostgresChild(server),
            (server: PostgresAbstractServer) => server.name
        );

        //CosmosDB
        const client = await createCosmosDBClient([context, this]);
        const accounts = await uiUtils.listAllIterator(client.databaseAccounts.list());
        const treeItem: AzExtTreeItem[] = await this.createTreeItemsWithErrorHandling(
            accounts,
            'invalidCosmosDBAccount',
            async (db: DatabaseAccountGetResults) => await this.initCosmosDBChild(client, db),
            (db: DatabaseAccountGetResults) => db.name
        );

        treeItem.push(...treeItemPostgres);
        return treeItem;
    }

    public async createChildImpl(context: ICreateChildImplContext & { defaultExperience?: Experience }): Promise<AzExtTreeItem> {
        const client = await createCosmosDBClient([context, this]);
        const wizardContext: IPostgresServerWizardContext & ICosmosDBWizardContext = Object.assign(context, this.subscription);

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
        context.showCreatingTreeItem(newServerName);
        await wizard.execute();
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
            return new PostgresServerTreeItem(this, parsedCS, server);
        } else {
            return await this.initCosmosDBChild(client, nonNullProp(wizardContext, 'databaseAccount'));
        }
    }

    public isAncestorOfImpl(contextValue: string | RegExp): boolean {
        return typeof contextValue !== 'string' || !/attached/i.test(contextValue);
    }

    private async initCosmosDBChild(client: CosmosDBManagementClient, databaseAccount: DatabaseAccountGetResults): Promise<AzExtTreeItem> {
        const experience = tryGetExperience(databaseAccount);
        const id: string = nonNullProp(databaseAccount, 'id');
        const name: string = nonNullProp(databaseAccount, 'name');
        const documentEndpoint: string = nonNullProp(databaseAccount, 'documentEndpoint');

        const resourceGroup: string = azureUtils.getResourceGroupFromId(id);
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
            return new MongoAccountTreeItem(this, id, label, connectionString.toString(), isEmulator, databaseAccount);
        } else {
            const keyResult: DatabaseAccountListKeysResult = await client.databaseAccounts.listKeys(resourceGroup, name);
            const primaryMasterKey: string = nonNullProp(keyResult, 'primaryMasterKey');
            switch (experience && experience.api) {
                case "Table":
                    return new TableAccountTreeItem(this, id, label, documentEndpoint, primaryMasterKey, isEmulator, databaseAccount);
                case "Graph": {
                    const gremlinEndpoint = await tryGetGremlinEndpointFromAzure(client, resourceGroup, name);
                    return new GraphAccountTreeItem(this, id, label, documentEndpoint, gremlinEndpoint, primaryMasterKey, isEmulator, databaseAccount);
                }
                case "Core":
                default:
                    // Default to DocumentDB, the base type for all Cosmos DB Accounts
                    return new DocDBAccountTreeItem(this, id, label, documentEndpoint, primaryMasterKey, isEmulator, databaseAccount);

            }
        }
    }
    private async initPostgresChild(server: PostgresAbstractServer): Promise<AzExtTreeItem> {
        const connectionString: string = createPostgresConnectionString(nonNullProp(server, 'fullyQualifiedDomainName'));
        const parsedCS: ParsedPostgresConnectionString = parsePostgresConnectionString(connectionString);
        return new PostgresServerTreeItem(this, parsedCS, server);
    }
}
