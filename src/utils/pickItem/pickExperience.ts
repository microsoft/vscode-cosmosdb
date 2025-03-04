/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import {
    getCosmosExperienceQuickPicks,
    getExperienceQuickPicks,
    getMongoCoreExperienceQuickPicks,
    getPostgresExperienceQuickPicks,
    type Experience,
} from '../../AzureDBExperiences';
import { localize } from '../localize';

export enum QuickPickType {
    ALL,
    Postgres,
    Cosmos,
    Mongo,
}

export async function pickExperience(context: IActionContext, type: QuickPickType): Promise<Experience> {
    const quickPicks: IAzureQuickPickItem<Experience>[] = [];
    switch (type) {
        case QuickPickType.Postgres:
            quickPicks.push(...getPostgresExperienceQuickPicks());
            break;
        case QuickPickType.Cosmos:
            quickPicks.push(...getCosmosExperienceQuickPicks());
            break;
        case QuickPickType.Mongo:
            quickPicks.push(...getMongoCoreExperienceQuickPicks());
            break;
        case QuickPickType.ALL:
        default:
            quickPicks.push(...getExperienceQuickPicks());
    }

    if (quickPicks.length === 0) {
        throw new Error('No experiences found');
    }

    if (quickPicks.length === 1) {
        return quickPicks[0].data;
    }

    const result: IAzureQuickPickItem<Experience> = await context.ui.showQuickPick(quickPicks, {
        placeHolder: localize('selectDBServerMsg', 'Select an Azure Database Server'),
    });

    return result.data;
}
