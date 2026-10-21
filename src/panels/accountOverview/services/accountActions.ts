/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { isUserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, DBAccountKind, tryGetExperience } from '../../../AzureDBExperiences';
import { createContainer } from '../../../commands/createContainer/createContainer';
import { createDatabase } from '../../../commands/createDatabase/createDatabase';
import { openDataModelingWizard } from '../../../commands/dataModeling/openDataModelingWizard';
import { deleteDatabaseAccount } from '../../../commands/deleteDatabaseAccount/deleteDatabaseAccount';
import { type AzureResourceMetadata } from '../../../cosmosdb/AzureResourceMetadata';
import { getControlPlane } from '../../../cosmosdb/controlPlane';
import { maskConnectionTelemetry } from '../../../cosmosdb/maskConnectionTelemetry';
import { getAccountInfoFromMetadata } from '../../../tree/cosmosdb/AccountInfo';
import { compareResourceIds } from '../../../utils/strings';
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
        } else if (input.action === 'deleteAccount') {
            await deleteDatabaseAccount(context, metadata);
        } else if (input.action === 'openDataModeler') {
            const accountInfo = await getAccountInfoFromMetadata(metadata);
            maskConnectionTelemetry(context, accountInfo);
            await openDataModelingWizard(context, accountInfo);
        } else {
            const experience = tryGetExperience(metadata.databaseAccount as DatabaseAccountGetResults);
            if (metadata.databaseAccount.kind !== DBAccountKind.GlobalDocumentDB || experience?.api !== API.Core) {
                throw new Error(l10n.t('Creating databases and containers is only supported for NoSQL accounts.'));
            }

            const accountInfo = await getAccountInfoFromMetadata(metadata);
            maskConnectionTelemetry(context, {
                ...accountInfo,
                databaseId: input.action === 'createContainer' ? input.databaseId : undefined,
            });

            // Call the shared wizard entrypoints, not the Explorer adapters or registered command wrappers.
            if (input.action === 'createDatabase') {
                await createDatabase(context, accountInfo, experience);
            } else {
                const databases = (await getControlPlane(accountInfo).listDatabases()).sort((a, b) =>
                    compareResourceIds(a.id, b.id),
                );
                context.valuesToMask.push(...getResourceMaskedValues(databases.map((database) => database.id)));
                let databaseId: string | undefined;
                if (input.databaseId !== undefined) {
                    databaseId = databases.find((database) => database.id === input.databaseId)?.id;
                } else {
                    if (databases.length === 0) {
                        throw new Error(
                            l10n.t('This account has no databases. Create a database before adding a container.'),
                        );
                    }
                    databaseId = (
                        await context.ui.showQuickPick(
                            databases.map((database) => ({ label: database.id, data: database.id })),
                            { placeHolder: l10n.t('Select a database for the new container') },
                        )
                    ).data;
                }
                if (databaseId === undefined || !databases.some((database) => database.id === databaseId)) {
                    throw new Error(l10n.t('Unable to resolve the selected database in this account.'));
                }
                await createContainer(context, accountInfo, databaseId, experience);
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
