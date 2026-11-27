/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { readMetrics } from '../../readDiagnostics';
import { escapeODataLiteral, parseMonitorTimestamp, pickPointValue } from '../../shared';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';

export const INDEXING_RECOVERY_LIMIT = 8;
export const INDEXING_METRICS = ['IndexUsage', 'DataUsage'] as const;
export type IndexingMetric = (typeof INDEXING_METRICS)[number];
const MAX_MEMBERS = 50;
const MAX_FILTER_LENGTH = 3500;

function filterFor(database: string, containers: readonly string[]): string {
    const members = containers.map((container) => `CollectionName eq '${escapeODataLiteral(container)}'`);
    return `DatabaseName eq '${escapeODataLiteral(database)}' and (${members.join(' or ')})`;
}

export function validIndexingIdentity(name: string): boolean {
    const literal = name.trim();
    return literal.length > 0 && literal !== '*';
}

export function indexingGroups<T extends { databaseId: string; containerId: string }>(rows: readonly T[]): T[][] {
    const byDatabase = new Map<string, T[]>();
    for (const row of rows) {
        const members = byDatabase.get(row.databaseId);
        if (members) {
            members.push(row);
        } else {
            byDatabase.set(row.databaseId, [row]);
        }
    }
    const groups: T[][] = [];
    for (const [database, rows] of byDatabase) {
        let group: T[] = [];
        for (const row of rows) {
            const names = [...group.map((member) => member.containerId), row.containerId];
            if (
                group.length > 0 &&
                (group.length === MAX_MEMBERS ||
                    encodeURIComponent(filterFor(database, names)).length > MAX_FILTER_LENGTH)
            ) {
                groups.push(group);
                group = [];
            }
            group.push(row);
        }
        if (group.length > 0) {
            groups.push(group);
        }
    }
    return groups;
}

/**
 * Assigns storage only to explicit ARM members. A gappy/truncated series cannot establish its latest populated
 * value; leave it for the bounded exact-read recovery instead of reusing the latest returned prefix.
 */
export async function getIndexingBatch(
    client: MonitorClient,
    resourceUri: string,
    database: string,
    containers: readonly string[],
    now: number,
): Promise<Map<string, Partial<Record<IndexingMetric, number>>>> {
    const { windowMs, interval, bucketMs } = DIAGNOSTIC_POLICY.indexing.observation;
    const start = now - windowMs;
    const timespan = `${new Date(start).toISOString()}/${new Date(now).toISOString()}`;
    const filter = filterFor(database, containers);
    if (
        encodeURIComponent(filter).length > MAX_FILTER_LENGTH ||
        ![database, ...containers].every(validIndexingIdentity) ||
        new Set(containers).size !== containers.length
    ) {
        throw new Error('Unusable inventory for a grouped indexing read.');
    }
    const top = containers.length * INDEXING_METRICS.length + 1;
    const response = await readMetrics(
        client,
        resourceUri,
        {
            metricnames: INDEXING_METRICS.join(','),
            aggregation: 'Maximum',
            timespan,
            interval,
            filter,
            top,
        },
        [database, ...containers],
    );
    const cells = new Map<string, Partial<Record<IndexingMetric, number>>>();
    const reported = response.timespan?.split('/').map((stamp) => Date.parse(stamp));
    if (
        (response.interval !== interval && response.interval !== 'PT300S') ||
        reported?.length !== 2 ||
        ![start, Math.floor(start / 1000) * 1000].includes(reported[0]) ||
        ![now, Math.floor(now / 1000) * 1000].includes(reported[1])
    ) {
        return cells;
    }
    const allowed = new Set(containers);
    for (const metricName of INDEXING_METRICS) {
        const matching = response.value?.filter((item) => item.name?.value === metricName) ?? [];
        if (matching.length !== 1 || matching[0].unit !== 'Bytes' || (matching[0].timeseries?.length ?? 0) >= top) {
            continue;
        }
        const byMember = new Map<string, number | undefined>();
        let ambiguous = false;
        for (const series of matching[0].timeseries ?? []) {
            const dimensions = series.metadatavalues ?? [];
            const member = dimensions.find((dim) => dim.name?.value?.toLowerCase() === 'collectionname')?.value;
            const db = dimensions.find((dim) => dim.name?.value?.toLowerCase() === 'databasename')?.value;
            if (dimensions.length !== 2 || db !== database || member === undefined || !allowed.has(member)) {
                ambiguous = true;
                break;
            }
            if (byMember.has(member)) {
                byMember.set(member, undefined);
                continue;
            }
            const samples = (series.data ?? [])
                .map((point) => ({
                    timestamp: parseMonitorTimestamp(point.timeStamp) ?? NaN,
                    value: pickPointValue(point, 'Maximum'),
                    invalid:
                        point.maximum !== undefined &&
                        point.maximum !== null &&
                        (!Number.isFinite(point.maximum) || point.maximum < 0),
                }))
                .sort((a, b) => a.timestamp - b.timestamp);
            const first = samples[0]?.timestamp ?? Infinity;
            const last = samples.at(-1)?.timestamp ?? -Infinity;
            const minuteAligned =
                first === Math.floor(start / 60_000) * 60_000 && samples.length === windowMs / bucketMs;
            const complete =
                first <= start &&
                first > start - bucketMs &&
                last < now &&
                (last + bucketMs >= now || minuteAligned) &&
                samples.every(
                    ({ timestamp, invalid }, i) =>
                        !invalid &&
                        Number.isFinite(timestamp) &&
                        (i === 0 || timestamp - samples[i - 1].timestamp === bucketMs),
                );
            const latest = complete ? samples.findLast(({ value }) => value !== undefined)?.value : undefined;
            byMember.set(member, latest !== undefined && latest >= 0 ? latest : undefined);
        }
        if (!ambiguous) {
            for (const [member, value] of byMember) {
                if (value !== undefined) {
                    cells.set(member, { ...cells.get(member), [metricName]: value });
                }
            }
        }
    }
    return cells;
}
