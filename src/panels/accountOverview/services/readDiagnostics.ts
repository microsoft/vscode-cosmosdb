/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';
import { AsyncLocalStorage } from 'node:async_hooks';
import { classifyLogsFailure, type LogsDiagnostic, type LogsFailureKind } from './advisories/fetchers/logsDiagnostics';
import { type UnavailableReason } from './shared';

export const READ_SOURCES = [
    'account',
    'inventory',
    'metrics',
    'activityLog',
    'advisor',
    'alerts',
    'alertCounts',
    'logs',
] as const;
export type ReadSource = (typeof READ_SOURCES)[number];

export interface ReadFailure {
    source: ReadSource;
    kind: LogsFailureKind;
    reason: UnavailableReason;
}

interface ReadContext {
    failures: ReadFailure[];
    reportedErrors: WeakSet<object>;
    parent?: ReadContext;
    requiredMetrics?: ReadonlySet<string>;
    metric?: string;
}

const readContext = new AsyncLocalStorage<ReadContext>();

/** Snapshots bounded diagnostics when work completes, without delaying results for unfinished sibling reads. */
export async function withReadDiagnostics<T>(
    work: () => Promise<T>,
    requiredMetrics?: readonly string[],
): Promise<{ result: T; diagnostics: ReadFailure[] }> {
    const context: ReadContext = {
        failures: [],
        reportedErrors: new WeakSet(),
        parent: readContext.getStore(),
        requiredMetrics: requiredMetrics && new Set(requiredMetrics),
    };

    return readContext.run(context, async () => ({
        result: await work(),
        diagnostics: [...context.failures],
    }));
}

/** Records bounded categories only; no file contents, paths, or names are emitted. */
export function recordReadDiagnostic(source: ReadSource, diagnostic: Pick<LogsDiagnostic, 'kind' | 'reason'>): void {
    const metric = readContext.getStore()?.metric;

    for (let context = readContext.getStore(); context; context = context.parent) {
        if (source === 'metrics' && context.requiredMetrics && (!metric || !context.requiredMetrics.has(metric))) {
            continue;
        }
        if (
            !context.failures.some(
                (failure) =>
                    failure.source === source &&
                    failure.kind === diagnostic.kind &&
                    failure.reason === diagnostic.reason,
            )
        ) {
            context.failures.push({ source, kind: diagnostic.kind, reason: diagnostic.reason });
        }
    }
}

/** Records bounded categories only; no file contents, paths, or names are emitted. */
export function reportReadFailure(source: ReadSource, error: unknown): void {
    if (error && typeof error === 'object') {
        for (let context = readContext.getStore(); context; context = context.parent) {
            context.reportedErrors.add(error);
        }
    }
    recordReadDiagnostic(source, classifyLogsFailure(error));
}

/** Reports previously unrecorded failures; no file contents, paths, or names are emitted. */
export function reportUncaughtReadFailure(source: ReadSource, error: unknown): void {
    if (error && typeof error === 'object' && readContext.getStore()?.reportedErrors.has(error)) {
        return;
    }
    reportReadFailure(source, error);
}

/** Records missing-client coverage; no file contents, paths, or names are emitted. */
export function reportUnavailableClient(source: ReadSource): void {
    recordReadDiagnostic(source, { kind: 'clientUnavailable', reason: 'noData' });
}

export async function readRequest<T>(source: ReadSource, work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (error) {
        reportUncaughtReadFailure(source, error);
        throw error;
    }
}

export async function* readItems<T>(source: ReadSource, work: () => AsyncIterable<T>): AsyncIterable<T> {
    try {
        yield* work();
    } catch (error) {
        reportReadFailure(source, error);
        throw error;
    }
}

export async function readMetrics(
    client: MonitorClient,
    resourceUri: string,
    options?: Parameters<MonitorClient['metrics']['list']>[1],
): ReturnType<MonitorClient['metrics']['list']> {
    const read = () =>
        readRequest('metrics', async () => {
            const response = await client.metrics.list(resourceUri, options);

            for (const metric of response.value ?? []) {
                if (metric.errorCode && metric.errorCode !== 'Success') {
                    reportReadFailure('metrics', { code: metric.errorCode, message: metric.errorMessage });
                }
            }

            return response;
        });
    const context = readContext.getStore();

    return context ? readContext.run({ ...context, metric: options?.metricnames }, read) : read();
}
