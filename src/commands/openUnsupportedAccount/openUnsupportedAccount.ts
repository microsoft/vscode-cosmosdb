/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import vscode from 'vscode';
import { API } from '../../AzureDBExperiences';
import { type CosmosDBAccountUnsupportedResourceItem } from '../../tree/cosmosdb/CosmosDBAccountUnsupportedResourceItem';
import { openUrl } from '../../utils/openUrl';
import { openPostgresExtension } from './pgDeprecation';

export function createPortalUri(subscription: AzureSubscription | ISubscriptionContext, id: string): vscode.Uri {
    const url: string = `${subscription.environment.portalUrl}/#@${subscription.tenantId}/resource${id}`;

    return vscode.Uri.parse(url);
}

export async function openUnsupportedAccount(
    _context: IActionContext,
    node: CosmosDBAccountUnsupportedResourceItem,
): Promise<void> {
    const api = node.experience.shortName;
    const message: string = l10n.t('This extension does not support Azure Cosmos DB for') + ` ${api} API.`;

    if ('subscription' in node.account && node.account.subscription) {
        if (node.experience.api === API.PostgresSingle || node.experience.api === API.PostgresFlexible) {
            await openPostgresExtension(node);
        } else {
            const account = node.account;
            const portalUrl = createPortalUri(account.subscription, account.id);
            const openInPortal = l10n.t('Open in Azure Portal');
            const result = await vscode.window.showErrorMessage(message, openInPortal);

            if (result === openInPortal) {
                await openUrl(portalUrl.toString());
            }
        }
    } else {
        await vscode.window.showErrorMessage(message);
    }
}
