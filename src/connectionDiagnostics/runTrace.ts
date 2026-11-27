/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PipelineRequest, type PipelineResponse } from '@azure/core-rest-pipeline';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { type ObserveManagedIdentity } from '../cosmosdb/utils/managedIdentityUtils';
import { ext } from '../extensionVariables';
import { classifyAccessError, getHttpFailure } from './classify';
import { type DiagnosticsState, type FailureStage, getPrimaryDataCheck, type ProbeKind, type Step } from './model';

const maxHttpRequests = 16;

function requestOrigin(request: PipelineRequest): string | undefined {
    const url = URL.parse(request.url);
    return url?.protocol === 'https:' || url?.protocol === 'http:' ? url.origin : undefined;
}

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
    private readonly localLines: string[] = [];
    private readonly requests = new WeakMap<PipelineRequest, { start: number; origin?: string }>();
    private readonly stepStartedAt = new Map<Step, number>();
    private readonly stepEndedAt = new Map<Step, number>();
    private readonly checkDurations: Partial<Record<Step, number>> = {};
    private readonly finishedSteps = new Set<Step>();
    private httpRequests = 0;
    private httpResponsesWithoutRequest = 0;
    private authAttempts = 0;
    private proxyRecorded = false;
    private finished = false;

    public constructor(kind: DiagnosticsState['kind'], probe: ProbeKind) {
        this.write(`started target=${kind} probe=${probe}`);
    }

    public begin(step: Step): void {
        this.stepStartedAt.set(step, performance.now());
        this.write(`check=${step} started`);
    }

    public endTiming(step: Step): void {
        this.stepEndedAt.set(step, performance.now());
    }

    public recordRequest(request: PipelineRequest, endpoint: URL): void {
        if (this.finished || this.httpRequests > maxHttpRequests) return;
        if (++this.httpRequests > maxHttpRequests) {
            this.write('additional SDK requests omitted');
            return;
        }
        const origin = requestOrigin(request);
        const target = !origin ? 'unknown' : origin === endpoint.origin ? 'configured' : 'alternate';
        this.requests.set(request, { start: performance.now(), origin });
        this.write(
            `sdk target=${target} operation=${sdkStage(request) ?? 'other'} started sdkProxyConfigured=${!!request.proxySettings}`,
            origin ? ` endpoint=${origin}` : '',
        );
    }

    public recordResponse(response: PipelineResponse, endpoint: URL): void {
        if (this.finished) return;
        const entry = this.requests.get(response.request);
        if (!entry && (this.httpRequests > maxHttpRequests || this.httpResponsesWithoutRequest++ >= maxHttpRequests))
            return;
        const origin = entry?.origin ?? requestOrigin(response.request);
        const target = !origin ? 'unknown' : origin === endpoint.origin ? 'configured' : 'alternate';
        const operation = sdkStage(response.request) ?? 'other';
        const status = response.status;
        if (!Number.isInteger(status) || status < 100 || status > 599) return;
        const http = getHttpFailure({ statusCode: status, substatus: response.headers.get('x-ms-substatus') });
        const substatus = http?.substatus !== undefined ? ` substatus=${http.substatus}` : '';
        const duration = entry ? ` durationMs=${Math.round(performance.now() - entry.start)}` : '';
        const activity = response.headers.get('x-ms-activity-id');
        const activityId = activity && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(activity) ? activity : '';
        this.write(
            `sdk target=${target} operation=${operation} status=${status}${substatus}${duration}`,
            `${origin ? ` endpoint=${origin}` : ''}${activityId ? ` activityId=${activityId}` : ''}`,
        );
    }

    public recordTransportError(request: PipelineRequest, error: unknown): void {
        const entry = this.requests.get(request);
        if (this.finished || !entry) return;
        this.write(
            `sdk operation=${sdkStage(request) ?? 'other'} transport=${classifyAccessError(error).finding} durationMs=${Math.round(performance.now() - entry.start)}`,
            entry.origin ? ` endpoint=${entry.origin}` : '',
        );
    }

    public recordProxyConfiguration(mode: unknown, configured: boolean, strictSSL: boolean): void {
        if (this.finished || this.proxyRecorded) return;
        this.proxyRecorded = true;
        const support =
            mode === 'off' || mode === 'on' || mode === 'override' || mode === 'fallback' ? mode : 'unknown';
        const env = process.env;
        const proxyEnvConfigured = !!(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy);
        this.write(
            `proxy vscodeSupport=${support} vscodeProxyConfigured=${configured} proxyEnvConfigured=${proxyEnvConfigured} noProxyEnvConfigured=${!!(env.NO_PROXY || env.no_proxy)} vscodeStrictSSL=${strictSSL}`,
        );
    }

    public recordAuthenticationAttempt(
        method: NonNullable<DiagnosticsState['checks'][number]['auth']>,
        outcome: 'succeeded' | 'unavailable' | 'failed',
        selector?: 'default' | 'clientId',
    ): void {
        if (this.finished || this.authAttempts++ >= 16) return;
        this.write(`auth attempt=${method} outcome=${outcome}${selector ? ` identitySelector=${selector}` : ''}`);
    }

    public readonly recordManagedIdentity: ObserveManagedIdentity = (outcome, selector) => {
        if (!this.finished) {
            this.write(`auth managedIdentityDiscovery=${outcome}${selector ? ` identitySelector=${selector}` : ''}`);
        }
    };

    public recordEndpoint(endpoint: URL): void {
        this.writeLocal(`configured endpoint=${endpoint.origin}`);
    }

    public recordDns(endpoint: URL, addresses: readonly string[]): void {
        const ips = addresses.filter((address) => isIP(address)).slice(0, 16);
        this.writeLocal(`dns endpoint=${endpoint.origin} addresses=${ips.length ? ips.join(',') : 'none'}`);
    }

    public recordChecks(checks: DiagnosticsState['checks']): void {
        for (const { step, finding, status, auth, failureStage, observedClientIp, networkDiagnosis } of checks) {
            if (this.finishedSteps.has(step)) continue;
            this.finishedSteps.add(step);
            const startedAt = this.stepStartedAt.get(step);
            const endedAt = this.stepEndedAt.get(step) ?? performance.now();
            const durationMs = startedAt === undefined ? undefined : Math.round(endedAt - startedAt);
            if (durationMs !== undefined) this.checkDurations[step] = durationMs;
            const duration = durationMs === undefined ? '' : ` durationMs=${durationMs}`;
            const stage = failureStage ? ` stage=${failureStage}` : '';
            const network = networkDiagnosis ? ` network=${networkDiagnosis}` : '';
            this.write(
                `check=${step} status=${status} finding=${finding}${auth ? ` auth=${auth}` : ''}${stage}${duration}${network}`,
                observedClientIp && isIP(observedClientIp) ? ` observedClientIp=${observedClientIp}` : '',
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

    public localSnapshot(): readonly string[] {
        return [...this.localLines];
    }

    private write(line: string, outputOnly = ''): void {
        this.lines.push(line);
        this.writeLocal(`${line}${outputOnly}`);
    }

    private writeLocal(line: string): void {
        this.localLines.push(line);
        ext.outputChannel.info(`[Connection diagnostics] run=${this.runId} ${line}`);
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
        const evaluated = getPrimaryDataCheck(state);
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
