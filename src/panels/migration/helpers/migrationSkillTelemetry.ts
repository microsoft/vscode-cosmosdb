/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'node:crypto';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { type ModelInfo } from '../../../utils/modelUtils';
import { type MigrationExecution } from '../../../webviews/cosmosdb/Migration/state/deriveMigrationPhaseStates';
import { type MigrationSkillInvocation, type MigrationSkillPhase } from './migrationSkillDispatcher';
import { type MigrationPhaseCompletionMap } from './migrationStateSync';
import {
    getMigrationTelemetryProperties,
    migrationApplicationTelemetryKeys,
    type MigrationPhaseKey,
} from './migrationTelemetry';
import { collectMigrationTelemetryEvidence } from './migrationTelemetryEvidence';

const phaseKeys: Record<MigrationSkillPhase, MigrationPhaseKey> = {
    preflight: 'preflight',
    discovery: 'discovery',
    assessment: 'assessment',
    'schema-conversion': 'schemaConversion',
    provisioning: 'provisioning',
    'code-migration': 'codeMigration',
};

function telemetryPhase(invocation: MigrationSkillInvocation): MigrationPhaseKey | undefined {
    return invocation.preflightStep === 'application-details'
        ? 'discovery'
        : invocation.phase && Object.hasOwn(phaseKeys, invocation.phase)
          ? phaseKeys[invocation.phase]
          : undefined;
}

export function migrationOperationEvent(invocation: MigrationSkillInvocation): string {
    if (invocation.intent === 'review-and-fix') return 'cosmosDB.migration.review';
    if (invocation.preflightStep === 'application-details') return 'cosmosDB.migration.phase1.analysis';
    if (invocation.provisioningStep === 'target-account') return 'cosmosDB.migration.phase4.accountProvisioning';
    if (invocation.provisioningStep === 'resources-and-data') return 'cosmosDB.migration.phase4.sampleDataPopulation';
    switch (invocation.phase) {
        case 'preflight':
            return 'cosmosDB.migration.phase1.preflight';
        case 'discovery':
            return 'cosmosDB.migration.phase1.discovery';
        case 'assessment':
            return 'cosmosDB.migration.phase2.assessment';
        case 'schema-conversion':
            return 'cosmosDB.migration.phase3.schemaConversion';
        case 'provisioning':
            return 'cosmosDB.migration.phase4.provisioning';
        case 'code-migration':
            return 'cosmosDB.migration.codeMigration';
        default:
            return 'cosmosDB.migration.skill.runFinished';
    }
}

export interface MigrationTelemetryEvent {
    name: string;
    properties: Record<string, string>;
    measurements: Record<string, number>;
}

/** Emits already allowlisted aggregates; no file contents, paths, or names are emitted. */
export function reportMigrationTelemetry(event: MigrationTelemetryEvent): void {
    void callWithTelemetryAndErrorHandling(event.name, async (context) => {
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = false;
        const { result, ...properties } = event.properties;
        Object.assign(context.telemetry.properties, properties);
        if (result === 'Succeeded' || result === 'Failed' || result === 'Canceled') {
            context.telemetry.properties.result = result;
        } else {
            delete context.telemetry.properties.result;
        }
        for (const [key, value] of Object.entries(event.measurements)) {
            if (Number.isFinite(value) && value >= 0) context.telemetry.measurements[key] = value;
        }
    });
}

interface TrackedRun {
    invocation: MigrationSkillInvocation;
    properties: Record<string, string>;
    measurements: Record<string, number>;
    startedAt: number;
    lastUpdatedAt: number;
    acknowledged: boolean;
    state: string;
    finished: boolean;
    observing: boolean;
    waitingSince?: number;
    interrupted: boolean;
    dispatchReported: boolean;
}

/**
 * Tracks only extension-launched requests. Keep one instance per workspace for the extension lifetime.
 * No file contents, paths, or names are emitted.
 */
export class MigrationSkillTelemetry {
    public readonly sessionId = randomUUID();
    private run: TrackedRun | undefined;
    private readonly attempts = new Map<string, number>();

    constructor(private readonly emit: (event: MigrationTelemetryEvent) => void = reportMigrationTelemetry) {}

    public begin(invocation: MigrationSkillInvocation, project: ProjectJson | undefined, now = Date.now()): string {
        if (this.run && !this.run.finished) this.finish(this.run, 'unobserved', now);
        const event = migrationOperationEvent(invocation);
        const phase = telemetryPhase(invocation);
        const runId = randomUUID();
        const properties = {
            ...getMigrationTelemetryProperties(project, phase),
            executionEngine: 'skill',
            telemetrySchemaVersion: '2',
            sessionId: this.sessionId,
            // The workflow ID is persisted by the skill; telemetry correlation must stay memory-only.
            runId: randomUUID(),
            executionMode: invocation.mode === 'autonomous' ? 'autonomous' : 'interactive',
            runIndexScope: 'extensionSession',
        };
        const requestedStep = invocation.preflightStep ?? invocation.provisioningStep;
        const step =
            requestedStep &&
            [
                'application-details',
                'schema-acquisition',
                'volumetrics',
                'access-patterns',
                'target-account',
                'resources-and-data',
            ].includes(requestedStep)
                ? requestedStep
                : undefined;
        const extra: Record<string, string> = {};
        if (step) extra.step = step;
        if (invocation.phase === 'code-migration') {
            extra.action =
                invocation.codeMigrationAction === 'migrate'
                    ? 'migrate'
                    : invocation.codeMigrationAction === undefined || invocation.codeMigrationAction === 'plan'
                      ? 'plan'
                      : 'other';
        }
        if (invocation.intent === 'review-and-fix') extra.intent = invocation.intent;
        if (typeof invocation.includeUnmappedDomains === 'boolean')
            extra.includeUnmappedDomains = String(invocation.includeUnmappedDomains);
        const attemptKey = `${event}:${step ?? extra.action ?? ''}`;
        const runIndex = this.attempts.get(attemptKey) ?? 0;
        this.attempts.set(attemptKey, runIndex + 1);
        this.run = {
            invocation: { ...invocation, runId },
            properties: { ...properties, ...extra },
            measurements: { runIndex },
            startedAt: now,
            lastUpdatedAt: 0,
            acknowledged: false,
            state: 'launching',
            finished: false,
            observing: false,
            interrupted: false,
            dispatchReported: false,
        };
        return runId;
    }

    public dispatchInfo(runId: string, model: ModelInfo, newSession: boolean): void {
        const run = this.match(runId);
        if (!run) return;
        Object.assign(run.properties, {
            modelId: model.id,
            modelFamily: model.family,
            modelVendor: model.vendor,
            modelSelectionSource: 'launch',
            newChatSession: String(newSession),
        });
    }

    public dispatched(runId: string, now = Date.now()): void {
        const run = this.match(runId, true);
        if (!run || run.dispatchReported) return;
        run.dispatchReported = true;
        this.send(
            run,
            'cosmosDB.migration.skill.dispatch',
            { outcome: 'accepted', result: 'Succeeded' },
            { durationMs: now - run.startedAt },
        );
        if (run.invocation.intent === 'review-and-fix') {
            this.finish(run, 'handedOff', now);
        }
    }

    public dispatchFailed(runId: string, cancelled: boolean, now = Date.now()): void {
        const run = this.match(runId, true);
        if (!run || run.dispatchReported) return;
        run.dispatchReported = true;
        const outcome = cancelled ? 'cancelled' : 'failed';
        this.send(
            run,
            'cosmosDB.migration.skill.dispatch',
            {
                outcome,
                result: cancelled ? 'Canceled' : 'Failed',
                errorCategory: 'dispatch',
            },
            { durationMs: now - run.startedAt },
        );
        if (!run.acknowledged) this.finish(run, outcome, now, { errorCategory: 'dispatch' });
    }

    public async observe(
        execution: MigrationExecution | undefined,
        project: ProjectJson,
        completion: MigrationPhaseCompletionMap,
        now = Date.now(),
        options: { signal?: AbortSignal; validationDurationMs?: number } = {},
    ): Promise<void> {
        const run = execution && this.match(execution.runId);
        if (!run || !execution || run.observing) return;
        const step =
            run.invocation.preflightStep ??
            run.invocation.provisioningStep ??
            (run.invocation.phase === 'code-migration' ? (run.invocation.codeMigrationAction ?? 'plan') : null);
        if (execution.phase !== (run.invocation.phase ?? 'all') || execution.step !== step) return;
        const updatedAt = Date.parse(execution.updatedAt);
        if (!Number.isFinite(updatedAt) || updatedAt < run.lastUpdatedAt) return;
        run.lastUpdatedAt = updatedAt;
        if (!run.acknowledged) {
            run.acknowledged = true;
            run.measurements.acknowledgmentMs = Math.max(0, now - run.startedAt);
            this.send(run, 'cosmosDB.migration.skill.stateChanged', { activity: 'acknowledged' });
        }
        for (const key of migrationApplicationTelemetryKeys) delete run.properties[key];
        Object.assign(run.properties, getMigrationTelemetryProperties(project, telemetryPhase(run.invocation)));
        this.transition(run, execution.activity, now);
        if (execution.activity === 'complete') {
            run.observing = true;
            const evidence = await collectMigrationTelemetryEvidence(run.invocation, project, completion);
            run.observing = false;
            if (this.run !== run || run.finished || options.signal?.aborted) return;
            Object.assign(run.measurements, evidence.measurements);
            if (options.validationDurationMs !== undefined)
                run.measurements.validationDurationMs = options.validationDurationMs;
            this.finish(
                run,
                evidence.validation === 'passed'
                    ? 'completed'
                    : evidence.validation === 'failed'
                      ? 'blocked'
                      : 'unverified',
                now,
                {
                    validationResult: evidence.validation,
                    validationScope: step === null ? 'phase' : 'step',
                    ...(evidence.errorCategory ? { errorCategory: evidence.errorCategory } : {}),
                },
            );
        } else if (['blocked', 'failed', 'cancelled'].includes(execution.activity)) {
            this.finish(run, execution.activity, now, {
                errorCategory: execution.activity === 'blocked' ? 'agentBlocker' : 'agent',
            });
        }
    }

    public unavailable(reason: 'executionRead' | 'completionCheck' | 'panelClosed', now = Date.now()): void {
        if (!this.run || this.run.finished) return;
        this.run.interrupted = true;
        this.run.waitingSince = undefined;
        this.transition(this.run, 'unknown', now, { errorCategory: reason });
    }

    public confirmedStopped(now = Date.now()): void {
        if (this.run && !this.run.finished) {
            this.finish(this.run, 'unobserved', now, { stopSource: 'userConfirmation' });
        }
    }

    private match(runId: string, includeFinished = false): TrackedRun | undefined {
        return this.run?.invocation.runId === runId && (includeFinished || !this.run.finished) ? this.run : undefined;
    }

    private transition(run: TrackedRun, state: string, now: number, properties: Record<string, string> = {}): void {
        if (run.state === state) return;
        if (run.waitingSince !== undefined) {
            run.measurements.observedWaitingMs =
                (run.measurements.observedWaitingMs ?? 0) + Math.max(0, now - run.waitingSince);
            run.waitingSince = undefined;
        }
        if (state === 'waiting-for-decision') run.waitingSince = now;
        run.state = state;
        this.send(run, 'cosmosDB.migration.skill.stateChanged', { activity: state, ...properties });
    }

    private finish(run: TrackedRun, outcome: string, now: number, properties: Record<string, string> = {}): void {
        if (run.finished) return;
        run.finished = true;
        const result =
            outcome === 'completed' || outcome === 'handedOff'
                ? 'Succeeded'
                : outcome === 'cancelled'
                  ? 'Canceled'
                  : outcome === 'failed' || outcome === 'blocked'
                    ? 'Failed'
                    : undefined;
        this.send(
            run,
            migrationOperationEvent(run.invocation),
            {
                outcome,
                ...(result ? { result } : {}),
                observationCoverage: run.interrupted ? 'interrupted' : 'live',
                durationSource: 'dispatchToObservation',
                ...properties,
            },
            { durationMs: Math.max(0, now - run.startedAt) },
        );
    }

    private send(
        run: TrackedRun,
        name: string,
        properties: Record<string, string>,
        measurements: Record<string, number> = {},
    ): void {
        this.emit({
            name,
            properties: { ...run.properties, ...properties },
            measurements: { ...run.measurements, ...measurements },
        });
    }
}
