/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogsQueryResultStatus, type LogsQueryResult, type LogsTable } from '@azure/monitor-query-logs';
import { type UnavailableReason } from '../../shared';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import {
    type CollectionTrafficInput,
    type ConsistencyReadRuInput,
    type CrossPartitionInput,
    type QueryShapeInput,
    type RequestLogEvidence,
    type SharedThroughputInput,
    type UncontrolledIngestionInput,
} from '../core/types';
import {
    classifyLogsFailure,
    createLogsDiagnostic,
    LogsFetchError,
    type LogsDiagnostic,
    type LogsDiagnosticReporter,
    type LogsOperation,
} from './logsDiagnostics';

export type DataPlaneSource = RequestLogEvidence['sourceTable'];
const AGGREGATE_BUCKET_MS = 5 * 60 * 1000;

// ─── Tier-2 (Log Analytics) data path ─────────────────────────────────────────────
//
// The Tier-2 detectors (DX-002 cross-partition fan-out, DX-007 shard-key misalignment, DX-010 uncontrolled
// ingestion, DX-003 shared-throughput starvation) read the `CDB*` diagnostic-log tables via resource-centric
// Log Analytics queries. This module runs native KQL, folds the rows into the plain input shapes the pure
// detector evaluations consume, and classifies "logs unavailable" into an {@link UnavailableReason}.
// The card can render Tier-1 while flagging that Tier-2 was skipped. This module is `@azure/arm-monitor`-free,
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

export function requestLogWindow(source: DataPlaneSource, now = Date.now()): LogsTimespan {
    return logWindow(
        source === 'CDBDataPlaneRequests5M' ? Math.floor(now / AGGREGATE_BUCKET_MS) * AGGREGATE_BUCKET_MS : now,
    );
}

function requestLogEvidence(source: DataPlaneSource, timespan: LogsTimespan): RequestLogEvidence {
    return {
        sourceTable: source,
        sourceResolution: source === 'CDBDataPlaneRequests5M' ? 'PT5M' : 'perRequest',
        observationStart: timespan.startTime.toISOString(),
        observationEnd: timespan.endTime.toISOString(),
    };
}

/** Strips single quotes from a value interpolated into a KQL string literal, mirroring CODA's `.replace("'", "")`. */
function kqlLiteral(value: string): string {
    return value.replace(/'/g, '');
}

function singleDestinationTable(table: DataPlaneSource | 'CDBQueryRuntimeStatistics', timespan: LogsTimespan): string {
    const bounds =
        `| where TimeGenerated >= datetime(${timespan.startTime.toISOString()}) ` +
        `and TimeGenerated < datetime(${timespan.endTime.toISOString()}) `;
    // Choose account-wide before workload filters so every query uses the same ranking of diagnostic copies.
    return (
        `${table} ${bounds}` +
        `| where TenantId == toscalar(${table} ${bounds}` +
        '| summarize destinationRows = count() by TenantId ' +
        '| sort by destinationRows desc, TenantId asc | take 1 | project TenantId) '
    );
}

function requestTable(source: DataPlaneSource, timespan: LogsTimespan): string {
    if (
        source === 'CDBDataPlaneRequests5M' &&
        [timespan.startTime, timespan.endTime].some((time) => time.getTime() % AGGREGATE_BUCKET_MS !== 0)
    ) {
        throw new Error('Five-minute request logs require five-minute-aligned observation boundaries.');
    }
    return singleDestinationTable(source, timespan);
}

function requestCharge(source: DataPlaneSource): string {
    return source === 'CDBDataPlaneRequests5M' ? 'TotalRequestCharge' : 'RequestCharge';
}

function requestCount(source: DataPlaneSource, predicate?: string): string {
    if (source === 'CDBDataPlaneRequests5M') {
        return predicate ? `sumif(RequestCount, ${predicate})` : 'sum(RequestCount)';
    }
    return predicate ? `countif(${predicate})` : 'count()';
}

function invalidAggregates(source: DataPlaneSource): string {
    return source === 'CDBDataPlaneRequests5M'
        ? ', invalidRows = countif(isnull(RequestCount) or RequestCount <= 0 ' +
              'or floor(RequestCount, 1.0) != RequestCount or not(isfinite(todouble(RequestCount))) ' +
              'or isnull(TotalRequestCharge) or TotalRequestCharge < 0 or not(isfinite(TotalRequestCharge)) ' +
              'or TimeGenerated != bin(TimeGenerated, 5m))'
        : '';
}

function validNumber(value: unknown, integer = false): value is number {
    return (
        typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!integer || Number.isSafeInteger(value))
    );
}

function validateAggregates(
    source: DataPlaneSource,
    rows: Record<string, unknown>[],
    counts: readonly string[],
    charges: readonly string[],
): void {
    if (source === 'CDBDataPlaneRequests') {
        return;
    }
    for (const row of rows) {
        if (
            row.invalidRows !== 0 ||
            counts.some((key) => !validNumber(row[key], true)) ||
            charges.some((key) => !validNumber(row[key]))
        ) {
            throw new Error('Five-minute request logs returned invalid or unchecked aggregates.');
        }
    }
}

function reportDiagnostic(diagnostic: LogsDiagnostic, onDiagnostic?: LogsDiagnosticReporter): void {
    try {
        onDiagnostic?.(diagnostic);
    } catch {
        console.warn(
            `Log Analytics Output reporter failed (${diagnostic.operation}: ${diagnostic.kind}; ${diagnostic.reason}).`,
        );
    }
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
    validateRows?: (rows: Record<string, unknown>[]) => void,
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
            crossPartitionRu: ['QueryText', 'executions', 'matchedExecutions', 'totalQueryRu'],
            consistencyReadRu: ['OperationName', 'requests', 'ru', 'invalidRows'],
        };
        if (
            table.rows.length > 0 &&
            requiredColumns[operation]?.some((name) => !table.columnDescriptors.some((column) => column.name === name))
        ) {
            throw new Error('Log query returned an incomplete result schema.');
        }
        const rows = tableToRecords(table);
        validateRows?.(rows);
        return rows;
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
        reportDiagnostic(diagnostic, onDiagnostic);
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
        table?: DataPlaneSource | 'CDBQueryRuntimeStatistics';
    },
): Promise<{ available: boolean; reason?: UnavailableReason }> {
    const table = options?.table ?? 'CDBDataPlaneRequests';
    try {
        await executeLogsQuery(
            executor,
            resourceId,
            `${table} | take 0`,
            timespan,
            table === 'CDBDataPlaneRequests'
                ? 'probeDataPlane'
                : table === 'CDBDataPlaneRequests5M'
                  ? 'probeDataPlane5M'
                  : 'probeQueryRuntime',
            [],
            options?.onDiagnostic,
        );
        return { available: true };
    } catch (error) {
        return { available: false, reason: classifyLogsError(error) };
    }
}

/** Prefer aggregates; only an explicitly missing table permits a raw compatibility probe. */
export async function selectDataPlaneSource(
    executor: LogsQueryExecutor,
    resourceId: string,
    timespan: LogsTimespan,
    onDiagnostic?: LogsDiagnosticReporter,
): Promise<DataPlaneSource | undefined> {
    const diagnostics: LogsDiagnostic[] = [];
    const aggregate = await probeCdbLogs(executor, resourceId, timespan, {
        table: 'CDBDataPlaneRequests5M',
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    if (aggregate.available) {
        return 'CDBDataPlaneRequests5M';
    }
    if (diagnostics[0]?.kind === 'missingTable') {
        const raw = await probeCdbLogs(executor, resourceId, timespan, { onDiagnostic });
        if (raw.available) {
            return 'CDBDataPlaneRequests';
        }
    }
    for (const diagnostic of diagnostics) {
        reportDiagnostic(diagnostic, onDiagnostic);
    }
    return undefined;
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
    includeRequestCharge = false,
): Promise<CrossPartitionInput> {
    const db = kqlLiteral(databaseId);
    const coll = kqlLiteral(containerId);
    const kql =
        singleDestinationTable('CDBQueryRuntimeStatistics', timespan) +
        `| where DatabaseName == '${db}' and CollectionName == '${coll}' ` +
        '| summarize partitionsHit = dcount(PartitionKeyRangeId) by CorrelatedActivityId, QueryText ' +
        '| summarize executions = count(), avgFanout = avg(partitionsHit), maxFanout = max(partitionsHit) ' +
        'by QueryText';
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
    if (includeRequestCharge && shapes.length > 0) {
        const chargeKql =
            singleDestinationTable('CDBQueryRuntimeStatistics', timespan) +
            `| where DatabaseName == '${db}' and CollectionName == '${coll}' ` +
            '| where isnotempty(CorrelatedActivityId) ' +
            '| distinct ActivityId, CorrelatedActivityId, QueryText ' +
            '| join kind=leftouter (' +
            singleDestinationTable('CDBDataPlaneRequests', timespan) +
            `| where DatabaseName == '${db}' and CollectionName == '${coll}' ` +
            '| where isnotempty(ActivityId) ' +
            '| summarize requestRu = sum(RequestCharge), ' +
            'invalidCharges = countif(isnull(RequestCharge) or RequestCharge < 0 or not(isfinite(RequestCharge))) ' +
            'by ActivityId) on ActivityId ' +
            '| summarize queryRu = sum(requestRu), missingRequests = countif(isnull(requestRu)), ' +
            'invalidCharges = sum(invalidCharges) by CorrelatedActivityId, QueryText ' +
            '| summarize executions = count(), matchedExecutions = countif(missingRequests == 0 and invalidCharges == 0), ' +
            'totalQueryRu = sumif(queryRu, missingRequests == 0 and invalidCharges == 0) by QueryText';
        try {
            const charges = await executeLogsQuery(
                executor,
                resourceId,
                chargeKql,
                timespan,
                'crossPartitionRu',
                [databaseId, containerId, db, coll],
                onDiagnostic,
                (values) => {
                    if (
                        new Set(values.map((row) => row.QueryText)).size !== values.length ||
                        values.some(
                            (row) =>
                                typeof row.QueryText !== 'string' ||
                                !validNumber(row.executions, true) ||
                                !validNumber(row.matchedExecutions, true) ||
                                row.matchedExecutions > row.executions ||
                                !validNumber(row.totalQueryRu),
                        )
                    ) {
                        throw new Error('Query request-charge enrichment returned invalid aggregates.');
                    }
                },
            );
            const chargesByText = new Map(charges.map((row) => [row.QueryText, row]));
            const nonemptyRows = rows.filter((row) => str(row.QueryText).length > 0);
            let incompleteMatches = false;
            for (const [index, shape] of shapes.entries()) {
                if (shape.executions === 0) {
                    continue;
                }
                const charge = chargesByText.get(nonemptyRows[index].QueryText);
                if (charge && charge.executions === shape.executions && charge.matchedExecutions === shape.executions) {
                    const avgRu = num(charge.totalQueryRu) / shape.executions;
                    if (Number.isFinite(avgRu)) {
                        shape.avgRu = avgRu;
                        continue;
                    }
                }
                incompleteMatches = true;
            }
            if (incompleteMatches) {
                reportDiagnostic(
                    createLogsDiagnostic(
                        new Error('Query request-charge enrichment has missing or incomplete execution matches.'),
                        'crossPartitionRu',
                        { partialFailure: true },
                    ),
                    onDiagnostic,
                );
            }
        } catch (error) {
            if (!(error instanceof LogsFetchError)) {
                throw error;
            }
            // The failed enrichment has already been reported; structural fan-out remains usable.
        }
    }
    return {
        databaseId,
        containerId,
        shapes,
        evaluationWindowSeconds: (timespan.endTime.getTime() - timespan.startTime.getTime()) / 1000,
        observationStart: timespan.startTime.toISOString(),
        observationEnd: timespan.endTime.toISOString(),
    };
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
 * RU split, weighted request and 429 counts, the source-grain write-RU burst factor, and dominant write-path `UserAgent`.
 * Returns the uncontrolled-ingestion evaluator's input (undefined when there is no data-plane telemetry).
 */
export async function fetchUncontrolledIngestion(
    executor: LogsQueryExecutor,
    resourceId: string,
    databaseId: string,
    containerId: string,
    timespan: LogsTimespan,
    onDiagnostic?: LogsDiagnosticReporter,
    source: DataPlaneSource = 'CDBDataPlaneRequests',
): Promise<UncontrolledIngestionInput | undefined> {
    const db = kqlLiteral(databaseId);
    const coll = kqlLiteral(containerId);
    const base = requestTable(source, timespan) + `| where DatabaseName == '${db}' and CollectionName == '${coll}' `;
    const writes = WRITE_OPS.map((w) => `'${w}'`).join(', ');
    const charge = requestCharge(source);
    const invalid = invalidAggregates(source);
    const aggKql =
        base +
        `| summarize totalRu = sum(${charge}), ` +
        `writeRu = sumif(${charge}, OperationName in (${writes})), ` +
        `reqs = ${requestCount(source)}, throttles = ${requestCount(source, 'StatusCode == 429')}${invalid}`;
    const burstInterval = source === 'CDBDataPlaneRequests5M' ? '5m' : DIAGNOSTIC_POLICY.ingestion.burstInterval;
    const burstKql =
        base +
        `| where OperationName in (${writes}) ` +
        `| summarize ru = sum(${charge})${invalid} by bin(TimeGenerated, ${burstInterval}) ` +
        '| summarize peak = max(ru), avg = avg(ru)' +
        (invalid ? ', invalidRows = sum(invalidRows)' : '');
    const uaKql =
        base +
        `| where OperationName in (${writes}) ` +
        `| summarize n = ${requestCount(source)}${invalid} by UserAgent | top 1 by n`;

    const results = await Promise.allSettled([
        executeLogsQuery(
            executor,
            resourceId,
            aggKql,
            timespan,
            'ingestionSummary',
            [databaseId, containerId, db, coll],
            onDiagnostic,
            (rows) => {
                validateAggregates(source, rows, ['reqs', 'throttles'], ['totalRu', 'writeRu']);
                if (
                    source === 'CDBDataPlaneRequests5M' &&
                    rows.some((row) => num(row.throttles) > num(row.reqs) || num(row.writeRu) > num(row.totalRu))
                ) {
                    throw new Error('Five-minute request logs returned inconsistent ingestion totals.');
                }
            },
        ),
        executeLogsQuery(
            executor,
            resourceId,
            burstKql,
            timespan,
            'ingestionBurst',
            [databaseId, containerId, db, coll],
            onDiagnostic,
            (rows) => {
                for (const row of rows) {
                    if (row.peak === null && (Number.isNaN(row.avg) || row.avg === 'NaN')) {
                        row.avg = null;
                    }
                }
                validateAggregates(
                    source,
                    rows,
                    [],
                    rows.every((row) => row.peak === null && row.avg === null) ? [] : ['peak', 'avg'],
                );
            },
        ),
        executeLogsQuery(
            executor,
            resourceId,
            uaKql,
            timespan,
            'ingestionUserAgent',
            [databaseId, containerId, db, coll],
            onDiagnostic,
            (rows) => validateAggregates(source, rows, ['n'], []),
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
        requestLogEvidence: requestLogEvidence(source, timespan),
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
    source: DataPlaneSource = 'CDBDataPlaneRequests',
): Promise<SharedThroughputInput> {
    const db = kqlLiteral(databaseId);
    const kql =
        requestTable(source, timespan) +
        `| where DatabaseName == '${db}' and isnotempty(CollectionName) ` +
        `| summarize requests = ${requestCount(source)}, throttled = ${requestCount(source, 'StatusCode == 429')}, ` +
        `ru = sum(${requestCharge(source)})${invalidAggregates(source)} ` +
        'by CollectionName';
    const rows = await executeLogsQuery(
        executor,
        resourceId,
        kql,
        timespan,
        'sharedThroughput',
        [databaseId, db],
        onDiagnostic,
        (rows) => {
            validateAggregates(source, rows, ['requests', 'throttled'], ['ru']);
            if (source === 'CDBDataPlaneRequests5M' && rows.some((row) => num(row.throttled) > num(row.requests))) {
                throw new Error('Five-minute request logs returned inconsistent shared-throughput totals.');
            }
        },
    );
    const collections: CollectionTrafficInput[] = rows
        .filter((r) => str(r.CollectionName).length > 0)
        .map((r) => ({
            containerId: str(r.CollectionName),
            requests: Math.round(num(r.requests)),
            throttledRequests: Math.round(num(r.throttled)),
            ruConsumed: num(r.ru),
        }));
    return { databaseId, sharedRu, collections, requestLogEvidence: requestLogEvidence(source, timespan) };
}

const READ_OPS = ['Read', 'Query', 'QueryPlan'] as const;

/** Optional account-wide observed read charge, not proof of request consistency or monetary savings. */
export async function fetchConsistencyReadRu(
    executor: LogsQueryExecutor,
    resourceId: string,
    timespan: LogsTimespan,
    onDiagnostic?: LogsDiagnosticReporter,
    source: DataPlaneSource = 'CDBDataPlaneRequests',
): Promise<ConsistencyReadRuInput> {
    const account = kqlLiteral(resourceId);
    const charge = requestCharge(source);
    const kql =
        requestTable(source, timespan) +
        `| where _ResourceId =~ '${account}' ` +
        `| where OperationName in (${READ_OPS.map((operation) => `'${operation}'`).join(', ')}) ` +
        `| summarize requests = ${requestCount(source)}, ru = sum(${charge}), ` +
        `invalidRows = countif(isnull(${charge}) or ${charge} < 0 or not(isfinite(${charge}))` +
        (source === 'CDBDataPlaneRequests5M'
            ? ' or isnull(RequestCount) or RequestCount <= 0 or floor(RequestCount, 1.0) != RequestCount ' +
              'or not(isfinite(todouble(RequestCount))) or TimeGenerated != bin(TimeGenerated, 5m)'
            : '') +
        ') by OperationName';
    const rows = await executeLogsQuery(
        executor,
        resourceId,
        kql,
        timespan,
        'consistencyReadRu',
        [account],
        onDiagnostic,
        (values) => {
            if (
                new Set(values.map((row) => row.OperationName)).size !== values.length ||
                values.some(
                    (row) =>
                        !READ_OPS.some((operation) => operation === row.OperationName) ||
                        row.invalidRows !== 0 ||
                        !validNumber(row.requests, true) ||
                        row.requests === 0 ||
                        !validNumber(row.ru),
                )
            ) {
                throw new Error('Consistency read-charge query returned invalid aggregates.');
            }
            const totalRu = values.reduce((sum, row) => sum + num(row.ru), 0);
            const totalRequests = values.reduce((sum, row) => sum + num(row.requests), 0);
            if (!validNumber(totalRu) || !validNumber(totalRequests, true)) {
                throw new Error('Consistency read-charge query totals exceeded numeric limits.');
            }
        },
    );
    const readRequests = rows.reduce((sum, row) => sum + num(row.requests), 0);
    return {
        ...requestLogEvidence(source, timespan),
        status: readRequests > 0 ? 'observed' : 'noObservations',
        readRequests,
        readRu: rows.reduce((sum, row) => sum + num(row.ru), 0),
    };
}
