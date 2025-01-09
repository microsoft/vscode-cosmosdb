/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient, type DatabaseDefinition, type Resource } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getThemeAgnosticIconPath } from '../../constants';
import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { type CosmosDBCredential, type CosmosDBKeyCredential, getCosmosClient } from '../../docdb/getCosmosClient';
import { getSignedInPrincipalIdForAccountEndpoint } from '../../docdb/utils/azureSessionHelper';
import { isRbacException, showRbacPermissionError } from '../../docdb/utils/rbacUtils';
import { type CosmosDBAttachedAccountModel } from '../attached/CosmosDBAttachedAccountModel';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type AccountInfo } from './AccountInfo';

export abstract class DocumentDBAccountAttachedResourceItem implements CosmosDBTreeElement {
    public id: string;
    public contextValue: string = 'cosmosDB.workspace.item.account';

    // To prevent the RBAC notification from showing up multiple times
    protected hasShownRbacNotification: boolean = false;

    protected constructor(
        protected account: CosmosDBAttachedAccountModel,
        protected experience: Experience,
    ) {
        this.contextValue = `${experience.api}.workspace.item.account`;
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        const result = await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.experience = this.experience.api;
            context.telemetry.properties.parentContext = this.contextValue;

            const accountInfo = await this.getAccountInfo(this.account);
            const cosmosClient = getCosmosClient(accountInfo.endpoint, accountInfo.credentials, false);
            const databases = await this.getDatabases(accountInfo, cosmosClient);
            return await this.getChildrenImpl(accountInfo, databases);
        });

        return result ?? [];
    }

    public getTreeItem(): TreeItem {
        // This function is a bit easier than the ancestor's getTreeItem function
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: getThemeAgnosticIconPath('CosmosDBAccount.svg'),
            label: this.account.name,
            description: `(${this.experience.shortName})`,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    protected async getAccountInfo(account: CosmosDBAttachedAccountModel): Promise<AccountInfo> | never {
        const id = account.id;
        const name = account.name;
        const isEmulator = account.isEmulator;
        const parsedCS = parseDocDBConnectionString(account.connectionString);
        const documentEndpoint = parsedCS.documentEndpoint;
        const credentials = await this.getCredentials(account.connectionString);

        return {
            credentials,
            endpoint: documentEndpoint,
            id,
            isEmulator,
            name,
        };
    }

    protected async getDatabases(
        accountInfo: AccountInfo,
        cosmosClient: CosmosClient,
    ): Promise<(DatabaseDefinition & Resource)[]> | never {
        const getResources = async () => {
            const result = await cosmosClient.databases.readAll().fetchAll();
            return result.resources;
        };

        try {
            // Await is required here to ensure that the error is caught in the catch block
            return await getResources();
        } catch (e) {
            if (e instanceof Error && isRbacException(e) && !this.hasShownRbacNotification) {
                this.hasShownRbacNotification = true;

                const principalId = (await getSignedInPrincipalIdForAccountEndpoint(accountInfo.endpoint)) ?? '';
                void showRbacPermissionError(this.id, principalId);
            }
            throw e; // rethrowing tells the resources extension to show the exception message in the tree
        }
    }

    protected async getCredentials(connectionString: string): Promise<CosmosDBCredential[]> {
        const result = await callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
            context.telemetry.properties.experience = this.experience.api;
            context.telemetry.properties.parentContext = this.contextValue;

            const forceOAuth = vscode.workspace.getConfiguration().get<boolean>('azureDatabases.useCosmosOAuth');
            context.telemetry.properties.useCosmosOAuth = (forceOAuth ?? false).toString();

            let keyCred: CosmosDBKeyCredential | undefined = undefined;
            // disable key auth if the user has opted in to OAuth (AAD/Entra ID)
            if (!forceOAuth) {
                const parsedCS = parseDocDBConnectionString(connectionString);
                keyCred = {
                    type: 'key',
                    key: parsedCS.masterKey,
                };
            }

            // OAuth is always enabled for Cosmos DB and will be used as a fallback if key auth is unavailable
            const authCred = { type: 'auth' };
            return [keyCred, authCred].filter((cred): cred is CosmosDBCredential => cred !== undefined);
        });

        return result ?? [];
    }

    protected abstract getChildrenImpl(
        accountInfo: AccountInfo,
        databases: (DatabaseDefinition & Resource)[],
    ): Promise<CosmosDBTreeElement[]>;
}
