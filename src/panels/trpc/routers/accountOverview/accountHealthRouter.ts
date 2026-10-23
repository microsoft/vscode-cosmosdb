/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { API, tryGetExperience } from '../../../../AzureDBExperiences';
import {
    type AccountHealthResult,
    deriveAccountHealth,
    getAccountHealth,
} from '../../../accountOverview/services/accountHealth';
import { type ProvisioningState } from '../../../accountOverview/services/shared';
import { accountOverviewProcedure } from '../../trpc';

export const accountHealthProcedures = {
    getAccountHealth: accountOverviewProcedure.query(async ({ ctx }): Promise<AccountHealthResult> => {
        const account = ctx.metadata.databaseAccount as DatabaseAccountGetResults;
        const provisioningState = account.provisioningState as ProvisioningState | undefined;
        const experience = tryGetExperience(account);
        if (experience && experience.api !== API.Core) {
            return {
                available: false,
                reason: 'unsupported',
                health: deriveAccountHealth(provisioningState, false, false),
                generatedAt: Date.now(),
            };
        }
        return getAccountHealth(await ctx.metadata.getMonitorClient(), ctx.metadata.accountId, provisioningState);
    }),
};
