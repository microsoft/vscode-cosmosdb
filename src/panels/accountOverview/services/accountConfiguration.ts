/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';

/** Missing ARM configuration stays unknown; continuous retention is derived only from an explicit known tier. */
export function getAccountConfiguration(account: DatabaseAccountGetResults) {
    const policy = account.backupPolicy;
    const periodic =
        policy?.type === 'Periodic' && 'periodicModeProperties' in policy ? policy.periodicModeProperties : undefined;
    const tier =
        policy?.type === 'Continuous' && 'continuousModeProperties' in policy
            ? policy.continuousModeProperties?.tier
            : undefined;
    return {
        automaticFailoverEnabled: account.enableAutomaticFailover,
        backupRetentionHours:
            periodic?.backupRetentionIntervalInHours ??
            (tier === 'Continuous7Days' ? 7 * 24 : tier === 'Continuous30Days' ? 30 * 24 : undefined),
        backupIntervalMinutes: periodic?.backupIntervalInMinutes,
        continuousBackupTier: tier,
    };
}
