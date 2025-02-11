/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient, type DatabaseDefinition, type Resource } from '@azure/cosmos';
import { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getThemeAgnosticIconPath } from '../../constants';
import { getCosmosAuthCredential, getCosmosClient } from '../../docdb/getCosmosClient';
import { getSignedInPrincipalIdForAccountEndpoint } from '../../docdb/utils/azureSessionHelper';
import { isRbacException, showRbacPermissionError } from '../../docdb/utils/rbacUtils';
import { rejectOnTimeout } from '../../utils/timeout';
import { type CosmosDBAttachedAccountModel } from '../attached/CosmosDBAttachedAccountModel';
import { CosmosDBAccountResourceItemBase } from '../CosmosDBAccountResourceItemBase';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type AccountInfo, getAccountInfo } from './AccountInfo';

export abstract class DocumentDBAccountAttachedResourceItem extends CosmosDBAccountResourceItemBase {
    public declare readonly account: CosmosDBAttachedAccountModel;

    // To prevent the RBAC notification from showing up multiple times
    protected hasShownRbacNotification: boolean = false;

    protected constructor(account: CosmosDBAttachedAccountModel, experience: Experience) {
        super(account, experience);
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        const accountInfo = await getAccountInfo(this.account);
        const cosmosClient = getCosmosClient(accountInfo.endpoint, accountInfo.credentials, false);
        const databases = await this.getDatabases(accountInfo, cosmosClient);

        return this.getChildrenImpl(accountInfo, databases);
    }

    public getTreeItem(): TreeItem {
        return { ...super.getTreeItem(), iconPath: getThemeAgnosticIconPath('CosmosDBAccount.svg') };
    }

    public getConnectionString(): Promise<string> {
        return Promise.resolve(this.account.connectionString);
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
            if (this.account.isEmulator) {
                return await rejectOnTimeout(
                    2000,
                    () => getResources(),
                    "Unable to reach emulator. Please ensure it is started and connected to the port specified by the 'cosmosDB.emulator.port' setting, then try again.",
                );
            } else {
                return await getResources();
            }
        } catch (e) {
            if (e instanceof Error && isRbacException(e) && !this.hasShownRbacNotification) {
                this.hasShownRbacNotification = true;
                const tenantId = getCosmosAuthCredential(accountInfo.credentials)?.tenantId;
                const principalId =
                    (await getSignedInPrincipalIdForAccountEndpoint(accountInfo.endpoint, tenantId)) ?? '';
                void showRbacPermissionError(this.id, principalId);
            }
            throw e; // rethrowing tells the resources extension to show the exception message in the tree
        }
    }

    protected abstract getChildrenImpl(
        accountInfo: AccountInfo,
        databases: (DatabaseDefinition & Resource)[],
    ): Promise<CosmosDBTreeElement[]>;
}
