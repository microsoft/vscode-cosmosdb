/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { escapeODataLiteral, parseMonitorTimestamp } from './shared';
import { DAY } from './units';

// Activity Log retention is approximately 90 days; stay within that platform retention window.
const ACTIVITY_LOG_LOOKBACK_DAYS = 89;

type CreatedAtValue = Date | string | undefined;

export function getSystemCreatedAt(resource: unknown): string | undefined {
    if (!resource || typeof resource !== 'object' || !('systemData' in resource)) {
        return undefined;
    }
    const systemData = resource.systemData;
    if (!systemData || typeof systemData !== 'object' || !('createdAt' in systemData)) {
        return undefined;
    }
    const createdAt = systemData.createdAt;
    if (!(createdAt instanceof Date) && typeof createdAt !== 'string') {
        return undefined;
    }
    const timestamp = parseMonitorTimestamp(createdAt);
    return timestamp === undefined ? undefined : new Date(timestamp).toISOString();
}

/** Cosmos container ARM resources do not reliably expose systemData; CODA uses the earliest retained write event. */
export async function getContainerCreatedAt(
    client: MonitorClient,
    accountId: string,
    databaseId: string,
    containerId: string,
    now = Date.now(),
): Promise<string | undefined> {
    const resourceId = `${accountId}/sqlDatabases/${databaseId}/containers/${containerId}`;
    const start = new Date(now - ACTIVITY_LOG_LOOKBACK_DAYS * DAY).toISOString();
    const filter = `eventTimestamp ge '${start}' and resourceId eq '${escapeODataLiteral(resourceId)}'`;
    let earliest: number | undefined;
    for await (const event of client.activityLogs.list(filter)) {
        if (!event.operationName?.value?.toLowerCase().endsWith('/containers/write')) {
            continue;
        }
        const timestamp = parseMonitorTimestamp(event.eventTimestamp);
        if (timestamp !== undefined && timestamp <= now && (earliest === undefined || timestamp < earliest)) {
            earliest = timestamp;
        }
    }
    return earliest === undefined ? undefined : new Date(earliest).toISOString();
}

export function getKnownResourceAgeDays(
    resourceCreatedAt: CreatedAtValue,
    fallbackCreatedAt?: CreatedAtValue,
    now = Date.now(),
): number | undefined {
    const createdAt = parseMonitorTimestamp(resourceCreatedAt) ?? parseMonitorTimestamp(fallbackCreatedAt);
    if (createdAt === undefined || createdAt > now) {
        return undefined;
    }
    return (now - createdAt) / DAY;
}
