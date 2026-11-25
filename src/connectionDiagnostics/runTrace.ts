/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PipelineRequest, type PipelineResponse } from '@azure/core-rest-pipeline';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'node:crypto';
import { ext } from '../extensionVariables';
import { getHttpFailure } from './classify';
import { type DiagnosticsState, type FailureStage, type ProbeKind, type Step } from './model';

const maxHttpResponses = 16;

export function sdkStage(request: PipelineRequest): FailureStage | undefined {
    const path = URL.parse(request.url)?.pathname;
    if (path === '/') return 'accountMetadata';
    if (path === '/dbs') return 'listDatabases';
    if (path && /^\/dbs\/[^/]+\/colls\/[^/]+\/docs\/?$/.test(path) && request.method === 'POST') return 'query';
    if (path && /^\/dbs\/[^/]+\/colls\/[^/]+(?:\/|$)/.test(path)) return 'containerMetadata';
    return undefined;
}

export class DiagnosticsRunTrace {
    public readonly runId = randomUUID();
    private readonly startedAt = performance.now();
    private readonly lines: string[] = [];
    private readonly stepStartedAt = new Map<Step, number>();
    private readonly checkDurations: Partial<Record<Step, number>> = {};
    private readonly finishedSteps = new Set<Step>();
    private httpResponses = 0;
    private finished = false;

    public constructor(kind: DiagnosticsState['kind'], probe: ProbeKind) {
        this.write(`started target=${kind} probe=${probe}`);
    }

    public begin(step: Step): void {
        this.stepStartedAt.set(step, performance.now());
        this.write(`check=${step} started`);
    }

    public recordResponse(response: PipelineResponse, endpoint: URL): void {
        if (this.finished || this.httpResponses > maxHttpResponses) return;
        if (++this.httpResponses > maxHttpResponses) {
            this.write('additional SDK responses omitted');
            return;
        }
        const url = URL.parse(response.request.url);
        const origin = url?.protocol === 'https:' || url?.protocol === 'http:' ? url.origin : undefined;
        const target = !origin ? 'unknown' : origin === endpoint.origin ? 'configured' : 'alternate';
        const operation = sdkStage(response.request) ?? 'other';
        const status = response.status;
        if (!Number.isInteger(status) || status < 100 || status > 599) return;
        const http = getHttpFailure({ statusCode: status, substatus: response.headers.get('x-ms-substatus') });
        const substatus = http?.substatus !== undefined ? ` substatus=${http.substatus}` : '';
        this.write(
            `sdk target=${target} operation=${operation} status=${status}${substatus}`,
            origin && status >= 400 ? ` endpoint=${origin}` : '',
        );
    }

    public recordChecks(checks: DiagnosticsState['checks']): void {
        for (const { step, finding, status, auth, failureStage } of checks) {
            if (this.finishedSteps.has(step)) continue;
            this.finishedSteps.add(step);
            const startedAt = this.stepStartedAt.get(step);
            const durationMs = startedAt === undefined ? undefined : Math.round(performance.now() - startedAt);
            if (durationMs !== undefined) this.checkDurations[step] = durationMs;
            const duration = durationMs === undefined ? '' : ` durationMs=${durationMs}`;
            const stage = failureStage ? ` stage=${failureStage}` : '';
            this.write(
                `check=${step} status=${status} finding=${finding}${auth ? ` auth=${auth}` : ''}${stage}${duration}`,
            );
        }
    }

    public complete(phase: 'completed' | 'cancelled'): number {
        this.finished = true;
        const durationMs = Math.round(performance.now() - this.startedAt);
        this.write(`finished phase=${phase} durationMs=${durationMs}`);
        return durationMs;
    }

    public snapshot(): NonNullable<DiagnosticsState['trace']> {
        return { runId: this.runId, lines: [...this.lines], checkDurations: { ...this.checkDurations } };
    }

    private write(line: string, outputOnly = ''): void {
        this.lines.push(line);
        ext.outputChannel.info(`[Connection diagnostics] run=${this.runId} ${line}${outputOnly}`);
    }
}

/** Records bounded run metadata; no file contents, paths, or names are emitted. */
export async function reportDiagnosticsOutcome(
    state: DiagnosticsState,
    probe: ProbeKind,
    durationMs: number,
): Promise<void> {
    await callWithTelemetryAndErrorHandling('cosmosDB.diagnostics.run', (context) => {
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = false;
        context.telemetry.maskEntireErrorMessage = true;
        const access = state.checks.find(({ step }) => step === 'access');
        const query = state.checks.find(({ step }) => step === 'query');
        const evaluated = query?.status === 'skipped' ? access : (query ?? access);
        const outcome =
            state.phase === 'cancelled'
                ? 'cancelled'
                : evaluated?.status === 'passed'
                  ? 'connected'
                  : evaluated?.status === 'failed' || evaluated?.finding === 'dataRbac'
                    ? 'failed'
                    : 'notTested';
        if (state.trace) context.telemetry.properties.diagnosticsRunId = state.trace.runId;
        context.telemetry.properties.targetKind = state.kind;
        context.telemetry.properties.probeKind = probe;
        context.telemetry.properties.connectionOutcome = outcome;
        context.telemetry.properties.authMethod = access?.auth ?? 'none';
        if (evaluated?.failureStage) context.telemetry.properties.failureStage = evaluated.failureStage;
        context.telemetry.properties.findingCodes = state.checks.map(({ finding }) => finding).join(',');
        if (state.phase === 'cancelled') context.telemetry.properties.result = 'Canceled';
        context.telemetry.measurements.durationMs = durationMs;
        context.telemetry.measurements.checkCount = state.checks.length;
    });
}
