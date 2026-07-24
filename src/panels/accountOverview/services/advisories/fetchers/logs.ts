/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type LogsQueryResult, type LogsTable } from '@azure/monitor-query-logs';
import { classifyUnavailable, DAY, type UnavailableReason } from '../../shared';
import {
    type CollectionTrafficInput,
    type CrossPartitionInput,
    type QueryShapeInput,
    type SharedThroughputInput,
    type UncontrolledIngestionInput,
} from '../core/types';

// ─── Tier-2 (Log Analytics) data path ─────────────────────────────────────────────
//
// The Tier-2 detectors (DX-002 cross-partition fan-out, DX-007 shard-key misalignment, DX-010 uncontrolled
// ingestion, DX-003 shared-throughput starvation) read the `CDB*` diagnostic-log tables via resource-centric
// Log Analytics queries. This module is the thin fetch-and-shape seam: it runs the same KQL CODA's detectors
// use, folds the rows into the plain input shapes the pure `evaluate*` functions in `derivedAdvisories.ts`
// consume, and classifies "logs unavailable" into an {@link UnavailableReason} so the card can render Tier-1
// while flagging that Tier-2 was skipped. It is `@azure/arm-monitor`-free (types-only import of the logs SDK),
// so the whole module graph stays unit-testable against a fake executor.

/** The one-day look-back CODA uses for the present-tense log-based detectors, bucketed hourly. */
const LOG_WINDOW_MS = DAY;

/** Timespan for a resource-centric Log Analytics query. */
export interface LogsTimespan {
    startTime: Date;
    endTime: Date;
}

/**
 * The narrow slice of `LogsQueryClient` this module needs. `LogsQueryClient` satisfies it structurally, and a
 * fake in tests only has to return a `LogsQueryResult`-shaped object — no SDK dependency in the test graph.
 */
export interface LogsQueryExecutor {
    queryResource(resourceId: string, query: string, timespan: LogsTimespan): Promise<LogsQueryResult>;
}

/** Builds the one-day timespan ending now. */
export function logWindow(now = Date.now()): LogsTimespan {
    return { startTime: new Date(now - LOG_WINDOW_MS), endTime: new Date(now) };
}

/** Strips single quotes from a value interpolated into a KQL string literal, mirroring CODA's `.replace("'", "")`. */
function kqlLiteral(value: string): string {
    return value.replace(/'/g, '');
}

/** The first result table, whether the query fully or partially succeeded (both carry rows we can read). */
function firstTable(result: LogsQueryResult): LogsTable | undefined {
    if ('tables' in result) {
        return result.tables[0];
    }
    if ('partialTables' in result) {
        return result.partialTables[0];
    }
    return undefined;
}

/** Folds a Log Analytics table into an array of `column → cell` records for easy field access. Pure. */
export function tableToRecords(table: LogsTable | undefined): Record<string, unknown>[] {
    if (!table) {
        return [];
    }
    const columns = table.columnDescriptors.map((c) => c.name);
    return table.rows.map((row) => {
        const record: Record<string, unknown> = {};
        columns.forEach((name, index) => {
            if (name) {
                record[name] = row[index];
            }
        });
        return record;
    });
}

function num(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
    return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

/**
 * Classifies a failed `CDB*` probe into a Tier-2 {@link UnavailableReason}. A missing table (diagnostic settings
 * were never enabled, so Log Analytics cannot resolve `CDBDataPlaneRequests`) surfaces as a semantic/bad-argument
 * error → `logAnalyticsDisabled`; a 403 → `rbac` (via {@link classifyUnavailable}); anything else degrades to
 * `noData` (transient/throttled). Pure.
 */
export function classifyLogsError(error: unknown): UnavailableReason {
    const rbacOrNoData = classifyUnavailable(error);
    if (rbacOrNoData === 'rbac') {
        return 'rbac';
    }
    if (error && typeof error === 'object') {
        const e = error as { code?: unknown; message?: unknown };
        const code = typeof e.code === 'string' ? e.code.toLowerCase() : '';
        const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
        const text = `${code} ${message}`;
        // Log Analytics reports an unconfigured table as a semantic / bad-argument failure. "Failed to resolve
        // table or column expression" is the canonical message when the `CDB*` tables do not exist for the resource.
        if (
            text.includes('semanticerror') ||
            text.includes('badargument') ||
            text.includes('pathnotfound') ||
            text.includes('failed to resolve') ||
            text.includes('cdbdataplanerequests') ||
            text.includes('cdbqueryruntimestatistics')
        ) {
            return 'logAnalyticsDisabled';
        }
    }
    return 'noData';
}

/**
 * Probes whether the account's `CDB*` diagnostic-log tables are queryable. A successful query (even with zero
 * rows) means diagnostic settings are on and the caller has Reader access → `available`. A failure is classified:
 * a missing table → `logAnalyticsDisabled`, a 403 → `rbac`, else `noData`. This gate lets the collector skip the
 * per-detector queries and surface a single, reason-specific partial-coverage notice.
 */
export async function probeCdbLogs(
    executor: LogsQueryExecutor,
    resourceId: string,
    timespan: LogsTimespan,
): Promise<{ available: boolean; reason?: UnavailableReason }> {
    try {
        await executor.queryResource(resourceId, 'CDBDataPlaneRequests | take 1', timespan);
        return { available: true };
    } catch (error) {
        return { available: false, reason: classifyLogsError(error) };
    }
}

/**
 * DX-002 / DX-007: reads one container's query-fan-out shapes from `CDBQueryRuntimeStatistics`. Each logical query
 * (`CorrelatedActivityId`) touches one or more `PartitionKeyRangeId`s; grouping by anonymized `QueryText` yields
 * per-shape executions and average/max fan-out. Returns the shapes the cross-partition and shard-key evaluators
 * consume (empty when there is no query telemetry for the container).
 */
export async function fetchCrossPartitionShapes(
    executor: LogsQueryExecutor,
    resourceId: string,
    databaseId: string,
    containerId: string,
    timespan: LogsTimespan,
): Promise<CrossPartitionInput> {
    const db = kqlLiteral(databaseId);
    const coll = kqlLiteral(containerId);
    const kql =
        'CDBQueryRuntimeStatistics ' +
        `| where DatabaseName == '${db}' and CollectionName == '${coll}' ` +
        '| summarize partitionsHit = dcount(PartitionKeyRangeId) by CorrelatedActivityId, QueryText ' +
        '| summarize executions = count(), avgFanout = avg(partitionsHit), maxFanout = max(partitionsHit) ' +
        'by QueryText ' +
        '| top 200 by executions desc';
    const rows = tableToRecords(firstTable(await executor.queryResource(resourceId, kql, timespan)));
    const shapes: QueryShapeInput[] = rows
        .filter((r) => str(r.QueryText).length > 0)
        .map((r) => ({
            text: cleanQueryText(str(r.QueryText)),
            executions: Math.round(num(r.executions)),
            avgFanout: num(r.avgFanout),
            maxFanout: Math.round(num(r.maxFanout)),
        }));
    return { databaseId, containerId, shapes };
}

/**
 * Renders a `CDBQueryRuntimeStatistics` `QueryText` for display. The service logs it as a JSON envelope
 * `{"query": "…", "parameters": […]}` with the SQL already anonymized (identifiers → `p1`/`p2`, literals →
 * `str1`); we extract the `query` field and collapse whitespace, falling back to the raw value. Pure.
 */
export function cleanQueryText(raw: string): string {
    let text = raw;
    try {
        const env: unknown = JSON.parse(raw);
        if (env && typeof env === 'object' && typeof (env as { query?: unknown }).query === 'string') {
            text = (env as { query: string }).query;
        }
    } catch {
        // Not the expected JSON envelope — surface the raw (already-anonymized) text.
    }
    return text.split(/\s+/).filter(Boolean).join(' ');
}

/** The write operations that count toward the DX-010 write-RU share (grounded against live `CDBDataPlaneRequests`). */
const WRITE_OPS = ['Create', 'Upsert', 'Replace', 'Delete', 'Patch', 'Batch', 'Execute'] as const;

/**
 * DX-010: reads one container's write-dominance + throttling signal from `CDBDataPlaneRequests` — the write/total
 * RU split, request and 429 counts, the per-minute write-RU burst factor, and the dominant write-path `UserAgent`.
 * Returns the uncontrolled-ingestion evaluator's input (undefined when there is no data-plane telemetry).
 */
export async function fetchUncontrolledIngestion(
    executor: LogsQueryExecutor,
    resourceId: string,
    databaseId: string,
    containerId: string,
    timespan: LogsTimespan,
): Promise<UncontrolledIngestionInput | undefined> {
    const db = kqlLiteral(databaseId);
    const coll = kqlLiteral(containerId);
    const base = `CDBDataPlaneRequests | where DatabaseName == '${db}' and CollectionName == '${coll}' `;
    const writes = WRITE_OPS.map((w) => `'${w}'`).join(', ');
    const aggKql =
        base +
        '| summarize totalRu = sum(RequestCharge), ' +
        `writeRu = sumif(RequestCharge, OperationName in (${writes})), ` +
        'reqs = count(), throttles = countif(StatusCode == 429)';
    const burstKql =
        base +
        `| where OperationName in (${writes}) ` +
        '| summarize ru = sum(RequestCharge) by bin(TimeGenerated, 1m) ' +
        '| summarize peak = max(ru), avg = avg(ru)';
    const uaKql = base + `| where OperationName in (${writes}) ` + '| summarize n = count() by UserAgent | top 1 by n';

    const [agg, burst, ua] = await Promise.all([
        executor.queryResource(resourceId, aggKql, timespan).then((r) => tableToRecords(firstTable(r))),
        executor.queryResource(resourceId, burstKql, timespan).then((r) => tableToRecords(firstTable(r))),
        executor.queryResource(resourceId, uaKql, timespan).then((r) => tableToRecords(firstTable(r))),
    ]);

    if (agg.length === 0) {
        return undefined;
    }
    const row = agg[0];
    let burstFactor = 0;
    if (burst.length > 0) {
        const peak = num(burst[0].peak);
        const avg = num(burst[0].avg);
        burstFactor = avg > 0 ? peak / avg : 0;
    }
    const dominantUserAgent = ua.length > 0 ? str(ua[0].UserAgent) || undefined : undefined;
    return {
        databaseId,
        containerId,
        writeRu: num(row.writeRu),
        totalRu: num(row.totalRu),
        totalRequests: num(row.reqs),
        throttledRequests: num(row.throttles),
        burstFactor,
        dominantUserAgent,
    };
}

/**
 * DX-003: reads one shared-throughput database's per-collection traffic from `CDBDataPlaneRequests` — request
 * count, 429 count, and RU consumed per collection. Returns the shared-throughput evaluator's input (empty
 * collections when there is no data-plane telemetry for the database).
 */
export async function fetchSharedThroughputTraffic(
    executor: LogsQueryExecutor,
    resourceId: string,
    databaseId: string,
    sharedRu: number,
    timespan: LogsTimespan,
): Promise<SharedThroughputInput> {
    const db = kqlLiteral(databaseId);
    const kql =
        'CDBDataPlaneRequests ' +
        `| where DatabaseName == '${db}' and isnotempty(CollectionName) ` +
        '| summarize requests = count(), throttled = countif(StatusCode == 429), ru = sum(RequestCharge) ' +
        'by CollectionName';
    const rows = tableToRecords(firstTable(await executor.queryResource(resourceId, kql, timespan)));
    const collections: CollectionTrafficInput[] = rows
        .filter((r) => str(r.CollectionName).length > 0)
        .map((r) => ({
            containerId: str(r.CollectionName),
            requests: Math.round(num(r.requests)),
            throttledRequests: Math.round(num(r.throttled)),
            ruConsumed: num(r.ru),
        }));
    return { databaseId, sharedRu, collections };
}
