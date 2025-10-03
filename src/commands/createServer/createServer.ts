/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { API } from '../../AzureDBExperiences';
import { openUrl } from '../../utils/openUrl';
import { pickExperience, QuickPickType } from '../../utils/pickItem/pickExperience';

export async function createServer(context: IActionContext): Promise<void> {
    const experience = await pickExperience(context, QuickPickType.ALL);
    const api = experience.api;

    context.telemetry.properties.experience = api;

    if (api === API.PostgresSingle) {
        await openUrl('https://portal.azure.com/#create/Microsoft.PostgreSQLServerGroup');
    }

    if (api === API.PostgresFlexible) {
        await openUrl('https://portal.azure.com/#create/Microsoft.PostgreSQLFlexibleServer');
    }

    if (experience.api === API.MongoClusters || experience.api === API.MongoDB) {
        await openUrl('https://portal.azure.com/#view/Microsoft_Azure_DocumentDB/MongoDB_Type_Selection.ReactView');
    }

    if (api === API.Core || api === API.Table || api === API.Graph || api === API.Cassandra) {
        await openUrl('https://portal.azure.com/#create/Microsoft.DocumentDB');
    }
}
