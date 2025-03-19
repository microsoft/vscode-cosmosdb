/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RestError, type CosmosClient, type DatabaseDefinition, type Resource } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getThemeAgnosticIconPath } from '../../constants';
import { getCosmosAuthCredential, getCosmosClient } from '../../docdb/getCosmosClient';
import { getSignedInPrincipalIdForAccountEndpoint } from '../../docdb/utils/azureSessionHelper';
import { isRbacException, showRbacPermissionError } from '../../docdb/utils/rbacUtils';
import { rejectOnTimeout } from '../../utils/timeout';
import { CosmosDBAccountResourceItemBase } from '../CosmosDBAccountResourceItemBase';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type CosmosDBAttachedAccountModel } from '../workspace/CosmosDBAttachedAccountModel';
import { getAccountInfo, type AccountInfo } from './AccountInfo';

export abstract class DocumentDBAccountAttachedResourceItem extends CosmosDBAccountResourceItemBase {
    declare public readonly account: CosmosDBAttachedAccountModel;

    // To prevent the RBAC notification from showing up multiple times
    protected hasShownRbacNotification: boolean = false;

    protected constructor(account: CosmosDBAttachedAccountModel, experience: Experience) {
        super(account, experience);
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        const accountInfo = await getAccountInfo(this.account);
        const cosmosClient = getCosmosClient(accountInfo.endpoint, accountInfo.credentials, accountInfo.isEmulator);
        const databases = await this.getDatabases(accountInfo, cosmosClient);

        return this.getChildrenImpl(accountInfo, databases);
    }

    public getTreeItem(): vscode.TreeItem {
        let tooltipMessage: string | undefined = undefined;
        let description: string | undefined = undefined;

        if (this.account.isEmulator && this.account.connectionString.includes('http://')) {
            description = l10n.t('⚠ TLS/SSL Disabled');
            tooltipMessage = l10n.t('⚠️ **Security:** TLS/SSL Disabled');
        } else {
            tooltipMessage = l10n.t('✅ **Security:** TLS/SSL Enabled');
        }

        const treeItem = super.getTreeItem();
        if (treeItem.tooltip) {
            tooltipMessage = `${String(treeItem.tooltip)}\n${tooltipMessage}`;
        }

        return {
            ...treeItem,
            description: description,
            tooltip: new vscode.MarkdownString(tooltipMessage),
            iconPath: this.account.isEmulator
                ? new vscode.ThemeIcon('plug')
                : getThemeAgnosticIconPath('CosmosDBAccount.svg'),
        };
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
                    l10n.t(
                        "Unable to reach emulator. Please ensure it is started and connected to the port specified by the 'cosmosDB.emulator.port' setting, then try again.",
                    ),
                );
            } else {
                return await getResources();
            }
        } catch (e) {
            if (e instanceof Error) {
                if (isRbacException(e) && !this.hasShownRbacNotification) {
                    this.hasShownRbacNotification = true;
                    const tenantId = getCosmosAuthCredential(accountInfo.credentials)?.tenantId;
                    const principalId =
                        (await getSignedInPrincipalIdForAccountEndpoint(accountInfo.endpoint, tenantId)) ?? '';
                    void showRbacPermissionError(this.id, principalId);
                }
                if (this.account.isEmulator && e instanceof RestError && e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
                    const message = l10n.t(
                        "The Cosmos DB emulator is using a self-signed certificate. To connect to the emulator, you must import the emulator's TLS/SSL certificate.", // or disable the 'http.proxyStrictSSL' setting but we don't recommend this for security reasons.
                    );
                    const readMoreItem = l10n.t('Learn more');
                    void vscode.window.showErrorMessage(message, ...[readMoreItem]).then((item) => {
                        if (item === readMoreItem) {
                            void vscode.env.openExternal(
                                vscode.Uri.parse(
                                    'https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator?tabs=docker-linux%2Ccsharp&pivots=api-nosql#import-the-emulators-tlsssl-certificate',
                                ),
                            );
                        }
                    });
                }
            }
            throw e; // rethrowing tells the resources extension to show the exception message in the tree
        }
    }

    protected abstract getChildrenImpl(
        accountInfo: AccountInfo,
        databases: (DatabaseDefinition & Resource)[],
    ): Promise<CosmosDBTreeElement[]>;
}
