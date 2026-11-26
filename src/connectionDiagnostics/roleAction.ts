/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { addRbacContributorPermission } from '../cosmosdb/utils/rbacUtils';
import { ext } from '../extensionVariables';
import { type DiagnosticsAzureAccount } from './target';

export type RoleActionOutcome = 'assigned' | 'cancelled' | 'unavailable' | 'denied' | 'failed';

export async function assignDiagnosticsDataRole(
    context: IActionContext,
    account: DiagnosticsAzureAccount,
    principalId: string,
    isCurrent: () => boolean,
): Promise<RoleActionOutcome> {
    const group = account.resourceGroup;
    if (!group || !isCurrent()) return 'unavailable';
    context.valuesToMask.push(account.id, account.name, group, account.subscription.subscriptionId, principalId);

    const confirm = l10n.t('Add Data Contributor role');
    try {
        const selection = await vscode.window.showWarningMessage(
            l10n.t('Assign the Cosmos DB Built-in Data Contributor role?'),
            {
                modal: true,
                detail: l10n.t(
                    'This grants read and write access to data across the Cosmos DB account {account} for the identity used by diagnostics ({principal}).',
                    { account: account.name, principal: principalId },
                ),
            },
            confirm,
        );
        if (selection !== confirm) return 'cancelled';
        if (!isCurrent()) return 'unavailable';
        await addRbacContributorPermission(account.name, principalId, group, context, account.subscription, {
            idempotent: true,
        });
        return 'assigned';
    } catch (error) {
        const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
        const outcome = status === 401 || status === 403 ? 'denied' : 'failed';
        ext.outputChannel.warn(`[Connection diagnostics] Data role assignment ${outcome}`);
        return outcome;
    }
}
