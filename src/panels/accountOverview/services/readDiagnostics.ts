/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { RestError } from '@azure/core-rest-pipeline';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type ReadDiagnosticsResult, type ReadFailure, type ReadSource } from '../accessRequirements';
import { getResourceMaskedValues } from '../resourceMasking';
import { type MetricSourceStatus } from './advisories/core/types';
import {
    classifyLogsFailure,
    createLogsDiagnostic,
    formatErrorDiagnostic,
    type ErrorDiagnostic,
} from './advisories/fetchers/logsDiagnostics';
import { type UnavailableReason } from './shared';

interface ReadContext {
    failures: ReadFailure[];
    emitted: Set<string>;
    reportedErrors: WeakSet<object>;
    sensitiveValues: readonly string[];
    warn: (message: string) => void;
}

// SDK clients are shared, but diagnostics and masks belong to one RPC invocation, including its concurrent reads.
const readContext = new AsyncLocalStorage<ReadContext>();

export async function withReadDiagnostics<T extends object>(
    source: ReadSource,
    sensitiveValues: readonly string[],
    warn: (message: string) => void,
    work: () => Promise<T>,
    fallback?: (reason: UnavailableReason) => T,
): Promise<T & ReadDiagnosticsResult> {
    const context: ReadContext = {
        failures: [],
        emitted: new Set(),
        reportedErrors: new WeakSet(),
        sensitiveValues,
        warn,
    };
    return readContext.run(context, async () => {
        let result: T;
        try {
            result = await work();
        } catch (error) {
            reportUncaughtReadFailure(source, 'acquireClient', error);
            if (!fallback) {
                // Never send the original SDK response or local diagnostic messages to incidental RPC telemetry.
                throw new Error(`Account Overview read failed (${source}: ${classifyLogsFailure(error).kind}).`);
            }
            result = fallback(classifyLogsFailure(error).reason);
        }
        return context.failures.length ? { ...result, diagnostics: context.failures } : result;
    });
}

/** Records categories for the UI only. Detailed messages must never be attached to RPC results or telemetry. */
export function recordReadFailure(source: ReadSource, diagnostic: ErrorDiagnostic<string>): void {
    const context = readContext.getStore();
    if (
        context &&
        !context.failures.some(
            (failure) =>
                failure.source === source && failure.kind === diagnostic.kind && failure.reason === diagnostic.reason,
        )
    ) {
        context.failures.push({ source, kind: diagnostic.kind, reason: diagnostic.reason });
    }
}

/** Sanitized local Output only; no contents, paths, names or diagnostic messages are emitted as telemetry. */
export function reportReadFailure(
    source: ReadSource,
    operation: string,
    error: unknown,
    sensitiveValues: readonly string[] = [],
): void {
    const context = readContext.getStore();
    if (!context) {
        return;
    }
    if (error && typeof error === 'object') {
        context.reportedErrors.add(error);
    }
    const diagnostic = createLogsDiagnostic(error, operation, {
        sensitiveValues: [...context.sensitiveValues, ...getResourceMaskedValues(sensitiveValues)],
    });
    recordReadFailure(source, diagnostic);
    const scope = ['activityLog', 'advisor', 'alerts', 'alertCounts'].includes(source) ? 'subscription' : 'resource';
    const line = formatErrorDiagnostic(diagnostic, `[Account Overview][${source}]`, scope);
    writeReadOutput(line);
}

function writeReadOutput(line: string): void {
    const context = readContext.getStore();
    if (!context) {
        return;
    }
    if (!context.emitted.has(line)) {
        context.emitted.add(line);
        try {
            context.warn(line);
        } catch {
            console.warn('Account Overview Output channel failed; sanitized diagnostic follows.');
            console.warn(line);
        }
    }
}

/** Local coverage diagnostics only; no file contents, paths, or names are emitted as telemetry. */
export function reportMetricCoverage(source: MetricSourceStatus | undefined): void {
    if (!source || source.available) {
        return;
    }
    const groups = new Map<string, { failure: MetricSourceStatus['failures'][number]; count: number }>();
    for (const failure of source.failures) {
        const key = `${failure.rule}:${failure.reason}`;
        groups.set(key, { failure, count: (groups.get(key)?.count ?? 0) + 1 });
    }
    for (const { failure, count } of groups.values()) {
        const detail =
            failure.reason === 'noData'
                ? 'No usable metric observations were available. Requests can succeed with empty or incomplete data; this is not evidence of missing permissions.'
                : failure.reason === 'unsupported'
                  ? 'This check is not supported for this account.'
                  : 'See request diagnostics for the failure details.';
        writeReadOutput(
            `[Account Overview][metrics] operation=advisoryCheck; rule=${failure.rule}; reason=${failure.reason}; skippedChecks=${count}; ${detail}`,
        );
    }
}

export function reportUncaughtReadFailure(source: ReadSource, operation: string, error: unknown): void {
    const context = readContext.getStore();
    if (!context || (error && typeof error === 'object' && context.reportedErrors.has(error))) {
        return;
    }
    reportReadFailure(source, operation, error);
}

export function reportUnavailableClient(source: ReadSource): void {
    reportReadFailure(
        source,
        'client',
        new Error('The Azure read client could not be acquired. Check Azure sign-in and resource access.'),
    );
}

export async function readRequest<T>(
    source: ReadSource,
    operation: string,
    work: () => Promise<T>,
    sensitiveValues: readonly string[] = [],
): Promise<T> {
    try {
        return await work();
    } catch (error) {
        reportReadFailure(source, operation, error, sensitiveValues);
        throw error;
    }
}

export async function* readItems<T>(
    source: ReadSource,
    operation: string,
    work: () => AsyncIterable<T>,
    sensitiveValues: readonly string[] = [],
): AsyncIterable<T> {
    try {
        yield* work();
    } catch (error) {
        reportReadFailure(source, operation, error, sensitiveValues);
        throw error;
    }
}

export async function readMetrics(
    client: MonitorClient,
    resourceUri: string,
    options?: Parameters<MonitorClient['metrics']['list']>[1],
    sensitiveValues: readonly string[] = [],
): ReturnType<MonitorClient['metrics']['list']> {
    return readRequest(
        'metrics',
        'metrics.list',
        async () => {
            const response = await client.metrics.list(resourceUri, options);
            const failed = response.value?.find((metric) => metric.errorCode && metric.errorCode !== 'Success');
            if (failed) {
                throw new RestError(failed.errorMessage ?? failed.errorCode ?? 'Metric request failed.', {
                    code: failed.errorCode,
                });
            }
            return response;
        },
        [resourceUri, ...sensitiveValues],
    );
}
