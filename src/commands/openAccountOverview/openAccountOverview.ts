/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, registerCommandWithTreeNodeUnwrapping } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { AzureResourceMetadata } from '../../cosmosdb/AzureResourceMetadata';
import { ACCOUNT_OVERVIEW_TARGETS, type AccountOverviewTarget } from '../../panels/accountOverview/navigation';
import { getAccountOverviewMaskedValues, getResourceMaskedValues } from '../../panels/accountOverview/resourceMasking';
import { AccountOverviewTab } from '../../panels/AccountOverviewTab';
import { type CosmosDBAccountResourceItem } from '../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function openAccountOverview(context: IActionContext, node?: CosmosDBAccountResourceItem): Promise<void> {
    return openAccountOverviewTarget(context, 'overview', node);
}

export function registerAccountOverviewNavigationCommands(): void {
    for (const target of ACCOUNT_OVERVIEW_TARGETS) {
        registerCommandWithTreeNodeUnwrapping(
            `cosmosDB.openAccountOverview.${target}`,
            (context: IActionContext, node?: CosmosDBAccountResourceItem) =>
                openAccountOverviewTarget(context, target, node),
        );
    }
}

export async function openAccountOverviewTarget(
    context: IActionContext,
    target: AccountOverviewTarget,
    node?: CosmosDBAccountResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBAccountResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: /hasarmmetadata/i,
        });
    }

    if (!node) {
        return undefined;
    }

    if (isTreeElementWithExperience(node)) {
        context.telemetry.properties.experience = node.experience.api;
    }

    context.valuesToMask.push(
        ...getResourceMaskedValues([
            node.account.id,
            node.account.name,
            node.account.resourceGroup,
            node.account.subscription.subscriptionId,
            node.account.subscription.name,
        ]),
    );
    const metadata = await AzureResourceMetadata.create(node.account);
    if (!metadata) {
        throw new Error(l10n.t('Failed to load Cosmos DB account metadata.'));
    }

    context.valuesToMask.push(...getAccountOverviewMaskedValues(metadata));
    AccountOverviewTab.render(metadata, undefined, target);
}
