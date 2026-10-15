/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MigrationSkillInvocation } from '../../../../panels/migration/helpers/migrationSkillDispatcher';
import { type PhaseState } from './MigrationContext';

export const migrationAcknowledgmentTimeout = 60_000;

export function shouldResetMigrationTargetEndpoint(
    currentType: 'emulator' | 'azure' | 'provision' | null | undefined,
    nextType: 'emulator' | 'azure' | 'provision' | null,
    currentAccountName?: string | null,
    nextAccountName?: string | null,
): boolean {
    if (currentType !== nextType && (currentType === 'emulator' || nextType === 'emulator' || nextType === null)) {
        return true;
    }
    return (
        nextType === 'provision' &&
        (currentType !== 'provision' ||
            (nextAccountName !== undefined && nextAccountName !== null && nextAccountName !== currentAccountName))
    );
}

export function isMigrationInspectionCommand(command: string): boolean {
    return [
        'loadProject',
        'getAvailableModels',
        'estimateContextTokens',
        'checkGitRepository',
        'checkGitignore',
        'openFile',
        'revealInExplorer',
        'openGeneratedBicep',
        'previewMarkdown',
        'openMigrationChat',
        'openVolumetricsTemplate',
        'openAccessPatternsTemplate',
        'confirmMigrationStopped',
    ].includes(command);
}

export interface MigrationExecution {
    version: 1;
    runId: string;
    phase: MigrationPhaseName | 'all';
    step: string | null;
    activity: 'running' | 'waiting-for-decision' | 'blocked' | 'complete' | 'failed' | 'cancelled';
    startedAt: string;
    updatedAt: string;
    detail: string;
}

export interface MigrationRunActivity extends Omit<MigrationExecution, 'activity'> {
    activity: MigrationExecution['activity'] | 'launching' | 'waiting-for-agent' | 'unknown';
    validationFailed?: boolean;
}

export function isMigrationRunActive(activity: MigrationRunActivity | null | undefined): boolean {
    return (
        activity !== null &&
        activity !== undefined &&
        ['launching', 'waiting-for-agent', 'running', 'waiting-for-decision', 'unknown'].includes(activity.activity)
    );
}

export class MigrationRunTracker {
    private activity: MigrationRunActivity | null = null;
    private confirmedStoppedRunId: string | undefined;
    private acknowledgedRunId: string | undefined;

    public snapshot(now = Date.now()): MigrationRunActivity | null {
        if (
            this.activity &&
            this.activity.activity === 'launching' &&
            now - Date.parse(this.activity.startedAt) >= migrationAcknowledgmentTimeout
        ) {
            this.activity = { ...this.activity, activity: 'unknown' };
        }
        return this.activity;
    }

    public begin(runId: string, invocation: MigrationSkillInvocation, now = Date.now()): void {
        if (isMigrationRunActive(this.snapshot(now))) throw new Error('A migration run is already active.');
        const timestamp = new Date(now).toISOString();
        this.activity = {
            version: 1,
            runId,
            phase: invocation.phase ?? 'all',
            step:
                invocation.preflightStep ??
                invocation.provisioningStep ??
                (invocation.phase === 'code-migration' ? (invocation.codeMigrationAction ?? 'plan') : null),
            activity: 'launching',
            startedAt: timestamp,
            updatedAt: timestamp,
            detail: '',
        };
    }

    public dispatched(runId: string): void {
        if (
            this.activity?.runId === runId &&
            this.acknowledgedRunId !== runId &&
            ['launching', 'unknown'].includes(this.activity.activity)
        ) {
            this.activity = { ...this.activity, activity: 'running' };
        }
    }

    public failed(runId: string, detail: string): void {
        if (
            this.activity?.runId === runId &&
            this.acknowledgedRunId !== runId &&
            ['launching', 'waiting-for-agent', 'running', 'unknown'].includes(this.activity.activity)
        ) {
            this.activity = { ...this.activity, activity: 'failed', detail: detail.slice(0, 500) };
        }
    }

    public observe(
        execution: MigrationExecution | undefined,
        completion: Partial<
            Record<MigrationPhaseName, { complete: boolean; freshness?: MigrationPhaseCompletionState['freshness'] }>
        >,
    ): void {
        if (!execution || execution.runId === this.confirmedStoppedRunId) return;
        if (
            this.activity &&
            execution.runId !== this.activity.runId &&
            Date.parse(execution.startedAt) <= Date.parse(this.activity.startedAt)
        )
            return;
        if (
            this.activity?.runId === execution.runId &&
            Date.parse(execution.updatedAt) < Date.parse(this.activity.updatedAt)
        )
            return;
        this.acknowledgedRunId = execution.runId;
        const phases: MigrationPhaseName[] =
            execution.phase === 'all'
                ? ['preflight', 'discovery', 'assessment', 'schema-conversion', 'provisioning', 'code-migration']
                : [execution.phase];
        const incomplete = phases.filter((phase) => !completion[phase]?.complete);
        const validationFailed = execution.activity === 'complete' && execution.step === null && incomplete.length > 0;
        const staleOnly =
            incomplete.length > 0 && incomplete.every((phase) => completion[phase]?.freshness === 'stale');
        this.activity = {
            ...execution,
            activity: validationFailed && !staleOnly ? 'blocked' : execution.activity,
            validationFailed,
        };
    }

    public confirmStopped(): void {
        if (!this.activity) return;
        this.confirmedStoppedRunId = this.activity.runId;
        this.activity = { ...this.activity, activity: 'cancelled', detail: '', validationFailed: false };
    }

    public unavailable(detail: string): void {
        this.activity = {
            version: 1,
            runId: 'unknown',
            phase: 'all',
            step: null,
            startedAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            ...this.activity,
            activity: 'unknown',
            detail: detail.slice(0, 500),
        };
    }

    public clear(): void {
        this.activity = null;
        this.confirmedStoppedRunId = undefined;
        this.acknowledgedRunId = undefined;
    }
}

export type MigrationPhaseName =
    | 'preflight'
    | 'discovery'
    | 'assessment'
    | 'schema-conversion'
    | 'provisioning'
    | 'code-migration';

export interface MigrationFreshnessCause {
    phase: MigrationPhaseName;
    id: string;
    reason: string;
    path?: string;
    canOpen?: boolean;
}

export interface MigrationPhaseCompletionState {
    phase: MigrationPhaseName;
    status: 'not-started' | 'in-progress' | 'complete' | undefined;
    complete: boolean;
    compatibilityChanges?: string[];
    recordedCompletedAt?: string;
    ready?: boolean;
    freshness?: 'current' | 'stale' | 'unknown' | 'not-applicable';
    staleInputs?: { id: string; reason: string; path?: string }[];
    freshnessCauses?: MigrationFreshnessCause[];
    artifacts: {
        path: string;
        description: string;
        conditional: boolean;
        state: 'missing' | 'present' | 'invalid';
        diagnostics?: (string | { path?: string; code?: string; message: string })[];
        canOpen?: boolean;
    }[];
    errors: string[];
}

export type MigrationCompletionMap = Record<MigrationPhaseName, MigrationPhaseCompletionState>;

export function getMigrationRunPhase(
    activity: MigrationRunActivity | null | undefined,
    completion: Partial<MigrationCompletionMap> | null | undefined,
): MigrationPhaseName | undefined {
    if (activity?.phase !== 'all') return activity?.phase;
    const phases = Object.values(completion ?? {});
    return (
        phases.find((phase) => phase?.status === 'in-progress')?.phase ??
        phases.find((phase) => !phase?.complete)?.phase ??
        'preflight'
    );
}

export function getMigrationValidationFailure(
    result: MigrationPhaseCompletionState | undefined,
): 'project-invalid' | 'validation-unavailable' | null {
    if (result?.staleInputs?.some((input) => input.id === 'project')) return 'project-invalid';
    if (result?.staleInputs?.some((input) => input.id === 'completion-check' || input.id === 'phase')) {
        return 'validation-unavailable';
    }
    return null;
}

export function getMigrationPhaseOutcome(
    phase: MigrationPhaseName,
    completion: Partial<MigrationCompletionMap> | null | undefined,
    activity: MigrationRunActivity | null | undefined,
):
    | 'blocked'
    | 'failed'
    | 'cancelled'
    | 'stale'
    | 'unknown'
    | 'invalid'
    | 'project-invalid'
    | 'validation-unavailable'
    | null {
    const isCurrentRun = getMigrationRunPhase(activity, completion) === phase;
    if (isCurrentRun && isMigrationRunActive(activity)) return null;
    const result = completion?.[phase];
    const validationFailure = getMigrationValidationFailure(result);
    if (validationFailure) return validationFailure;
    if (isCurrentRun) {
        if (activity?.activity === 'blocked' || activity?.activity === 'failed' || activity?.activity === 'cancelled') {
            return activity.activity;
        }
    }
    if (result?.complete || result?.status !== 'complete') return null;
    if (result.freshness === 'stale' || result.freshness === 'unknown') return result.freshness;
    return 'invalid';
}

export function getMigrationPrerequisite(
    phase: MigrationPhaseName,
    completion: Partial<MigrationCompletionMap> | null | undefined,
): MigrationPhaseName | null | undefined {
    const result = completion?.[phase];
    if (!result || getMigrationValidationFailure(result)) return undefined;
    if (phase === 'code-migration' && isCodeMigrationReady(completion)) return null;
    const predecessor: Partial<Record<MigrationPhaseName, MigrationPhaseName>> = {
        discovery: 'preflight',
        assessment: 'discovery',
        'schema-conversion': 'assessment',
        provisioning: 'schema-conversion',
        'code-migration': 'schema-conversion',
    };
    const previous = predecessor[phase];
    if (!previous) return null;
    const prerequisite = getMigrationPrerequisite(previous, completion);
    if (prerequisite === undefined) return undefined;
    return prerequisite ?? (!completion?.[previous]?.complete ? previous : null);
}

export function isCodeMigrationReady(completion: Partial<MigrationCompletionMap> | null | undefined): boolean {
    return completion?.['code-migration']?.ready === true;
}

export function isDiscoveryLaunchReady(settings: {
    projectName: string;
    consentGiven: boolean;
    selectedModelId: string | null;
    isAIFeaturesEnabled: boolean;
}): boolean {
    return Boolean(
        settings.projectName.trim() &&
        settings.consentGiven &&
        settings.selectedModelId &&
        settings.isAIFeaturesEnabled,
    );
}

export function deriveMigrationPhaseStates(
    completion: Partial<MigrationCompletionMap> | undefined,
    useProgrammaticFlow = false,
): {
    discoveryState: PhaseState;
    assessmentState: PhaseState;
    schemaConversionState: PhaseState;
    provisioningState: PhaseState;
} {
    const canRestoreCompletion =
        useProgrammaticFlow || isCodeMigrationReady(completion) || (completion?.['code-migration']?.complete ?? false);
    const wasCompleted = (phase: MigrationPhaseName): boolean => completion?.[phase]?.status === 'complete';
    const isComplete = (phase: MigrationPhaseName): boolean =>
        (completion?.[phase]?.complete ?? false) || (canRestoreCompletion && wasCompleted(phase));
    const discoveryComplete = isComplete('discovery');
    const assessmentComplete = isComplete('assessment');

    return {
        discoveryState: discoveryComplete
            ? 'complete'
            : !useProgrammaticFlow || completion?.preflight?.complete || wasCompleted('discovery')
              ? 'available'
              : 'locked',
        assessmentState: assessmentComplete
            ? 'complete'
            : discoveryComplete || wasCompleted('assessment')
              ? 'available'
              : 'locked',
        schemaConversionState: isComplete('schema-conversion')
            ? 'complete'
            : assessmentComplete || wasCompleted('schema-conversion')
              ? 'available'
              : 'locked',
        provisioningState: isComplete('provisioning')
            ? 'complete'
            : wasCompleted('provisioning')
              ? 'available'
              : 'locked',
    };
}
