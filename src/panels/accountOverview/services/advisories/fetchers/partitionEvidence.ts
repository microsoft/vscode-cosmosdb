/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient, type TimeSeriesElement } from '@azure/arm-monitor';
import { readMetrics } from '../../readDiagnostics';
import { escapeODataLiteral, HOUR, parseMonitorTimestamp, percentile, type RangeConfig } from '../../shared';

type PartitionMetric = 'NormalizedRUConsumption' | 'PhysicalPartitionSizeInfo';
export interface PartitionOfferScope {
    databaseId: string;
    containerId?: string;
    ownerRid?: string;
}

export interface RegionalPartitionEvidence {
    readonly regions: readonly PartitionRegion[];
}

interface PartitionRegion {
    readonly region: string;
    readonly expected?: number;
    readonly observed: number;
    readonly histories: ReadonlyMap<string, ReadonlyMap<number, number>>;
    readonly issues: readonly string[];
    readonly bucketMs: number;
}

interface PartitionCohort {
    readonly region: string;
    readonly histories: readonly ReadonlyMap<number, number>[];
    readonly buckets: number;
}

export interface PartitionCoverageEvidence {
    readonly coverageComplete: boolean;
    readonly partitionCoverage: readonly {
        region: string;
        expected?: number;
        observed: number;
        usable: number;
        complete: boolean;
        issues: readonly string[];
    }[];
    readonly witnessRegion?: string;
    readonly comparableBuckets?: number;
}

const SERIES_LIMIT = 1000;
const TARGETED_LIMIT = 4;
const partitionDimension = 'PhysicalPartitionId';

function filterValue(name: string, value: string): string {
    return `${name} eq '${escapeODataLiteral(value)}'`;
}

function dimensions(row: TimeSeriesElement): Map<string, string> {
    return new Map(
        (row.metadatavalues ?? []).flatMap(({ name, value }) =>
            name?.value && value !== undefined ? [[name.value.toLowerCase(), value]] : [],
        ),
    );
}

function coversWindow(stamps: Iterable<number>, start: number, end: number, grain: number): boolean {
    const times = [...stamps].sort((a, b) => a - b);
    return (
        times.length >= Math.ceil((end - start) / grain) &&
        times[0] > start - grain &&
        times[0] <= start &&
        times[times.length - 1] >= end - grain &&
        times[times.length - 1] < end &&
        times.every((stamp, i) => i === 0 || stamp - times[i - 1] === grain)
    );
}

function readPoints(
    row: TimeSeriesElement,
    start: number,
    end: number,
    grain: number,
    points = new Map<number, number>(),
): { points: Map<number, number>; invalid: boolean } {
    let invalid = false;
    for (const { timeStamp, maximum } of row.data ?? []) {
        if (maximum === undefined || maximum === null) {
            continue;
        }
        const stamp = parseMonitorTimestamp(timeStamp);
        if (stamp === undefined || !Number.isFinite(maximum) || maximum < 0) {
            invalid = true;
        } else if (stamp > start - grain && stamp < end) {
            const previous = points.get(stamp);
            if (previous !== undefined && previous !== maximum) {
                invalid = true;
            } else {
                points.set(stamp, maximum);
            }
        }
    }
    return { points, invalid };
}

function splitRows(
    rows: readonly TimeSeriesElement[],
    start: number,
    end: number,
    grain: number,
    inScope: (row: TimeSeriesElement) => boolean,
) {
    const histories = new Map<string, Map<number, number>>();
    const signatures = new Map<string, string>();
    const conflicts = new Set<string>();
    let unidentified = false;
    for (const row of rows) {
        const metadata = dimensions(row);
        const id = metadata.get(partitionDimension.toLowerCase());
        if (!id?.trim() || !inScope(row)) {
            unidentified = true;
            continue;
        }
        const signature = JSON.stringify([...metadata].sort(([a], [b]) => a.localeCompare(b)));
        const { points, invalid } = readPoints(row, start, end, grain, histories.get(id));
        if (invalid || (signatures.has(id) && signatures.get(id) !== signature)) {
            conflicts.add(id);
        }
        signatures.set(id, signature);
        histories.set(id, points);
    }
    for (const id of conflicts) {
        histories.delete(id);
    }
    return { histories, conflicts, unidentified };
}

/** Qualifies histories with the count for the same offer, region and window. Never compares different regions. */
export async function getRegionalPartitionEvidence(
    client: MonitorClient,
    accountId: string,
    metric: PartitionMetric,
    observation: RangeConfig,
    offer: PartitionOfferScope,
    configuredRegions: readonly string[],
    now: number,
): Promise<RegionalPartitionEvidence> {
    const regions = new Map<string, string>();
    for (const name of configuredRegions) {
        if (name.trim()) {
            regions.set(name.trim().toLowerCase().replace(/\s+/g, ''), name.trim());
        }
    }
    if (regions.size === 0 || configuredRegions.some((region) => !region.trim())) {
        return { regions: [] };
    }
    const { bucketMs, interval, windowMs } = observation;
    const start = now - windowMs;
    const timespan = `${new Date(start).toISOString()}/${new Date(now).toISOString()}`;
    const regionsRead: PartitionRegion[] = [];

    for (const region of regions.values()) {
        const issues: string[] = [];
        if (!offer.ownerRid && !offer.containerId) {
            regionsRead.push({
                region,
                bucketMs,
                observed: 0,
                histories: new Map(),
                issues: ['shared_offer_identity_missing'],
            });
            continue;
        }
        const owner = offer.ownerRid;
        const dimension = owner ? 'OfferOwnerRid' : 'CollectionName';
        const identity = owner ?? offer.containerId!;
        const scope = [
            filterValue('DatabaseName', offer.databaseId),
            filterValue('Region', region),
            filterValue(dimension, identity),
        ].join(' and ');
        const inScope = (row: TimeSeriesElement): boolean => {
            const metadata = dimensions(row);
            return (
                (!metadata.has('region') ||
                    metadata.get('region')?.toLowerCase().replace(/\s+/g, '') ===
                        region.toLowerCase().replace(/\s+/g, '')) &&
                (!metadata.has('databasename') || metadata.get('databasename') === offer.databaseId) &&
                (!metadata.has(dimension.toLowerCase()) || metadata.get(dimension.toLowerCase()) === identity)
            );
        };
        const read = async (name: PartitionMetric | 'PhysicalPartitionCount', filter: string, top: number) => {
            const countFloor = name === 'PhysicalPartitionCount' && bucketMs < HOUR / 12;
            const response = await readMetrics(
                client,
                accountId,
                {
                    metricnames: name,
                    aggregation: 'Maximum',
                    interval: countFloor ? 'PT5M' : interval,
                    timespan,
                    filter,
                    top,
                },
                [offer.databaseId, offer.containerId ?? '', owner ?? ''],
            );
            return response.value
                .filter((entry) => entry.name.value?.toLowerCase() === name.toLowerCase())
                .flatMap((entry) => entry.timeseries ?? []);
        };

        let expected: number | undefined;
        try {
            const countRows = await read('PhysicalPartitionCount', scope, 2);
            if (countRows.length !== 1 || !inScope(countRows[0])) {
                issues.push('count_missing_or_ambiguous');
            } else {
                const grain = Math.max(bucketMs, HOUR / 12);
                const { points, invalid } = readPoints(countRows[0], start, now, grain);
                const values = new Set(points.values());
                const count = values.values().next().value;
                if (invalid || count === undefined || !Number.isSafeInteger(count) || count < 1) {
                    issues.push('count_invalid_or_missing');
                } else if (values.size !== 1) {
                    issues.push('count_changed');
                } else if (!coversWindow(points.keys(), start, now, grain)) {
                    issues.push('count_history_incomplete');
                } else {
                    expected = count;
                }
            }
        } catch {
            issues.push('count_read_failed');
        }

        const split = `${scope} and ${filterValue(partitionDimension, '*')}`;
        const top = Math.min(SERIES_LIMIT, Math.max(16, (expected ?? 0) + 1));
        let rows: TimeSeriesElement[];
        try {
            rows = await read(metric, split, top);
        } catch {
            regionsRead.push({
                region,
                bucketMs,
                expected,
                observed: 0,
                histories: new Map(),
                issues: [...issues, 'split_read_failed'],
            });
            continue;
        }
        let parsed = splitRows(rows, start, now, bucketMs, inScope);
        let capped = rows.length >= top;
        if (
            top < SERIES_LIMIT &&
            (capped || (rows.length > 0 && expected !== undefined && parsed.histories.size < expected))
        ) {
            try {
                const extra = await read(metric, split, SERIES_LIMIT);
                capped = extra.length >= SERIES_LIMIT;
                rows = rows.concat(extra);
                parsed = splitRows(rows, start, now, bucketMs, inScope);
            } catch {
                issues.push('wider_split_read_failed');
            }
        }
        const gaps = [...parsed.histories].filter(([, points]) => !coversWindow(points.keys(), start, now, bucketMs));
        for (const [id] of gaps.sort(([a], [b]) => a.localeCompare(b)).slice(0, TARGETED_LIMIT)) {
            try {
                const extra = await read(metric, `${scope} and ${filterValue(partitionDimension, id)}`, 2);
                const matching = extra.filter((row) => dimensions(row).get(partitionDimension.toLowerCase()) === id);
                if (matching.length !== extra.length) {
                    issues.push('unexpected_targeted_identity');
                }
                rows = rows.concat(matching);
            } catch {
                issues.push('targeted_split_read_failed');
                break;
            }
        }
        if (gaps.length > 0) {
            parsed = splitRows(rows, start, now, bucketMs, inScope);
        }
        const observed = parsed.histories.size + parsed.conflicts.size;
        const histories = new Map([...parsed.histories].filter(([, points]) => points.size > 0));
        if (parsed.conflicts.size > 0) {
            issues.push('conflicting_partition_samples');
        }
        if (parsed.unidentified) {
            issues.push('unidentified_series');
        }
        if (capped) {
            issues.push('series_limit_reached');
        }
        if (observed !== expected || histories.size !== observed) {
            issues.push('partition_count_unverified');
        }
        const grids = new Set(
            [...histories.values()].map((points) => [...points.keys()].sort((a, b) => a - b).join(',')),
        );
        if (
            grids.size > 1 ||
            [...histories.values()].some((points) => !coversWindow(points.keys(), start, now, bucketMs))
        ) {
            issues.push('partition_history_incomplete');
        }
        regionsRead.push({ region, bucketMs, expected, observed, histories, issues });
    }
    return { regions: regionsRead };
}

function regionComplete(region: PartitionRegion): boolean {
    return region.expected !== undefined && region.expected === region.histories.size && region.issues.length === 0;
}

export function partitionCoverage(evidence: RegionalPartitionEvidence): PartitionCoverageEvidence {
    const partitionCoverage = evidence.regions.map((entry) => ({
        region: entry.region,
        expected: entry.expected,
        observed: entry.observed,
        usable: entry.histories.size,
        issues: entry.issues,
        complete: regionComplete(entry),
    }));
    return {
        coverageComplete: partitionCoverage.length > 0 && partitionCoverage.every((entry) => entry.complete),
        partitionCoverage,
    };
}

/**
 * Complete regions compare the whole window. Partial regions can only witness coexisting IDs across a contiguous run.
 * @yields Same-region partition histories over comparable buckets.
 */
export function* partitionCohorts(evidence: RegionalPartitionEvidence): IterableIterator<PartitionCohort> {
    for (const region of evidence.regions) {
        if (regionComplete(region)) {
            const histories = [...region.histories.values()];
            yield { region: region.region, histories, buckets: histories[0]?.size ?? 0 };
            continue;
        }
        const byTime = new Map<number, Map<string, number>>();
        for (const [id, points] of region.histories) {
            for (const [stamp, value] of points) {
                const row = byTime.get(stamp) ?? new Map<string, number>();
                row.set(id, value);
                byTime.set(stamp, row);
            }
        }
        let run = new Map<string, Map<number, number>>();
        let previous: number | undefined;
        for (const [stamp, row] of [...byTime].sort(([a], [b]) => a - b)) {
            if (
                run.size > 0 &&
                (stamp - previous! !== region.bucketMs ||
                    row.size !== run.size ||
                    [...row.keys()].some((id) => !run.has(id)))
            ) {
                const histories = [...run.values()];
                yield { region: region.region, histories, buckets: histories[0].size };
                run = new Map();
            }
            if (row.size >= 2) {
                for (const [id, value] of row) {
                    const series = run.get(id) ?? new Map<number, number>();
                    series.set(stamp, value);
                    run.set(id, series);
                }
            }
            previous = stamp;
        }
        if (run.size > 0) {
            const histories = [...run.values()];
            yield { region: region.region, histories, buckets: histories[0].size };
        }
    }
}

export function regionalSaturation(evidence: RegionalPartitionEvidence, rank: number) {
    return [...partitionCohorts(evidence)].map(({ histories, ...cohort }) => {
        const values = histories.map((series) => percentile([...series.values()], rank)!);
        return { ...cohort, partitionCount: values.length, maxP99: Math.max(...values), minP99: Math.min(...values) };
    });
}

export function withPartitionWitness(
    coverage: PartitionCoverageEvidence,
    cohort: Pick<PartitionCohort, 'region' | 'buckets'>,
): PartitionCoverageEvidence {
    return { ...coverage, witnessRegion: cohort.region, comparableBuckets: cohort.buckets };
}
