/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient, type DatabaseDefinition, type Resource } from '@azure/cosmos';
import type * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getThemeAgnosticIconURI } from '../../constants';
import { AuthenticationMethod, getCosmosClient, getCosmosDBEntraIdCredential } from '../../cosmosdb/getCosmosClient';
import { getSignedInPrincipalIdForAccountEndpoint } from '../../cosmosdb/utils/azureSessionHelper';
import { ensureRbacPermissionV2, isRbacException, showRbacPermissionError } from '../../cosmosdb/utils/rbacUtils';
import { ext } from '../../extensionVariables';
import { CosmosDBAccountResourceItemBase } from '../azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { type TreeElement } from '../TreeElement';
import { getAccountInfo, type AccountInfo } from './AccountInfo';
import { type CosmosDBAccountModel } from './models/CosmosDBAccountModel';

export abstract class CosmosDBAccountResourceItem extends CosmosDBAccountResourceItemBase {
    declare public readonly account: CosmosDBAccountModel;

    // To prevent the RBAC notification from showing up multiple times
    protected hasShownRbacNotification: boolean = false;

    protected constructor(account: CosmosDBAccountModel, experience: Experience) {
        super(account, experience);
    }

    public async getChildren(): Promise<TreeElement[]> {
        const accountInfo = await getAccountInfo(this.account);
        const cosmosClient = getCosmosClient(accountInfo.endpoint, accountInfo.credentials, false);
        const databases = await this.getDatabases(accountInfo, cosmosClient);
        const sortedDatabases = databases.sort((a, b) => a.id.localeCompare(b.id));

        return this.getChildrenImpl(accountInfo, sortedDatabases);
    }

    public getTreeItem(): vscode.TreeItem {
        return { ...super.getTreeItem(), iconPath: getThemeAgnosticIconURI('CosmosDBAccount.svg') };
    }

    public async getConnectionString(): Promise<string | undefined> {
        const accountInfo = await getAccountInfo(this.account);
        const keyCred = accountInfo.credentials.find((cred) => cred.type === AuthenticationMethod.accountKey);

        // supporting only one known success path
        if (keyCred) {
            return `AccountEndpoint=${accountInfo.endpoint};AccountKey=${keyCred.key}`;
        } else {
            return `AccountEndpoint=${accountInfo.endpoint}`;
        }
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

                const tenantId = getCosmosDBEntraIdCredential(accountInfo.credentials)?.tenantId;
                const principalId = await getSignedInPrincipalIdForAccountEndpoint(accountInfo.endpoint, tenantId);
                // check if the principal ID matches the one that is signed in,
                // otherwise this might be a security problem, hence show the error message
                if (
                    principalId &&
                    e.message.includes(`[${principalId}]`) &&
                    (await ensureRbacPermissionV2(this.id, this.account.subscription, principalId))
                ) {
                    return getResources();
                } else {
                    void showRbacPermissionError(this.id, principalId);
                    ext.outputChannel.error(e);
                    ext.outputChannel.show();
                }
            }
            throw e; // rethrowing tells the resources extension to show the exception message in the tree
        }
    }

    protected abstract getChildrenImpl(
        accountInfo: AccountInfo,
        databases: (DatabaseDefinition & Resource)[],
    ): Promise<TreeElement[]>;
}
