/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getThemeAgnosticIconURI } from '../../constants';
import { AuthenticationMethod } from '../../cosmosdb/AuthenticationMethod';
import { getControlPlane } from '../../cosmosdb/controlPlane';
import { getCosmosDBEntraIdCredential } from '../../cosmosdb/CosmosDBCredential';
import { getSignedInPrincipalIdForAccountEndpoint } from '../../cosmosdb/utils/azureSessionHelper';
import { ensureRbacPermissionV2, isRbacException, showRbacPermissionError } from '../../cosmosdb/utils/rbacUtils';
import { ext } from '../../extensionVariables';
import { CosmosDBAccountResourceItemBase } from '../azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { type TreeElement } from '../TreeElement';
import { getAccountInfo, type AccountInfo } from './AccountInfo';
import { type CosmosDBAccountModel } from './models/CosmosDBAccountModel';
import { type DatabaseResource } from './models/CosmosDBTypes';

export abstract class CosmosDBAccountResourceItem extends CosmosDBAccountResourceItemBase {
    declare public readonly account: CosmosDBAccountModel;

    // To prevent the RBAC notification from showing up multiple times
    protected hasShownRbacNotification: boolean = false;

    protected constructor(account: CosmosDBAccountModel, experience: Experience) {
        super(account, experience);
    }

    public async getChildren(): Promise<TreeElement[]> {
        const accountInfo = await getAccountInfo(this.account);
        const databases = await this.getDatabases(accountInfo);
        const sortedDatabases = databases.sort((a, b) => a.id.localeCompare(b.id));

        return this.getChildrenImpl(accountInfo, sortedDatabases);
    }

    public getTreeItem(): vscode.TreeItem {
        // oxlint-disable-next-line typescript/no-misused-spread
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

    protected async getDatabases(accountInfo: AccountInfo): Promise<DatabaseResource[]> | never {
        const controlPlane = getControlPlane(accountInfo);

        try {
            return await controlPlane.listDatabases();
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
                    return controlPlane.listDatabases();
                } else {
                    void showRbacPermissionError(this.id, principalId);
                    ext.outputChannel.error(e);
                    ext.outputChannel.show();
                }
            }
            throw e; // rethrowing tells the resources extension to show the exception message in the tree
        }
    }

    protected abstract getChildrenImpl(accountInfo: AccountInfo, databases: DatabaseResource[]): Promise<TreeElement[]>;
}
