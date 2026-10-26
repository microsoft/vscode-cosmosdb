/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { type MetricUnavailableReason } from '../metrics/contracts';
import { deriveAccountHealth } from '../overviewHealthModel';
import { DIAGNOSTIC_POLICY } from './advisories/core/thresholds';
import { queryThrottlingSummary } from './ruTrends';
import { type HealthState, metricFailureReason, type ProvisioningState } from './shared';

export { deriveAccountHealth } from '../overviewHealthModel';

export interface AccountHealthResult {
    /** Whether the account-wide request signal was observed, independently of provisioning problems. */
    available: boolean;
    reason?: MetricUnavailableReason;
    health?: HealthState;
    /** Account-wide request signal, separate from provisioning-derived health; absent if the query failed. */
    hasSustainedThrottling?: boolean;
    generatedAt: number;
}

/** One account-wide Monitor query; no database/container enumeration or dimension splitting. */
export async function getAccountHealth(
    client: MonitorClient | undefined,
    resourceUri: string,
    provisioningState: ProvisioningState | undefined,
): Promise<AccountHealthResult> {
    const generatedAt = Date.now();
    const base: AccountHealthResult = {
        available: false,
        health: deriveAccountHealth(provisioningState, false, false),
        generatedAt,
    };
    if (!client) {
        return { ...base, reason: 'noData' };
    }
    const config = DIAGNOSTIC_POLICY.sustainedThrottling.observation;
    const timespan = `${new Date(generatedAt - config.windowMs).toISOString()}/${new Date(generatedAt).toISOString()}`;
    try {
        const signal = await queryThrottlingSummary(
            client,
            resourceUri,
            timespan,
            config.interval,
            config.bucketMs,
            undefined,
        );
        return {
            available: signal.hasObservations,
            reason: signal.hasObservations ? undefined : 'noData',
            health: deriveAccountHealth(provisioningState, signal.timestamps.size > 0, signal.hasObservations),
            hasSustainedThrottling: signal.timestamps.size > 0,
            generatedAt,
        };
    } catch (error) {
        return { ...base, reason: metricFailureReason(error) };
    }
}
