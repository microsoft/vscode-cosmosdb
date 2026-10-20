/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { AzureResourceMetadata } from '../../cosmosdb/AzureResourceMetadata';
import { AccountOverviewTab } from '../../panels/AccountOverviewTab';
import { type CosmosDBAccountResourceItem } from '../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function openAccountOverview(context: IActionContext, node?: CosmosDBAccountResourceItem): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBAccountResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
        });
    }

    if (!node) {
        return undefined;
    }

    if (isTreeElementWithExperience(node)) {
        context.telemetry.properties.experience = node.experience.api;
    }

    const metadata = await AzureResourceMetadata.create(node.account);
    if (!metadata) {
        throw new Error(l10n.t('Failed to load Cosmos DB account metadata.'));
    }

    AccountOverviewTab.render(metadata);
}
