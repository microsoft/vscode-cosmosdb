/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { readItems } from './readDiagnostics';
import { escapeODataLiteral, parseMonitorTimestamp } from './shared';
import { DAY } from './units';

// Activity Log retention is approximately 90 days; stay within that platform retention window.
const ACTIVITY_LOG_LOOKBACK_DAYS = 89;

type CreatedAtValue = Date | string | undefined;

export function getSystemCreatedAt(resource: unknown): string | undefined {
    return getSystemTimestamp(resource, 'createdAt');
}

export function hasMalformedCreationTime(resource: { systemData?: { createdAt?: unknown } }): boolean {
    const createdAt = resource.systemData?.createdAt;
    return createdAt !== undefined && createdAt !== null && getSystemCreatedAt(resource) === undefined;
}

/** A last-modified timestamp proves existence by that time, not when the resource was created. */
export function getSqlResourceExistedAt(resource: {
    resource?: { ts?: number };
    systemData?: unknown;
}): string | undefined {
    // ARM exposes the Cosmos resource's wire `_ts` (Unix seconds) as `resource.ts` in the SDK.
    const ts = resource.resource?.ts;
    if (typeof ts === 'number' && ts > 0) {
        const timestamp = parseMonitorTimestamp(new Date(ts * 1000));
        if (timestamp !== undefined) {
            return new Date(timestamp).toISOString();
        }
    }
    return getSystemTimestamp(resource, 'lastModifiedAt');
}

function getSystemTimestamp(resource: unknown, property: 'createdAt' | 'lastModifiedAt'): string | undefined {
    if (!resource || typeof resource !== 'object' || !('systemData' in resource)) {
        return undefined;
    }
    const systemData = resource.systemData;
    if (!systemData || typeof systemData !== 'object') {
        return undefined;
    }
    const value = (systemData as Partial<Record<typeof property, unknown>>)[property];
    if (!(value instanceof Date) && typeof value !== 'string') {
        return undefined;
    }
    const timestamp = parseMonitorTimestamp(value);
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
    for await (const event of readItems('activityLog', 'activityLogs.list', () => client.activityLogs.list(filter), [
        accountId,
        databaseId,
        containerId,
    ])) {
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
