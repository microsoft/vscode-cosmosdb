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
    pending: Set<Promise<unknown>>;
    reportedErrors: WeakSet<object>;
}

const readContext = new AsyncLocalStorage<ReadContext>();

/** Collects bounded read diagnostics without changing RPC results or passing telemetry contexts to readers. */
export async function withReadDiagnostics<T>(
    work: () => Promise<T>,
): Promise<{ result: T; diagnostics: ReadFailure[] }> {
    const context: ReadContext = { failures: [], pending: new Set(), reportedErrors: new WeakSet() };

    return readContext.run(context, async () => {
        try {
            return { result: await work(), diagnostics: context.failures };
        } finally {
            // A fail-fast reader can finish before sibling requests have reported their errors.
            while (context.pending.size > 0) {
                await Promise.allSettled(context.pending);
            }
        }
    });
}

/** Records bounded categories only; no file contents, paths, or names are emitted. */
export function recordReadDiagnostic(source: ReadSource, diagnostic: Pick<LogsDiagnostic, 'kind' | 'reason'>): void {
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

/** Records bounded categories only; no file contents, paths, or names are emitted. */
export function reportReadFailure(source: ReadSource, error: unknown): void {
    if (error && typeof error === 'object') {
        readContext.getStore()?.reportedErrors.add(error);
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
    const context = readContext.getStore();
    let pending: Promise<T> | undefined;

    try {
        pending = work();
        context?.pending.add(pending);
        return await pending;
    } catch (error) {
        reportUncaughtReadFailure(source, error);
        throw error;
    } finally {
        if (pending) {
            context?.pending.delete(pending);
        }
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
    return readRequest('metrics', async () => {
        const response = await client.metrics.list(resourceUri, options);

        for (const metric of response.value ?? []) {
            if (metric.errorCode && metric.errorCode !== 'Success') {
                reportReadFailure('metrics', { code: metric.errorCode, message: metric.errorMessage });
            }
        }

        return response;
    });
}
