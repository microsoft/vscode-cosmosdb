/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { isUserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, DBAccountKind, tryGetExperience } from '../../../AzureDBExperiences';
import { cosmosDBCreateContainer } from '../../../commands/createContainer/createContainer';
import { cosmosDBCreateDatabase } from '../../../commands/createDatabase/createDatabase';
import { cosmosDBDeleteDatabaseAccount } from '../../../commands/deleteDatabaseAccount/deleteDatabaseAccount';
import { type AzureResourceMetadata } from '../../../cosmosdb/AzureResourceMetadata';
import { maskConnectionTelemetry } from '../../../cosmosdb/maskConnectionTelemetry';
import { ext } from '../../../extensionVariables';
import { CosmosDBAccountResourceItem } from '../../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { CosmosDBDatabaseResourceItem } from '../../../tree/cosmosdb/CosmosDBDatabaseResourceItem';
import { type AccountActionInput, type AccountActionResult } from '../accountActions';
import { getAccountOverviewMaskedValues, getResourceMaskedValues } from '../resourceMasking';
import { openAccountJson } from './accountJson';

export async function runAccountAction(
    context: IActionContext,
    metadata: AzureResourceMetadata,
    input: AccountActionInput,
): Promise<AccountActionResult> {
    context.errorHandling.suppressDisplay = true;
    context.valuesToMask.push(
        ...getAccountOverviewMaskedValues(metadata),
        ...getResourceMaskedValues([input.action === 'createContainer' ? input.databaseId : undefined]),
    );

    try {
        if (input.action === 'openCosts') {
            const opened = await vscode.env.openExternal(
                vscode.Uri.parse(
                    buildAccountCostsUrl(
                        metadata.subscription.environment.portalUrl,
                        metadata.subscription.tenantId,
                        metadata.accountId,
                    ),
                ),
            );
            if (!opened) {
                throw new Error(l10n.t('Unable to open account costs in the Azure portal.'));
            }
        } else if (input.action === 'openJson') {
            await openAccountJson(context, metadata);
        } else {
            const isCreate = input.action === 'createDatabase' || input.action === 'createContainer';
            if (
                isCreate &&
                (metadata.databaseAccount.kind !== DBAccountKind.GlobalDocumentDB ||
                    tryGetExperience(metadata.databaseAccount as DatabaseAccountGetResults)?.api !== API.Core)
            ) {
                throw new Error(l10n.t('Creating databases and containers is only supported for NoSQL accounts.'));
            }

            const account = await ext.cosmosDBBranchDataProvider.findNodeById(metadata.accountId);
            if (
                !(account instanceof CosmosDBAccountResourceItem) ||
                account.id.toLowerCase() !== metadata.accountId.toLowerCase() ||
                account.account.id.toLowerCase() !== metadata.accountId.toLowerCase()
            ) {
                throw new Error(l10n.t('Unable to resolve this account in the Azure Resources view.'));
            }
            if (isCreate && account.experience.api !== API.Core) {
                throw new Error(l10n.t('Creating databases and containers is only supported for NoSQL accounts.'));
            }

            // Registered command wrappers swallow cancellation and may swallow failures. Invoke their handlers
            // with the RPC action context and a verified node so no handler can fall back to an unscoped picker.
            if (input.action === 'createDatabase') {
                await cosmosDBCreateDatabase(context, account);
            } else if (input.action === 'createContainer') {
                const children = await account.getChildren();
                const databases = children.filter(
                    (node): node is CosmosDBDatabaseResourceItem =>
                        node instanceof CosmosDBDatabaseResourceItem &&
                        node.id === `${account.id}/${node.model.database.id}` &&
                        node.model.accountInfo.id.toLowerCase() === metadata.accountId.toLowerCase() &&
                        node.experience.api === API.Core,
                );
                let database: CosmosDBDatabaseResourceItem | undefined;
                if (input.databaseId !== undefined) {
                    database = databases.find((node) => node.model.database.id === input.databaseId);
                } else {
                    if (databases.length === 0) {
                        throw new Error(
                            l10n.t('This account has no databases. Create a database before adding a container.'),
                        );
                    }
                    context.valuesToMask.push(
                        ...getResourceMaskedValues(databases.map((node) => node.model.database.id)),
                    );
                    database = (
                        await context.ui.showQuickPick(
                            databases.map((node) => ({ label: node.model.database.id, data: node })),
                            { placeHolder: l10n.t('Select a database for the new container') },
                        )
                    ).data;
                }
                if (!database || !databases.includes(database)) {
                    throw new Error(l10n.t('Unable to resolve the selected database in this account.'));
                }
                maskConnectionTelemetry(context, {
                    ...database.model.accountInfo,
                    databaseId: database.model.database.id,
                    containerId: '',
                });
                await cosmosDBCreateContainer(context, database);
            } else {
                // The shared handler confirms according to extension settings and awaits ARM deletion.
                await cosmosDBDeleteDatabaseAccount(context, account);
            }
        }
        return { status: 'completed' };
    } catch (error) {
        if (isUserCancelledError(error)) {
            context.telemetry.properties.result = 'Canceled';
            return { status: 'cancelled' };
        }
        throw error;
    }
}

export function buildAccountCostsUrl(portalUrl: string, tenantId: string, accountId: string): string {
    return `${portalUrl.replace(/\/$/, '')}/#@${encodeURIComponent(tenantId)}/view/Microsoft_Azure_CostManagement/CostAnalysis/scope/${encodeURIComponent(accountId)}`;
}
