/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'node:crypto';
import { type WizardState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { summarizeModel } from './modelingTelemetryMetrics';
import {
    ModelingTelemetryEventSchema,
    type ModelingStep,
    type ModelingTelemetryEvent,
    type ModelingUsage,
} from './modelingTelemetrySchema';
import { type PartitionKeyRecommendation } from './recommendationSchema';

type EventName =
    | 'cosmosDB.dataModeler.opened'
    | 'cosmosDB.dataModeler.step'
    | 'cosmosDB.dataModeler.sessionChoice'
    | 'cosmosDB.dataModeler.scenarioSelected'
    | 'cosmosDB.dataModeler.action'
    | 'cosmosDB.dataModeler.feedback'
    | 'cosmosDB.dataModeler.control'
    | 'cosmosDB.dataModeler.schemaImport'
    | 'cosmosDB.dataModeler.fieldAdded'
    | 'cosmosDB.dataModeler.recommendationRequested'
    | 'cosmosDB.dataModeler.recommendationReceived'
    | 'cosmosDB.dataModeler.recommendationDisplayed'
    | 'cosmosDB.dataModeler.recommendationOutcome'
    | 'cosmosDB.dataModeler.persistenceLoad'
    | 'cosmosDB.dataModeler.deployment'
    | 'cosmosDB.dataModeler.export'
    | 'cosmosDB.dataModeler.openDataExplorer'
    | 'cosmosDB.dataModeler.summary';
type Outcome = 'success' | 'error' | 'cancelled';
type Attempt = {
    requestId?: string;
    number: number;
    started: number;
    requestedNames: string[];
    received?: number;
    finished: boolean;
    displayed: boolean;
};

export type ModelingDeploymentTelemetry = {
    outcome: Outcome;
    databaseMode: 'new' | 'existing';
    durationMs: number;
    writesStarted: boolean;
    createdCount: number;
    existingCount: number;
    errorCategory?: 'validation' | 'concurrent' | 'infrastructure';
};

/**
 * Host-only, best-effort panel rollup. No file contents, paths, or names are emitted.
 * Request IDs and entity names are retained only in memory for correlation and matching.
 */
export class ModelingTelemetry {
    private readonly visited = new Set<ModelingStep>();
    private usage?: ModelingUsage;
    private choice?: 'new' | 'continued' | 'replaced';
    private lastStep?: ModelingStep;
    private feedback?: 'up' | 'down';
    private visibleSince?: number;
    private activeVisibleMs = 0;
    private disposed = false;
    private attempt?: Attempt;
    private readonly requestIds = new Set<string>();
    private attempts = 0;
    private receivedCount = 0;
    private displayedCount = 0;
    private failureCount = 0;
    private saveCount = 0;
    private saveFailureCount = 0;
    private saveRecoveryCount = 0;
    private loadFailureCount = 0;
    private loadRecoveryCount = 0;
    private saveFailed = false;
    private loadFailed = false;
    private uncorrelatedDisplayed = false;
    private uncorrelatedReceived = false;
    private schemaImportSuccessCount = 0;
    private schemaImportErrorCount = 0;
    private schemaImportCancelledCount = 0;
    private fieldsAddedCount = 0;
    private scenarioSelectionCount = 0;
    private firstSelectedScenario?: Exclude<ModelingUsage['scenario'], 'none'>;
    private lastSelectedScenario?: Exclude<ModelingUsage['scenario'], 'none'>;

    public constructor(
        visible: boolean,
        private readonly now: () => number = Date.now,
        private readonly panelId: string = randomUUID(),
    ) {
        if (visible) this.visibleSince = this.now();
        this.emit('cosmosDB.dataModeler.opened');
    }

    public setVisible(visible: boolean): void {
        if (this.disposed) return;
        if (this.visibleSince !== undefined && !visible) {
            this.activeVisibleMs += Math.max(0, this.now() - this.visibleSince);
            this.visibleSince = undefined;
        } else if (this.visibleSince === undefined && visible) {
            this.visibleSince = this.now();
        }
    }

    public record(input: ModelingTelemetryEvent): void {
        // Defense in depth: never spread an unvalidated webview payload into an event.
        const parsed = ModelingTelemetryEventSchema.safeParse(input);
        if (this.disposed) return;
        if (!parsed.success) {
            console.warn('[Data Modeler] Rejected invalid usage telemetry.');
            return;
        }
        const event = parsed.data;
        switch (event.type) {
            case 'scenarioSelected': {
                const firstSelection = this.scenarioSelectionCount === 0;
                this.scenarioSelectionCount++;
                this.firstSelectedScenario ??= event.scenario;
                this.lastSelectedScenario = event.scenario;
                this.emit(
                    'cosmosDB.dataModeler.scenarioSelected',
                    { scenario: event.scenario, firstSelection: String(firstSelection) },
                    {},
                    // The model is reseeded after this interaction; the previous usage snapshot is not its context.
                    { includeUsage: false },
                );
                return;
            }
            case 'control':
                this.emit('cosmosDB.dataModeler.control', { controlId: event.control });
                return;
            case 'schemaImport':
                if (event.outcome === 'success') this.schemaImportSuccessCount++;
                else if (event.outcome === 'error') this.schemaImportErrorCount++;
                else this.schemaImportCancelledCount++;
                this.emit('cosmosDB.dataModeler.schemaImport', { outcome: event.outcome });
                return;
            case 'fieldAdded':
                this.fieldsAddedCount++;
                this.emit('cosmosDB.dataModeler.fieldAdded');
                return;
            case 'usage':
                this.usage = event.usage;
                return;
            case 'step': {
                const firstVisit = !this.visited.has(event.step);
                if (event.step === this.lastStep) return;
                this.visited.add(event.step);
                this.lastStep = event.step;
                this.emit('cosmosDB.dataModeler.step', { step: event.step, firstVisit: String(firstVisit) });
                return;
            }
            case 'sessionChoice':
                this.choice = event.choice;
                this.emit('cosmosDB.dataModeler.sessionChoice');
                return;
            case 'feedback':
                if (this.feedback === event.vote) return;
                this.feedback = event.vote;
                this.emit('cosmosDB.dataModeler.feedback', { vote: event.vote });
                return;
            case 'action':
                if (event.action === 'startOver') {
                    this.finishPending('startOver');
                    this.uncorrelatedDisplayed = false;
                    this.uncorrelatedReceived = false;
                    this.feedback = undefined;
                    this.attempt = undefined;
                }
                this.emit('cosmosDB.dataModeler.action', {
                    action: event.action,
                    ...(event.method ? { method: event.method } : {}),
                    ...(event.outcome ? { outcome: event.outcome } : {}),
                    ...(event.codeCustomized === undefined ? {} : { codeCustomized: String(event.codeCustomized) }),
                });
                return;
            case 'recommendationDisplayed':
                this.displayed(event.requestId);
                return;
            case 'recommendationClientFailure':
                if (event.requestId && this.isCurrent(event.requestId)) {
                    this.recommendationFailed(event.requestId, event.errorCategory);
                } else if (!event.requestId || !this.requestIds.has(event.requestId)) {
                    this.failureCount++;
                    this.emit('cosmosDB.dataModeler.recommendationOutcome', {
                        source: 'uncorrelated',
                        outcome: 'error',
                        errorCategory: event.errorCategory,
                    });
                }
                return;
        }
    }

    public beginRecommendation(requestId: string | undefined, requestedNames: string[], wizard?: WizardState): void {
        if (this.disposed || (requestId && this.requestIds.has(requestId))) return;
        this.finishPending('superseded');
        if (requestId) this.requestIds.add(requestId);
        this.attempt = {
            requestId,
            number: ++this.attempts,
            started: this.now(),
            requestedNames: [...requestedNames],
            finished: false,
            displayed: false,
        };
        this.uncorrelatedDisplayed = false;
        this.uncorrelatedReceived = false;
        this.feedback = undefined;
        this.emit(
            'cosmosDB.dataModeler.recommendationRequested',
            { retry: String(this.attempts > 1) },
            { attemptNumber: this.attempts, requestedContainerCount: requestedNames.length },
            { modelSnapshot: wizard ? summarizeModel(wizard) : undefined },
        );
    }

    /** Reject stale/duplicate identified responses; legacy responses remain explicitly uncorrelated. */
    public acceptsResponse(requestId?: string): boolean {
        return (
            !this.disposed &&
            (!requestId ||
                (this.isCurrent(requestId) && !this.attempt?.finished && this.attempt?.received === undefined))
        );
    }

    public recommendationReceived(recommendation: PartitionKeyRecommendation, requestId?: string): boolean {
        if (!this.acceptsResponse(requestId)) return false;
        this.feedback = undefined;
        const attempt = requestId && this.isCurrent(requestId) ? this.attempt : undefined;
        const returned = recommendation.containers;
        if (!requestId) this.uncorrelatedReceived = true;
        const requested = attempt?.requestedNames;
        const matched = requested?.filter((name) => returned.some((container) => container.entity === name)).length;
        const measurements: Record<string, number> = {
            returnedContainerCount: returned.length,
            missingCandidatesCount: returned.filter((c) => !c.candidates?.length).length,
            missingHotPartitionRiskCount: returned.filter((c) => !c.hotPartitionRisk?.length).length,
            missingQueryRoutingCount: returned.filter((c) => !c.queryRouting).length,
            missingDocumentIdStrategyCount: returned.filter((c) => !c.documentIdStrategy).length,
            missingGuardrailsCount: returned.filter((c) => !c.guardrails?.length).length,
        };
        if (attempt) {
            attempt.received = this.now();
            measurements.attemptNumber = attempt.number;
            measurements.requestToReceivedMs = Math.max(0, attempt.received - attempt.started);
            measurements.requestedContainerCount = requested!.length;
            measurements.matchedContainerCount = matched!;
            measurements.missingContainerCount = requested!.length - matched!;
            this.receivedCount++;
        } else if (!requestId && this.attempt && !this.attempt.requestId) {
            // A legacy request can finish, but cannot supply trustworthy correlation durations.
            this.attempt.finished = true;
        }
        this.emit(
            'cosmosDB.dataModeler.recommendationReceived',
            { source: attempt ? 'fresh' : 'uncorrelated' },
            measurements,
        );
        return true;
    }

    public recommendationFailed(
        requestId: string | undefined,
        errorCategory: 'chat' | 'ai' | 'invalidResult' | 'save' | 'subscription',
    ): boolean {
        if (this.disposed || (requestId && (!this.isCurrent(requestId) || this.attempt?.finished))) return false;
        const attempt = requestId && this.isCurrent(requestId) ? this.attempt : undefined;
        if (attempt) attempt.finished = true;
        else if (!requestId && this.attempt && !this.attempt.requestId) this.attempt.finished = true;
        this.failureCount++;
        this.emit(
            'cosmosDB.dataModeler.recommendationOutcome',
            { outcome: 'error', errorCategory, source: attempt ? 'fresh' : 'uncorrelated' },
            attempt ? { attemptNumber: attempt.number, durationMs: Math.max(0, this.now() - attempt.started) } : {},
        );
        return true;
    }

    public persistenceLoad(success: boolean, savedStateFound?: boolean): void {
        if (!success) this.loadFailureCount++;
        const recovered = success && this.loadFailed;
        if (recovered) this.loadRecoveryCount++;
        this.loadFailed = !success;
        this.emit('cosmosDB.dataModeler.persistenceLoad', {
            outcome: success ? 'success' : 'error',
            recovered: String(recovered),
            ...(savedStateFound === undefined ? {} : { savedStateFound: String(savedStateFound) }),
        });
    }

    public persistenceSave(success: boolean): void {
        this.saveCount++;
        if (!success) this.saveFailureCount++;
        if (success && this.saveFailed) this.saveRecoveryCount++;
        this.saveFailed = !success;
    }

    public deployment(result: ModelingDeploymentTelemetry): void {
        this.emit(
            'cosmosDB.dataModeler.deployment',
            {
                method: 'direct',
                outcome: result.outcome,
                databaseMode: result.databaseMode,
                writesStarted: String(result.writesStarted),
                ...(result.errorCategory ? { errorCategory: result.errorCategory } : {}),
            },
            { durationMs: result.durationMs, createdCount: result.createdCount, existingCount: result.existingCount },
        );
    }

    public export(
        outcome: Outcome,
        method: 'bicep' | 'terraform' | 'sdk',
        databaseMode: 'new' | 'existing',
        durationMs: number,
    ): void {
        this.emit('cosmosDB.dataModeler.export', { outcome, method, databaseMode }, { durationMs });
    }

    public openDataExplorer(outcome: Outcome, durationMs: number): void {
        this.emit('cosmosDB.dataModeler.openDataExplorer', { outcome }, { durationMs });
    }

    public dispose(): void {
        if (this.disposed) return;
        this.setVisible(false);
        this.finishPending('closedBeforeResult');
        this.emit(
            'cosmosDB.dataModeler.summary',
            {
                ...(this.lastStep ? { lastStep: this.lastStep } : {}),
                ...(this.feedback ? { feedback: this.feedback } : {}),
                ...(this.firstSelectedScenario ? { firstSelectedScenario: this.firstSelectedScenario } : {}),
                ...(this.lastSelectedScenario ? { lastSelectedScenario: this.lastSelectedScenario } : {}),
                visitedWorkload: String(this.visited.has('workload')),
                visitedContainer: String(this.visited.has('container')),
                visitedReview: String(this.visited.has('review')),
                visitedResult: String(this.visited.has('result')),
                visitedDeploy: String(this.visited.has('deploy')),
            },
            {
                activeVisibleMs: this.activeVisibleMs,
                recommendationAttempts: this.attempts,
                recommendationRetries: Math.max(0, this.attempts - 1),
                recommendationsReceived: this.receivedCount,
                recommendationsDisplayed: this.displayedCount,
                recommendationFailures: this.failureCount,
                saveCount: this.saveCount,
                saveFailureCount: this.saveFailureCount,
                saveRecoveryCount: this.saveRecoveryCount,
                loadFailureCount: this.loadFailureCount,
                loadRecoveryCount: this.loadRecoveryCount,
            },
        );
        this.disposed = true;
        this.attempt = undefined;
        this.requestIds.clear();
    }

    private isCurrent(requestId: string): boolean {
        return this.attempt?.requestId === requestId;
    }

    private displayed(requestId?: string): void {
        if (requestId) {
            if (!this.isCurrent(requestId)) return;
            const attempt = this.attempt!;
            if (attempt.displayed || attempt.finished || attempt.received === undefined) return;
            attempt.displayed = true;
            attempt.finished = true;
            this.displayedCount++;
            this.emit(
                'cosmosDB.dataModeler.recommendationDisplayed',
                { source: 'fresh', outcome: 'success' },
                {
                    attemptNumber: attempt.number,
                    requestToDisplayedMs: Math.max(0, this.now() - attempt.started),
                    receivedToDisplayedMs: Math.max(0, this.now() - attempt.received),
                },
            );
        } else if (!this.uncorrelatedDisplayed) {
            this.uncorrelatedDisplayed = true;
            this.emit('cosmosDB.dataModeler.recommendationDisplayed', {
                source: this.uncorrelatedReceived ? 'uncorrelated' : 'restored',
            });
        }
    }

    private finishPending(outcome: 'superseded' | 'startOver' | 'closedBeforeResult'): void {
        const attempt = this.attempt;
        if (!attempt || attempt.finished) return;
        attempt.finished = true;
        this.emit(
            'cosmosDB.dataModeler.recommendationOutcome',
            {
                outcome,
                resultReceived: String(attempt.received !== undefined),
            },
            { attemptNumber: attempt.number, durationMs: Math.max(0, this.now() - attempt.started) },
        );
    }

    private emit(
        name: EventName,
        properties: Record<string, string> = {},
        measurements: Record<string, number> = {},
        options: { modelSnapshot?: ReturnType<typeof summarizeModel>; includeUsage?: boolean } = {},
    ): void {
        if (this.disposed) return;
        const enriched = {
            panelId: this.panelId,
            schemaUploaded: String(this.schemaImportSuccessCount > 0),
            ...properties,
        };
        Object.assign(measurements, {
            schemaImportSuccessCount: this.schemaImportSuccessCount,
            schemaImportErrorCount: this.schemaImportErrorCount,
            schemaImportCancelledCount: this.schemaImportCancelledCount,
            fieldsAddedCount: this.fieldsAddedCount,
            scenarioSelectionCount: this.scenarioSelectionCount,
        });
        if (this.attempt && properties.source !== 'uncorrelated' && properties.source !== 'restored') {
            measurements.attemptNumber ??= this.attempt.number;
        }
        if (this.choice) Object.assign(enriched, { sessionChoice: this.choice });
        // Usage has already passed the strict, bounded schema; keep numeric aggregates as measurements.
        const usage = options.includeUsage === false ? {} : { ...this.usage, ...options.modelSnapshot };
        for (const [key, value] of Object.entries(usage)) {
            if (typeof value === 'number') measurements[key] = value;
            else Object.assign(enriched, { [key]: String(value) });
        }
        try {
            void callWithTelemetryAndErrorHandling(name, async (context) => {
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.rethrow = false;
                Object.assign(context.telemetry.properties, enriched);
                for (const [key, value] of Object.entries(measurements)) {
                    if (Number.isFinite(value)) context.telemetry.measurements[key] = value;
                }
            }).catch(() => console.warn('[Data Modeler] Could not emit usage telemetry.'));
        } catch {
            console.warn('[Data Modeler] Could not emit usage telemetry.');
        }
    }
}
