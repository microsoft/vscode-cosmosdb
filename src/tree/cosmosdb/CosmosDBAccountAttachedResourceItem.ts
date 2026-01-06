/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RestError, type CosmosClient } from '@azure/cosmos';
import { createGenericElement } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getThemeAgnosticIconPath } from '../../constants';
import { getCosmosDBEntraIdCredential } from '../../cosmosdb/CosmosDBCredential';
import { getSignedInPrincipalIdForAccountEndpoint } from '../../cosmosdb/utils/azureSessionHelper';
import { isRbacException, showRbacPermissionError } from '../../cosmosdb/utils/rbacUtils';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../extensionVariables';
import { rejectOnTimeout } from '../../utils/timeout';
import { CosmosDBAccountResourceItemBase } from '../azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithStorageId } from '../TreeElementWithStorageId';
import { type CosmosDBAttachedAccountModel } from '../workspace-view/cosmosdb/CosmosDBAttachedAccountModel';
import { getAccountInfo, type AccountInfo } from './AccountInfo';
import { type DatabaseResource } from './models/CosmosDBTypes';

export abstract class CosmosDBAccountAttachedResourceItem
    extends CosmosDBAccountResourceItemBase
    implements TreeElementWithStorageId
{
    declare public readonly account: CosmosDBAttachedAccountModel;

    public get storageId(): string {
        return this.account.storageId;
    }

    // To prevent the RBAC notification from showing up multiple times
    protected hasShownRbacNotification: boolean = false;

    protected constructor(account: CosmosDBAttachedAccountModel, experience: Experience) {
        super(account, experience);
    }

    public async getChildren(): Promise<TreeElement[]> {
        const accountInfo = await getAccountInfo(this.account);
        const databases = await withClaimsChallengeHandling(accountInfo, async (cosmosClient) =>
            this.getDatabases(accountInfo, cosmosClient),
        );

        if (databases.length === 0) {
            // no databases in there:
            return [
                createGenericElement({
                    contextValue: this.contextValue,
                    id: `${this.id}/no-databases`,
                    label: l10n.t('Create Database…'),
                    iconPath: new vscode.ThemeIcon('plus'),
                    commandId: 'cosmosDB.createDatabase',
                    commandArgs: [this],
                }) as TreeElement,
            ];
        }

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
    ): Promise<DatabaseResource[]> | never {
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
                    const tenantId = getCosmosDBEntraIdCredential(accountInfo.credentials)?.tenantId;
                    const principalId = await getSignedInPrincipalIdForAccountEndpoint(accountInfo.endpoint, tenantId);
                    void showRbacPermissionError(this.id, principalId);
                    if (!principalId || !e.message.includes(principalId)) {
                        // In case we're not signed in with the principal that's missing permissions, log the full error
                        ext.outputChannel.error(e);
                        ext.outputChannel.show();
                    }
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

    protected abstract getChildrenImpl(accountInfo: AccountInfo, databases: DatabaseResource[]): Promise<TreeElement[]>;
}
