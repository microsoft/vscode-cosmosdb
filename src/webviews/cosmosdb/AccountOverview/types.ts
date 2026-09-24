/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ProvisioningState } from '../../api/types';

export type AccountSummary = {
    accountName: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    apiType: string;
    documentEndpoint: string;
    isServerless: boolean;
    provisioningState?: ProvisioningState;
    consistencyLevel?: string;
    freeTierEnabled: boolean;
    backupPolicyType?: string;
    automaticFailoverEnabled?: boolean;
    backupRetentionHours?: number;
    backupIntervalMinutes?: number;
    continuousBackupTier?: string;
    totalThroughputLimit?: number;
    writeRegions: string[];
    readRegions: string[];
    writeRegionCount: number;
    readRegionCount: number;
    lastRefreshedAt: number;
};
