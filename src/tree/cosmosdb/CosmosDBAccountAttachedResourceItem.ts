/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient } from '@azure/cosmos';
import { createGenericElement } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBTimeouts, getThemeAgnosticIconURI } from '../../constants';
import { getCosmosDBEntraIdCredential } from '../../cosmosdb/CosmosDBCredential';
import { getSignedInPrincipalIdForAccountEndpoint } from '../../cosmosdb/utils/azureSessionHelper';
import { isRbacException, showRbacPermissionError } from '../../cosmosdb/utils/rbacUtils';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../extensionVariables';
import { compareResourceIds } from '../../utils/strings';
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

        const sortedDatabases = databases.sort((a, b) => compareResourceIds(a.id, b.id));

        return this.getChildrenImpl(accountInfo, sortedDatabases);
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
            const existingTooltip =
                typeof treeItem.tooltip === 'string'
                    ? treeItem.tooltip
                    : treeItem.tooltip instanceof vscode.MarkdownString
                      ? treeItem.tooltip.value
                      : '';
            if (existingTooltip) {
                tooltipMessage = `${existingTooltip}\n${tooltipMessage}`;
            }
        }

        return {
            // oxlint-disable-next-line typescript/no-misused-spread
            ...treeItem,
            description: description,
            tooltip: new vscode.MarkdownString(tooltipMessage),
            iconPath: this.account.isEmulator
                ? new vscode.ThemeIcon('plug')
                : getThemeAgnosticIconURI('CosmosDBAccount.svg'),
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
            // Apply timeout to prevent hanging indefinitely on unreachable hosts
            if (this.account.isEmulator) {
                return await rejectOnTimeout(
                    CosmosDBTimeouts.EMULATOR_CONNECTION_TIMEOUT_MS,
                    () => getResources(),
                    l10n.t(
                        "Unable to reach emulator. Please ensure it is started and connected to the port specified by the 'cosmosDB.emulator.port' setting, then try again.",
                    ),
                );
            } else {
                return await rejectOnTimeout(
                    CosmosDBTimeouts.CONNECTION_TIMEOUT_MS,
                    () => getResources(),
                    l10n.t('Connection timed out. Please verify the connection string and that the host is reachable.'),
                );
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
            }
            throw e; // rethrowing tells the resources extension to show the exception message in the tree
        }
    }

    protected abstract getChildrenImpl(accountInfo: AccountInfo, databases: DatabaseResource[]): Promise<TreeElement[]>;
}
