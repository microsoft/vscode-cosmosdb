/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogsQueryResultStatus, type LogsQueryResult, type LogsTable } from '@azure/monitor-query-logs';
import { type UnavailableReason } from '../../shared';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import {
    type CollectionTrafficInput,
    type CrossPartitionInput,
    type QueryShapeInput,
    type SharedThroughputInput,
    type UncontrolledIngestionInput,
} from '../core/types';
import {
    classifyLogsFailure,
    createLogsDiagnostic,
    LogsFetchError,
    type LogsDiagnosticReporter,
    type LogsOperation,
} from './logsDiagnostics';

// ─── Tier-2 (Log Analytics) data path ─────────────────────────────────────────────
//
// The Tier-2 detectors (DX-002 cross-partition fan-out, DX-007 shard-key misalignment, DX-010 uncontrolled
// ingestion, DX-003 shared-throughput starvation) read the `CDB*` diagnostic-log tables via resource-centric
// Log Analytics queries. This module is the thin fetch-and-shape seam: it runs the same KQL CODA's detectors
// use, folds the rows into the plain input shapes the pure `evaluate*` functions in `derivedAdvisories.ts`
// consume, and classifies "logs unavailable" into an {@link UnavailableReason} so the card can render Tier-1
// while flagging that Tier-2 was skipped. It is `@azure/arm-monitor`-free,
// so the whole module graph stays unit-testable against a fake executor.

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
    return { startTime: new Date(now - DIAGNOSTIC_POLICY.logs.windowMs), endTime: new Date(now) };
}

/** Strips single quotes from a value interpolated into a KQL string literal, mirroring CODA's `.replace("'", "")`. */
function kqlLiteral(value: string): string {
    return value.replace(/'/g, '');
}

/** Only complete query results are suitable for computing recommendations. */
function firstTable(result: LogsQueryResult): LogsTable | undefined {
    if (result?.status === LogsQueryResultStatus.Success && Array.isArray(result.tables)) {
        const table = result.tables[0];
        if (
            table &&
            Array.isArray(table.columnDescriptors) &&
            table.columnDescriptors.every((column) => column && typeof column.name === 'string') &&
            Array.isArray(table.rows) &&
            table.rows.every((row) => Array.isArray(row) && row.length === table.columnDescriptors.length)
        ) {
            return table;
        }
    }
    return undefined;
}

async function executeLogsQuery(
    executor: LogsQueryExecutor,
    resourceId: string,
    query: string,
    timespan: LogsTimespan,
    operation: LogsOperation,
    sensitiveValues: readonly string[],
    onDiagnostic?: LogsDiagnosticReporter,
): Promise<Record<string, unknown>[]> {
    let partialFailure = false;
    try {
        // The modular SDK expands "/{+resourceId}/query" without removing an ARM ID's leading slash.
        const result = await executor.queryResource(resourceId.replace(/^\/+/, ''), query, timespan);
        if (result?.status === LogsQueryResultStatus.PartialFailure || (result && 'partialError' in result)) {
            partialFailure = true;
            // Pass only the explicit SDK error, never partial tables (which can contain document/query data).
            throw result.partialError;
        }
        const table = firstTable(result);
        if (!table) {
            throw new Error('Log query returned no valid result table.');
        }
        const requiredColumns: Partial<Record<LogsOperation, string[]>> = {
            crossPartition: ['QueryText', 'executions', 'avgFanout', 'maxFanout'],
            ingestionSummary: ['totalRu', 'writeRu', 'reqs', 'throttles'],
            ingestionBurst: ['peak', 'avg'],
            ingestionUserAgent: ['UserAgent', 'n'],
            sharedThroughput: ['CollectionName', 'requests', 'throttled', 'ru'],
        };
        if (
            table.rows.length > 0 &&
            requiredColumns[operation]?.some((name) => !table.columnDescriptors.some((column) => column.name === name))
        ) {
            throw new Error('Log query returned an incomplete result schema.');
        }
        return tableToRecords(table);
    } catch (error) {
        const diagnostic = createLogsDiagnostic(error, operation, {
            partialFailure,
            sensitiveValues: [
                resourceId,
                resourceId.replace(/^\/+/, ''),
                ...resourceId
                    .replace(/^\/+/, '')
                    .split('/')
                    .filter((_, index) => index === 1 || index === 3 || (index >= 7 && index % 2 === 1)),
                query,
                ...sensitiveValues,
            ],
        });
        try {
            onDiagnostic?.(diagnostic);
        } catch {
            // Output failures must not replace the classified query failure or leak a reporter's raw error.
            console.warn(
                `Log Analytics Output reporter failed (${diagnostic.operation}: ${diagnostic.kind}; ${diagnostic.reason}).`,
            );
        }
        throw new LogsFetchError(diagnostic);
    }
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
 * Classifies nested SDK errors without treating every semantic error as a missing diagnostic table.
 * Only explicit missing-CDB-table evidence means `logAnalyticsDisabled`; other query failures remain `noData`.
 */
export function classifyLogsError(error: unknown): UnavailableReason {
    return classifyLogsFailure(error).reason;
}

/**
 * Probes one required resource-specific table without retrieving log rows. Success means the table query completed,
 * not that every backing workspace is accessible or that the time window contains data. Each table gates its own
 * detectors; missing-table failures retain the legacy `logAnalyticsDisabled` reason without asserting logs are disabled.
 */
export async function probeCdbLogs(
    executor: LogsQueryExecutor,
    resourceId: string,
    timespan: LogsTimespan,
    options?: {
        onDiagnostic?: LogsDiagnosticReporter;
        table?: 'CDBDataPlaneRequests' | 'CDBQueryRuntimeStatistics';
    },
): Promise<{ available: boolean; reason?: UnavailableReason }> {
    const table = options?.table ?? 'CDBDataPlaneRequests';
    try {
        await executeLogsQuery(
            executor,
            resourceId,
            `${table} | take 0`,
            timespan,
            table === 'CDBDataPlaneRequests' ? 'probeDataPlane' : 'probeQueryRuntime',
            [],
            options?.onDiagnostic,
        );
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
    onDiagnostic?: LogsDiagnosticReporter,
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
    const rows = await executeLogsQuery(
        executor,
        resourceId,
        kql,
        timespan,
        'crossPartition',
        [databaseId, containerId, db, coll],
        onDiagnostic,
    );
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
    onDiagnostic?: LogsDiagnosticReporter,
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
        `| summarize ru = sum(RequestCharge) by bin(TimeGenerated, ${DIAGNOSTIC_POLICY.ingestion.burstInterval}) ` +
        '| summarize peak = max(ru), avg = avg(ru)';
    const uaKql = base + `| where OperationName in (${writes}) ` + '| summarize n = count() by UserAgent | top 1 by n';

    const results = await Promise.allSettled([
        executeLogsQuery(
            executor,
            resourceId,
            aggKql,
            timespan,
            'ingestionSummary',
            [databaseId, containerId, db, coll],
            onDiagnostic,
        ),
        executeLogsQuery(
            executor,
            resourceId,
            burstKql,
            timespan,
            'ingestionBurst',
            [databaseId, containerId, db, coll],
            onDiagnostic,
        ),
        executeLogsQuery(
            executor,
            resourceId,
            uaKql,
            timespan,
            'ingestionUserAgent',
            [databaseId, containerId, db, coll],
            onDiagnostic,
        ),
    ]);

    // Wait for every query's diagnostic before the collector handles this fetcher's failure.
    const [agg, burst, ua] = results.map((result) => {
        if (result.status === 'rejected') {
            throw result.reason;
        }
        return result.value;
    });

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
    onDiagnostic?: LogsDiagnosticReporter,
): Promise<SharedThroughputInput> {
    const db = kqlLiteral(databaseId);
    const kql =
        'CDBDataPlaneRequests ' +
        `| where DatabaseName == '${db}' and isnotempty(CollectionName) ` +
        '| summarize requests = count(), throttled = countif(StatusCode == 429), ru = sum(RequestCharge) ' +
        'by CollectionName';
    const rows = await executeLogsQuery(
        executor,
        resourceId,
        kql,
        timespan,
        'sharedThroughput',
        [databaseId, db],
        onDiagnostic,
    );
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
