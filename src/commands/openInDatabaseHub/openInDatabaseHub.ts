/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getResourceMaskedValues } from '../../panels/accountOverview/resourceMasking';
import { type CosmosDBAccountResourceItem } from '../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { nonNullOrEmptyValue } from '../../utils/nonNull';

export async function openInDatabaseHub(context: IActionContext, node?: TreeElement): Promise<void> {
    if (!isTreeElementWithContextValue(node) || !node.contextValue.split(';').includes('supportsDatabaseHub')) {
        throw new Error(
            l10n.t('Database Hub is only available for Azure Cosmos DB for NoSQL accounts in public Azure.'),
        );
    }

    const accountNode = node as CosmosDBAccountResourceItem;

    context.valuesToMask.push(
        ...getResourceMaskedValues([
            accountNode.account.id,
            accountNode.account.name,
            accountNode.account.subscription.subscriptionId,
        ]),
    );

    const accountId = nonNullOrEmptyValue(accountNode.account.id, 'account.id');
    const url = new URL('/workloads/fdh/databaseHub/estate', 'https://app.fabric.microsoft.com');
    url.searchParams.set('databaseType', 'cosmos-db');
    url.searchParams.set('databaseResourceId', accountId);
    const urlString = url.toString();
    context.valuesToMask.push(...getResourceMaskedValues([urlString]));

    // Like accountActions, pass a string to preserve encoding through VS Code's opener.
    // The runtime accepts strings despite the Uri-only API type.
    if (!(await vscode.env.openExternal(urlString as unknown as vscode.Uri))) {
        throw new Error(l10n.t('Unable to open the link in your browser.'));
    }
}
