/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import {
    getCosmosDBExperienceQuickPicks,
    getExperienceQuickPicks,
    getMongoCoreExperienceQuickPicks,
    getPostgresExperienceQuickPicks,
    type Experience,
} from '../../AzureDBExperiences';

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
            quickPicks.push(...getCosmosDBExperienceQuickPicks());
            break;
        case QuickPickType.Mongo:
            quickPicks.push(...getMongoCoreExperienceQuickPicks());
            break;
        case QuickPickType.ALL:
        default:
            quickPicks.push(...getExperienceQuickPicks());
    }

    if (quickPicks.length === 0) {
        throw new Error(l10n.t('No experiences found'));
    }

    if (quickPicks.length === 1) {
        return quickPicks[0].data;
    }

    const result: IAzureQuickPickItem<Experience> = await context.ui.showQuickPick(quickPicks, {
        placeHolder: l10n.t('Select an Azure Database Server'),
    });

    return result.data;
}
