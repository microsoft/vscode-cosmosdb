/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { type MigrationExecution } from '../../../webviews/cosmosdb/Migration/state/deriveMigrationPhaseStates';
import { type MigrationSkillInvocation } from './migrationSkillDispatcher';
import {
    MigrationSkillTelemetry,
    migrationOperationEvent,
    reportMigrationTelemetry,
    type MigrationTelemetryEvent,
} from './migrationSkillTelemetry';
import {
    type MigrationPhaseCompletion,
    type MigrationPhaseCompletionMap,
    type MigrationPhaseName,
} from './migrationStateSync';
import { collectMigrationTelemetryEvidence } from './migrationTelemetryEvidence';

const { telemetryContext } = vi.hoisted(() => ({
    telemetryContext: {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        get ui(): never {
            throw new Error('Telemetry must not use UI');
        },
    } as IActionContext,
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_name: string, callback: (context: IActionContext) => Promise<void>) => callback(telemetryContext),
    ),
}));

function completedPhase(phase: MigrationPhaseName): MigrationPhaseCompletion {
    return {
        phase,
        complete: true,
        status: 'complete',
        freshness: phase === 'code-migration' ? 'not-applicable' : 'current',
        staleInputs: [],
        errors: [],
        artifacts: [
            {
                path: '.cosmosdb-migration/project.json',
                description: 'Migration project checkpoint',
                state: 'present',
                conditional: false,
            },
        ],
    };
}

function completions(): MigrationPhaseCompletionMap {
    return {
        preflight: completedPhase('preflight'),
        discovery: completedPhase('discovery'),
        assessment: completedPhase('assessment'),
        'schema-conversion': completedPhase('schema-conversion'),
        provisioning: completedPhase('provisioning'),
        'code-migration': completedPhase('code-migration'),
    };
}

function project(): ProjectJson {
    return {
        version: 1,
        name: 'private-workspace',
        sessionId: 'private-persisted-id',
        sourceCode: 'parent',
        runCounts: { assessment: 45 },
        phases: {
            discovery: { status: 'complete', applicationAnalysis: { databaseType: 'PostgreSQL' } },
            assessment: {
                status: 'complete',
                domains: [
                    {
                        name: 'private-domain',
                        tables: ['private-table'],
                        isMapped: true,
                        crossDomainDependencies: [],
                        estimatedTokens: 0,
                    },
                ],
                parsedAccessPatterns: [],
            },
        },
    };
}

function execution(runId: string, activity: MigrationExecution['activity'], updatedAt = 2_000): MigrationExecution {
    return {
        version: 1,
        runId,
        phase: 'assessment',
        step: null,
        activity,
        startedAt: new Date(1_000).toISOString(),
        updatedAt: new Date(updatedAt).toISOString(),
        detail: 'private-query and private-path',
    };
}

describe('migration skill telemetry', () => {
    let events: MigrationTelemetryEvent[];
    let telemetry: MigrationSkillTelemetry;
    let runId: string;
    const invocation: MigrationSkillInvocation = {
        workspacePath: '/private-workspace',
        phase: 'assessment',
        mode: 'interactive',
    };
    beforeEach(() => {
        events = [];
        telemetry = new MigrationSkillTelemetry((event) => events.push(event));
        runId = telemetry.begin(invocation, project(), 1_000);
    });
    const operationName = 'cosmosDB.migration.phase2.assessment';

    it.each([
        [{ phase: 'preflight', preflightStep: 'application-details' }, 'cosmosDB.migration.phase1.analysis'],
        [{ phase: 'preflight' }, 'cosmosDB.migration.phase1.preflight'],
        [{ phase: 'discovery' }, 'cosmosDB.migration.phase1.discovery'],
        [{ phase: 'assessment' }, operationName],
        [{ phase: 'schema-conversion' }, 'cosmosDB.migration.phase3.schemaConversion'],
        [{ phase: 'provisioning' }, 'cosmosDB.migration.phase4.provisioning'],
        [
            { phase: 'provisioning', provisioningStep: 'target-account' },
            'cosmosDB.migration.phase4.accountProvisioning',
        ],
        [
            { phase: 'provisioning', provisioningStep: 'resources-and-data' },
            'cosmosDB.migration.phase4.sampleDataPopulation',
        ],
        [{ phase: 'code-migration' }, 'cosmosDB.migration.codeMigration'],
        [{ phase: 'assessment', intent: 'review-and-fix' }, 'cosmosDB.migration.review'],
    ] satisfies [Partial<MigrationSkillInvocation>, string][])('maps %j to its operation event', (scope, name) => {
        expect(migrationOperationEvent({ workspacePath: '/workspace', ...scope })).toBe(name);
    });

    it('separates dispatch, acknowledgment and validated completion, deduplicating repeated observations', async () => {
        telemetry.dispatchInfo(
            runId,
            { id: 'auto', family: 'auto', vendor: 'copilot', name: 'Auto', maxInputTokens: 1 },
            true,
        );
        telemetry.dispatched(runId, 1_200);
        telemetry.dispatched(runId, 1_300);
        expect(events).toHaveLength(1);
        expect(events[0].properties).toMatchObject({
            outcome: 'accepted',
            modelId: 'auto',
            modelSelectionSource: 'launch',
        });
        expect(events[0].measurements.durationMs).toBe(200);
        expect(events[0].properties.runId).not.toBe(runId);
        await telemetry.observe(execution(runId, 'running'), project(), completions(), 2_000);
        await telemetry.observe(execution(runId, 'running'), project(), completions(), 2_100);
        expect(events.filter((event) => event.properties.activity === 'acknowledged')).toHaveLength(1);
        expect(events.filter((event) => event.name === operationName)).toHaveLength(0);
        await telemetry.observe(execution(runId, 'complete', 5_000), project(), completions(), 5_000);
        await telemetry.observe(execution(runId, 'complete', 5_000), project(), completions(), 6_000);
        const outcomes = events.filter((event) => event.name === operationName);
        expect(outcomes).toHaveLength(1);
        expect(outcomes[0].properties).toMatchObject({
            outcome: 'completed',
            result: 'Succeeded',
            phase: 'assessment',
            validationResult: 'passed',
        });
        expect(outcomes[0].measurements).toMatchObject({
            durationMs: 4_000,
            acknowledgmentMs: 1_000,
            runIndex: 0,
            domainCount: 1,
        });
        expect(JSON.stringify(events)).not.toMatch(/private-|private-domain|private-table/);
        expect(JSON.stringify(events)).not.toContain(runId);
        expect(outcomes[0].properties.runId).toBe(events[0].properties.runId);
    });

    it('does not turn existing snapshots or another run into activity', async () => {
        const unlaunched = new MigrationSkillTelemetry((event) => events.push(event));
        await unlaunched.observe(execution('persisted-id', 'complete'), project(), completions());
        await telemetry.observe(execution('other-run', 'complete'), project(), completions());
        await telemetry.observe({ ...execution(runId, 'complete'), phase: 'discovery' }, project(), completions());
        expect(events).toEqual([]);
    });

    it('enriches dispatch and outcomes with normalized details and removes cleared optional dimensions', async () => {
        const p = project();
        p.phases.discovery.applicationAnalysis = {
            projectName: 'private-name',
            projectType: 'rest api',
            language: 'ts',
            frameworks: ['EF Core'],
            databaseAccess: 'Entity Framework Core',
        };
        const id = telemetry.begin(invocation, p, 1_100);
        telemetry.dispatched(id, 1_200);
        expect(events.at(-1)?.properties).toMatchObject({
            sourceProjectType: 'Web API',
            sourceLanguage: 'TypeScript',
            sourceFramework: 'Entity Framework Core',
            sourceDbAccess: 'ORM',
        });
        p.phases.discovery.applicationAnalysis.frameworks = [];
        p.phases.discovery.applicationAnalysis.language = 'csharp';
        await telemetry.observe(execution(id, 'complete'), p, completions(), 2_000);
        expect(events.at(-1)?.properties).toMatchObject({
            sourceProjectType: 'Web API',
            sourceLanguage: 'C#',
            sourceDbAccess: 'ORM',
        });
        expect(events.at(-1)?.properties.sourceFramework).toBeUndefined();
        expect(JSON.stringify(events)).not.toContain('private-');
    });

    it('rejects out-of-order activity and never exports its detail', async () => {
        await telemetry.observe(execution(runId, 'running', 3_000), project(), completions(), 3_000);
        await telemetry.observe(execution(runId, 'failed', 2_000), project(), completions(), 4_000);
        expect(events.some((event) => event.name === operationName)).toBe(false);
        expect(JSON.stringify(events)).not.toContain('private-query');
    });

    it('reports successful handoff even when completion races the dispatch return', async () => {
        await telemetry.observe(execution(runId, 'complete'), project(), completions(), 2_000);
        telemetry.dispatched(runId, 2_100);
        expect(events.filter((event) => event.name === 'cosmosDB.migration.skill.dispatch')).toHaveLength(1);
        expect(events.filter((event) => event.name === operationName)).toHaveLength(1);
    });

    it.each(['stale', 'unknown'] as const)('does not report success for %s phase evidence', async (freshness) => {
        const state = completions();
        state.assessment.freshness = freshness;
        await telemetry.observe(execution(runId, 'complete'), project(), state, 2_000);
        expect(events.at(-1)?.properties).toMatchObject({
            outcome: 'blocked',
            result: 'Failed',
            errorCategory: 'validation',
        });
    });

    it.each(['blocked', 'failed', 'cancelled'] as const)(
        'records explicit %s without raw error text',
        async (activity) => {
            await telemetry.observe(execution(runId, activity), project(), completions(), 2_000);
            expect(events.at(-1)?.properties.outcome).toBe(activity);
            expect(JSON.stringify(events)).not.toContain('private-query');
        },
    );

    it('records dispatch failure once and does not count it as agent acknowledgment', () => {
        telemetry.dispatchFailed(runId, false, 1_100);
        telemetry.dispatchFailed(runId, false, 1_200);
        expect(events).toHaveLength(2);
        expect(events.at(-1)?.properties).toMatchObject({ outcome: 'failed', errorCategory: 'dispatch' });
        expect(events.at(-1)?.measurements.acknowledgmentMs).toBeUndefined();
    });

    it('does not overwrite observed execution with a late dispatch failure', async () => {
        await telemetry.observe(execution(runId, 'running'), project(), completions(), 2_000);
        telemetry.dispatchFailed(runId, false, 2_100);
        expect(events.some((event) => event.name === operationName)).toBe(false);
        await telemetry.observe(execution(runId, 'complete', 3_000), project(), completions(), 3_000);
        expect(events.at(-1)?.properties.outcome).toBe('completed');
    });

    it('measures observed waits without counting a panel-closed interval as waiting', async () => {
        await telemetry.observe(execution(runId, 'waiting-for-decision', 2_000), project(), completions(), 2_000);
        await telemetry.observe(execution(runId, 'running', 3_000), project(), completions(), 3_000);
        await telemetry.observe(execution(runId, 'waiting-for-decision', 4_000), project(), completions(), 4_000);
        telemetry.unavailable('panelClosed', 4_500);
        await telemetry.observe(execution(runId, 'complete', 6_000), project(), completions(), 6_000);
        expect(events.at(-1)?.measurements.observedWaitingMs).toBe(1_000);
        expect(events.at(-1)?.properties.observationCoverage).toBe('interrupted');
    });

    it('does not claim Chat cancellation from local stop confirmation', () => {
        telemetry.confirmedStopped(2_000);
        expect(events.at(-1)?.properties).toMatchObject({
            outcome: 'unobserved',
            stopSource: 'userConfirmation',
        });
        expect(events.at(-1)?.properties.result).toBeUndefined();
    });

    it('finishes superseded tracking as unobserved and counts only extension-session attempts', () => {
        telemetry.begin(invocation, project(), 3_000);
        expect(events.at(-1)?.properties.outcome).toBe('unobserved');
        const nextId = telemetry.begin(invocation, project(), 4_000);
        telemetry.dispatched(nextId, 4_100);
        expect(events.at(-1)?.measurements.runIndex).toBe(2);
        expect(events.at(-1)?.properties.runIndexScope).toBe('extensionSession');
    });

    it('reports reviews as handoffs, not successful repairs', () => {
        const id = telemetry.begin({ ...invocation, intent: 'review-and-fix' }, project(), 2_000);
        telemetry.dispatched(id, 2_500);
        expect(events.at(-1)?.name).toBe('cosmosDB.migration.review');
        expect(events.at(-1)?.properties.outcome).toBe('handedOff');
    });

    it('does not finalize a stale validation snapshot after cancellation', async () => {
        const controller = new AbortController();
        const pending = telemetry.observe(execution(runId, 'complete'), project(), completions(), 2_000, {
            signal: controller.signal,
        });
        controller.abort();
        await pending;
        expect(events.some((event) => event.name === operationName)).toBe(false);
        await telemetry.observe(execution(runId, 'complete'), project(), completions(), 2_100);
        expect(events.at(-1)?.properties.outcome).toBe('completed');
    });

    it('uses the standard best-effort telemetry pipeline and rejects invalid measurements', async () => {
        reportMigrationTelemetry({
            name: operationName,
            properties: { outcome: 'completed' },
            measurements: { durationMs: 100, invalid: NaN, infinite: Infinity, negative: -1 },
        });
        await Promise.resolve();
        expect(telemetryContext.errorHandling).toMatchObject({ suppressDisplay: true, rethrow: false });
        expect(telemetryContext.telemetry.measurements).toEqual({ durationMs: 100 });
    });
});

describe('migration telemetry evidence', () => {
    let workspace: string;
    beforeEach(async () => {
        workspace = await mkdtemp(path.join(os.tmpdir(), 'migration-telemetry-'));
        await mkdir(path.join(workspace, '.cosmosdb-migration/phases/1-discovery'), { recursive: true });
    });
    afterEach(async () => rm(workspace, { recursive: true, force: true }));

    it('counts actual inventory tables independently of source files', async () => {
        await writeFile(
            path.join(workspace, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json'),
            JSON.stringify({
                sourceInventory: {
                    files: ['private-file'],
                    tables: [
                        { name: 'private-table-a', columns: [1, 2, 3], foreignKeys: [1] },
                        { name: 'private-table-b', columns: [1, 2], foreignKeys: [] },
                    ],
                },
            }),
        );
        const evidence = await collectMigrationTelemetryEvidence(
            { workspacePath: workspace, phase: 'discovery' },
            project(),
            completions(),
        );
        expect(evidence.validation).toBe('passed');
        expect(evidence.measurements).toMatchObject({
            schemaFileCount: 1,
            sourceInventoryTableCount: 2,
            sourceColumnCount: 5,
            sourceForeignKeyCount: 1,
        });
        expect(evidence.measurements.sourceTableCount).toBeUndefined();
        expect(JSON.stringify(evidence)).not.toContain('private-');
    });

    it('reports unreadable or malformed evidence as unavailable, not migration success or failure', async () => {
        const invocation: MigrationSkillInvocation = { workspacePath: workspace, phase: 'discovery' };
        expect(await collectMigrationTelemetryEvidence(invocation, project(), completions())).toMatchObject({
            validation: 'unavailable',
            errorCategory: 'evidenceRead',
        });
        await writeFile(path.join(workspace, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json'), '{');
        expect(await collectMigrationTelemetryEvidence(invocation, project(), completions())).toMatchObject({
            validation: 'unavailable',
            errorCategory: 'evidenceRead',
        });
    });

    it('validates application details without requiring unrelated preflight outputs', async () => {
        const state = completions();
        state.preflight.complete = false;
        state.preflight.freshness = 'unknown';
        const invocation: MigrationSkillInvocation = {
            workspacePath: workspace,
            phase: 'preflight',
            preflightStep: 'application-details',
        };
        expect((await collectMigrationTelemetryEvidence(invocation, project(), state)).validation).toBe('passed');
        state.preflight.artifacts.push({
            path: '.cosmosdb-migration/project.json#phases.discovery.applicationAnalysis',
            description: 'Complete application details',
            conditional: false,
            state: 'missing',
        });
        expect((await collectMigrationTelemetryEvidence(invocation, project(), state)).validation).toBe('failed');
    });

    it.each(['volumetrics', 'access-patterns'] as const)(
        'requires valid %s artifacts for focused completion',
        async (step) => {
            const state = completions();
            state.preflight.complete = false;
            state.preflight.freshness = 'unknown';
            const invocation: MigrationSkillInvocation = {
                workspacePath: workspace,
                phase: 'preflight',
                preflightStep: step,
            };
            expect((await collectMigrationTelemetryEvidence(invocation, project(), state)).validation).toBe('failed');
            state.preflight.artifacts.push({
                path: `.cosmosdb-migration/phases/1-discovery/${step}/${step}.md`,
                description: 'Reviewed input',
                conditional: false,
                state: 'present',
            });
            expect((await collectMigrationTelemetryEvidence(invocation, project(), state)).validation).toBe('passed');
        },
    );

    it('requires verified target evidence, without requiring containers for account provisioning', async () => {
        const state = completions();
        state.provisioning.complete = false;
        const invocation: MigrationSkillInvocation = {
            workspacePath: workspace,
            phase: 'provisioning',
            provisioningStep: 'target-account',
        };
        expect((await collectMigrationTelemetryEvidence(invocation, project(), state)).validation).toBe('failed');
        state.provisioning.artifacts.push({
            path: '.cosmosdb-migration/project.json#phases.targetEnvironment.verified',
            description: 'Verified target environment',
            conditional: false,
            state: 'present',
        });
        expect((await collectMigrationTelemetryEvidence(invocation, project(), state)).validation).toBe('passed');
    });

    it('never treats a validated plan as completed code migration', async () => {
        await writeFile(
            path.join(workspace, '.cosmosdb-migration/code-migration-manifest.json'),
            JSON.stringify({ mode: 'plan' }),
        );
        const invocation: MigrationSkillInvocation = {
            workspacePath: workspace,
            phase: 'code-migration',
            codeMigrationAction: 'migrate',
        };
        expect((await collectMigrationTelemetryEvidence(invocation, project(), completions())).validation).toBe(
            'failed',
        );
        expect(
            (
                await collectMigrationTelemetryEvidence(
                    { ...invocation, codeMigrationAction: 'plan' },
                    project(),
                    completions(),
                )
            ).validation,
        ).toBe('passed');
    });

    it('distinguishes checker failure from invalid migration outputs', async () => {
        const state = completions();
        state.assessment.staleInputs = [{ id: 'completion-check', reason: 'private-stack' }];
        expect(
            await collectMigrationTelemetryEvidence(
                { workspacePath: workspace, phase: 'assessment' },
                project(),
                state,
            ),
        ).toEqual({
            validation: 'unavailable',
            measurements: {},
            errorCategory: 'completionCheck',
        });
    });

    it('preserves the legacy per-domain container total and does not infer newly created containers', async () => {
        const state = completions();
        const p = project();
        p.phases.schemaConversion = { status: 'complete', domains: ['domain-a', 'domain-b'] };
        p.phases.assessment!.domains = [
            { name: 'domain-a', tables: [], isMapped: true, crossDomainDependencies: [], estimatedTokens: 0 },
            { name: 'domain-b', tables: [], isMapped: true, crossDomainDependencies: [], estimatedTokens: 0 },
            { name: 'skipped', tables: [], isMapped: false, crossDomainDependencies: [], estimatedTokens: 0 },
        ];
        for (const domain of p.phases.schemaConversion.domains!) {
            const relative = `.cosmosdb-migration/phases/3-schema-conversion/domains/${domain}/cosmos-model.json`;
            await mkdir(path.dirname(path.join(workspace, relative)), { recursive: true });
            await writeFile(path.join(workspace, relative), JSON.stringify({ containers: [{ name: 'shared' }] }));
            state['schema-conversion'].artifacts.push({
                path: relative,
                description: 'Domain model',
                state: 'present',
                conditional: false,
                canOpen: true,
            });
        }
        const evidence = await collectMigrationTelemetryEvidence(
            { workspacePath: workspace, phase: 'schema-conversion' },
            p,
            state,
        );
        expect(evidence.measurements).toMatchObject({ domainCount: 2, skippedDomainCount: 1, targetContainerCount: 2 });
        expect(evidence.validation).toBe('passed');
        p.phases.provisioning = { status: 'complete', containersCreated: ['shared'] };
        const provisioned = await collectMigrationTelemetryEvidence(
            { workspacePath: workspace, phase: 'provisioning' },
            p,
            state,
        );
        expect(provisioned.measurements.verifiedContainerCount).toBe(1);
        expect(provisioned.measurements.containersCreated).toBeUndefined();
    });

    it('requires a nonempty validated schema selection for schema acquisition', async () => {
        const state = completions();
        const invocation: MigrationSkillInvocation = {
            workspacePath: workspace,
            phase: 'preflight',
            preflightStep: 'schema-acquisition',
        };
        expect((await collectMigrationTelemetryEvidence(invocation, project(), state)).validation).toBe('failed');
        state.preflight.artifacts.push({
            path: 'private.sql',
            description: 'Authoritative schema DDL',
            state: 'present',
            conditional: false,
        });
        expect((await collectMigrationTelemetryEvidence(invocation, project(), state)).validation).toBe('passed');
        state.preflight.artifacts.at(-1)!.state = 'invalid';
        expect((await collectMigrationTelemetryEvidence(invocation, project(), state)).validation).toBe('failed');
    });
});
