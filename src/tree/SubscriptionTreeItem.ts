/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import { DatabaseAccount, DatabaseAccountListKeysResult, DatabaseAccountsListResult } from 'azure-arm-cosmosdb/lib/models';
import { PostgreSQLManagementClient } from 'azure-arm-postgresql';
import { Server, ServerListResult } from 'azure-arm-postgresql/lib/models';
import * as publicIp from 'public-ip';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureTreeItem, AzureWizard, AzureWizardPromptStep, createAzureClient, ICreateChildImplContext, ILocationWizardContext, LocationListStep, ResourceGroupListStep, SubscriptionTreeItemBase } from 'vscode-azureextensionui';
import { getExperienceLabel, tryGetExperience } from '../CosmosDBExperiences';
import { DocDBAccountTreeItem } from "../docdb/tree/DocDBAccountTreeItem";
import { tryGetGremlinEndpointFromAzure } from '../graph/gremlinEndpoints';
import { GraphAccountTreeItem } from "../graph/tree/GraphAccountTreeItem";
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { setFirewallRule } from '../postgres/commands/configurePostgresFirewall';
import { IPostgresWizardContext } from '../postgres/commands/PostgresAccountWizard/IPostgresWizardContext';
import { PostgresServerCreateStep } from '../postgres/commands/PostgresAccountWizard/PostgresServerCreateStep';
import { PostgresServerCredStepPW } from '../postgres/commands/PostgresAccountWizard/PostgresServerCredStepPW';
import { PostgresServerCredStepUser } from '../postgres/commands/PostgresAccountWizard/PostgresServerCredStepUser';
import { PostgresServerFirewallStep } from '../postgres/commands/PostgresAccountWizard/PostgresServerFirewallStep';
import { PostgresServerNameStep } from '../postgres/commands/PostgresAccountWizard/PostgresServerNameStep';
import { PostgresServerTreeItem } from '../postgres/tree/PostgresServerTreeItem';
import { TableAccountTreeItem } from "../table/tree/TableAccountTreeItem";
import { azureUtils } from '../utils/azureUtils';
import { nonNullProp } from '../utils/nonNull';
import { CosmosDBAccountApiStep } from './CosmosDBAccountWizard/CosmosDBAccountApiStep';
import { CosmosDBAccountCreateStep } from './CosmosDBAccountWizard/CosmosDBAccountCreateStep';
import { CosmosDBAccountNameStep } from './CosmosDBAccountWizard/CosmosDBAccountNameStep';
import { ICosmosDBWizardContext } from './CosmosDBAccountWizard/ICosmosDBWizardContext';
import { DatabaseAccountOptionsStep } from './DatabaseAccountOptionsStep';
import { IDBAWizardContext } from './IDBAWizardContext';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public childTypeLabel: string = 'Account';

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {

        let treeItemPostgres: AzExtTreeItem[];
        let treeItem: AzExtTreeItem[];

        //Postgres
        const postgresClient: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
        const postgresServers: ServerListResult = await postgresClient.servers.list();
        treeItemPostgres = await this.createTreeItemsWithErrorHandling(
            postgresServers,
            'invalidPostgreSQLAccount',
            async (server: Server) => new PostgresServerTreeItem(this, server),
            (server: Server) => server.name
        );

        //CosmosDB
        const client: CosmosDBManagementClient = createAzureClient(this.root, CosmosDBManagementClient);
        const accounts: DatabaseAccountsListResult = await client.databaseAccounts.list();
        treeItem = await this.createTreeItemsWithErrorHandling(
            accounts,
            'invalidCosmosDBAccount',
            async (db: DatabaseAccount) => await this.initCosmosDBChild(client, db),
            (db: DatabaseAccount) => db.name
        );

        treeItem.push(...treeItemPostgres);
        return treeItem;
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<AzureTreeItem> {
        const wizardContextInitial: IDBAWizardContext = Object.assign(context, this.root);

        const promptSteps: AzureWizardPromptStep<ILocationWizardContext>[] = [
            new DatabaseAccountOptionsStep()
        ];
        const wizardInitial = new AzureWizard(wizardContextInitial, {
            promptSteps
        });
        await wizardInitial.prompt();

        if (wizardContextInitial.accountType === "cosmosdb") {
            const client: CosmosDBManagementClient = createAzureClient(this.root, CosmosDBManagementClient);
            const wizardContext: ICosmosDBWizardContext = Object.assign(context, this.root);

            promptSteps.push(
                new CosmosDBAccountNameStep(),
                new CosmosDBAccountApiStep(),
                new ResourceGroupListStep()
            );
            LocationListStep.addStep(wizardContext, promptSteps);

            const wizard = new AzureWizard(wizardContext, {
                promptSteps,
                executeSteps: [
                    new CosmosDBAccountCreateStep()
                ],
                title: 'Create new Cosmos DB account'
            });

            await wizard.prompt();

            wizardContext.telemetry.properties.defaultExperience = wizardContext.defaultExperience?.api;

            const accountName: string = nonNullProp(wizardContext, 'accountName');
            context.showCreatingTreeItem(accountName);
            await wizard.execute();
            // don't wait
            vscode.window.showInformationMessage(`Successfully created account "${accountName}".`);
            return await this.initCosmosDBChild(client, nonNullProp(wizardContext, 'databaseAccount'));
        } else {
            const wizardContext: IPostgresWizardContext = Object.assign(context, this.root);
            promptSteps.push(
                new PostgresServerNameStep(),
                new ResourceGroupListStep(),
                new PostgresServerCredStepUser(),
                new PostgresServerCredStepPW(),
                new PostgresServerFirewallStep()
            );
            LocationListStep.addStep(wizardContext, promptSteps);
            const wizard = new AzureWizard(wizardContext, {
                promptSteps,
                executeSteps: [
                    new PostgresServerCreateStep()
                ],
                title: 'Create new PostgreSQL account'
            });
            await wizard.prompt();
            const serverName: string = nonNullProp(wizardContext, 'newServerName');
            context.showCreatingTreeItem(serverName);
            await wizard.execute();

            vscode.window.showInformationMessage(`Successfully created server "${wizardContext.newServerName}".`);
            const serverTree: PostgresServerTreeItem = new PostgresServerTreeItem(this, nonNullProp(wizardContext, 'server'));
            let user: string = nonNullProp(wizardContext, 'adminUser');
            const usernameSuffix: string = `@${serverName}`;
            if (!user.includes(usernameSuffix)) {
                user += usernameSuffix;
            }
            const password: string = nonNullProp(wizardContext, 'adminPassword');
            void serverTree.setCredentials(user, password);
            if (wizardContext.firewall) {
                const ip: string = await publicIp.v4();
                void setFirewallRule(serverTree, ip);
            }
            return serverTree;
        }
    }

    public isAncestorOfImpl(contextValue: string | RegExp): boolean {
        return typeof contextValue !== 'string' || !/attached/i.test(contextValue);
    }

    private async initCosmosDBChild(client: CosmosDBManagementClient, databaseAccount: DatabaseAccount): Promise<AzureTreeItem> {
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
            const connectionString = nonNullProp(nonNullProp(result, 'connectionStrings')[0], 'connectionString');
            // Use the default connection string
            return new MongoAccountTreeItem(this, id, label, connectionString, isEmulator, databaseAccount);
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
}
