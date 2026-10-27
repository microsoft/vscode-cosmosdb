/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import {
    isMigrationInspectionCommand,
    isMigrationRunActive,
    migrationAcknowledgmentTimeout,
    MigrationRunTracker,
    type MigrationExecution,
} from '../../../webviews/cosmosdb/Migration/state/deriveMigrationPhaseStates';
import {
    migrationPhaseNames,
    readMigrationExecution,
    readMigrationPhaseCompletion,
    safeCheckPhaseCompletion,
    toMigrationProjectView,
} from './migrationStateSync';

async function withCompletionChecker(source: string, check: (extensionPath: string) => Promise<void>): Promise<void> {
    const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'migration C# worker test '));
    const scriptsPath = path.join(extensionPath, 'skills', 'cosmosdb-relational-migration', 'scripts');
    fs.mkdirSync(scriptsPath, { recursive: true });
    fs.mkdirSync(path.join(extensionPath, '.cosmosdb-migration'));
    fs.writeFileSync(path.join(scriptsPath, 'check-phase-completion.mjs'), source);
    try {
        await check(extensionPath);
    } finally {
        fs.rmSync(extensionPath, { recursive: true });
    }
}

describe('migrationStateSync', () => {
    it('distinguishes checkpoint selectors from literal hashes in artifacts and freshness paths', async () => {
        const artifacts = [
            { path: 'main#draft.bicep', state: 'present' },
            { path: 'model.json#draft', state: 'present' },
            { path: 'missing#draft.bicep', state: 'present' },
            { path: '.cosmosdb-migration/project.json#phases.provisioning.completedAt', state: 'present' },
        ];
        const freshnessCauses = [
            { phase: 'discovery', id: 'source', path: 'src/C#/service.ts', reason: 'Changed' },
            { phase: 'discovery', id: 'notes', path: '.cosmosdb-migration/project.json#notes', reason: 'Changed' },
            { phase: 'discovery', id: 'missing', path: '.cosmosdb-migration/project.json#missing', reason: 'Missing' },
        ];
        await withCompletionChecker(
            `export function checkPhaseCompletions() {
                return { preflight: { artifacts: ${JSON.stringify(artifacts)}, freshnessCauses: ${JSON.stringify(freshnessCauses)} } };
            }`,
            async (workspace) => {
                fs.mkdirSync(path.join(workspace, 'src', 'C#'), { recursive: true });
                for (const file of [
                    'main#draft.bicep',
                    'model.json#draft',
                    'missing',
                    '.cosmosdb-migration/project.json',
                    '.cosmosdb-migration/project.json#notes',
                    'src/C#/service.ts',
                ]) {
                    fs.writeFileSync(path.join(workspace, file), '{}');
                }
                const result = await readMigrationPhaseCompletion(workspace, workspace);
                expect(result.preflight.artifacts.map((artifact) => artifact.canOpen)).toEqual([
                    true,
                    true,
                    false,
                    true,
                ]);
                expect(result.preflight.freshnessCauses?.map((cause) => cause.canOpen)).toEqual([true, true, false]);
            },
        );
    });

    it('preserves artifact diagnostics and opens only existing workspace files', async () => {
        const artifacts = [
            {
                path: 'invalid.json',
                state: 'invalid',
                diagnostics: [{ code: 'invalid-key', path: '$.id', message: 'Missing id' }],
            },
            { path: 'missing.json', state: 'missing' },
            { path: 'scripts', state: 'invalid' },
            { path: '../outside.json', state: 'invalid' },
            { path: 'outside/package.json', state: 'present' },
        ];
        await withCompletionChecker(
            `export function checkPhaseCompletions() {
            return { preflight: { artifacts: ${JSON.stringify(artifacts)}, freshnessCauses: [
                {phase:'preflight', id:'volumetrics', path:'invalid.json', reason:'Changed'},
                {phase:'preflight', id:'external', path:'outside/package.json', reason:'Changed'},
                {phase:'preflight', id:'missing', path:'missing.json', reason:'Missing'},
                {phase:'preflight', id:'settings', reason:'Changed'}
            ] } };
        }`,
            async (workspace) => {
                fs.writeFileSync(path.join(workspace, 'invalid.json'), '{');
                fs.mkdirSync(path.join(workspace, 'scripts'));
                fs.symlinkSync(process.cwd(), path.join(workspace, 'outside'), 'dir');
                const result = await readMigrationPhaseCompletion(workspace, workspace);
                expect(result.preflight.artifacts.map((artifact) => artifact.canOpen)).toEqual([
                    true,
                    false,
                    false,
                    false,
                    false,
                ]);
                expect(result.preflight.artifacts[0].diagnostics).toEqual(artifacts[0].diagnostics);
                expect(result.preflight.freshnessCauses?.map((cause) => cause.canOpen)).toEqual([
                    true,
                    false,
                    false,
                    false,
                ]);
            },
        );
    });

    const startedAt = '2026-10-04T10:00:00.000Z';
    const invocation = { workspacePath: '/workspace', phase: 'discovery' as const };
    const execution: MigrationExecution = {
        version: 1,
        runId: 'run-1',
        phase: 'discovery',
        step: null,
        activity: 'running',
        startedAt,
        updatedAt: startedAt,
        detail: '',
    };

    it('projects only display fields without changing the authoritative project', () => {
        const project: ProjectJson = {
            version: 1,
            name: 'migration-app',
            sourceCode: 'parent',
            migrationInstructions: 'Keep source keys.',
            consentGiven: true,
            phases: {
                discovery: {
                    status: 'complete',
                    discoveryInstructions: 'Inspect the service.',
                    applicationAnalysis: {
                        projectName: 'source-app',
                        projectType: 'service',
                        language: 'TypeScript',
                        frameworks: ['Express'],
                        databaseType: 'PostgreSQL',
                        databaseAccess: 'ORM',
                        completedAt: startedAt,
                    },
                },
                assessment: { status: 'complete', assessmentInstructions: 'Group by ownership.' },
                schemaConversion: { status: 'complete', schemaConversionInstructions: 'Preserve identifiers.' },
                targetEnvironment: {
                    type: 'azure',
                    endpoint: 'https://example.invalid',
                    accountName: 'target-account',
                    subscriptionId: 'subscription',
                    subscriptionName: 'Test subscription',
                    tenantId: 'tenant',
                    resourceGroup: 'test-group',
                    location: 'westus',
                    verified: true,
                    verifiedAt: startedAt,
                    capacityMode: 'serverless',
                },
            },
        };
        const bulk = 'artifact-data'.repeat(10000);
        Object.assign(project, { freshness: bulk, execution: { detail: bulk }, futureMetadata: bulk });
        Object.assign(project.phases.discovery, { schemaInventory: { files: [bulk] } });
        Object.assign(project.phases.discovery.applicationAnalysis!, { futureMetadata: bulk });
        Object.assign(project.phases.assessment!, { domains: [bulk], parsedAccessPatterns: [bulk] });
        Object.assign(project.phases.schemaConversion!, { domains: [bulk] });
        Object.assign(project.phases.targetEnvironment!, { futureMetadata: bulk });
        const original = JSON.stringify(project);

        const view = toMigrationProjectView(project);
        const serialized = JSON.stringify(view);
        expect(JSON.parse(serialized)).toEqual({
            name: 'migration-app',
            migrationInstructions: 'Keep source keys.',
            phases: {
                discovery: {
                    discoveryInstructions: 'Inspect the service.',
                    applicationAnalysis: {
                        projectName: 'source-app',
                        projectType: 'service',
                        language: 'TypeScript',
                        frameworks: ['Express'],
                        databaseType: 'PostgreSQL',
                        databaseAccess: 'ORM',
                    },
                },
                assessment: { assessmentInstructions: 'Group by ownership.' },
                schemaConversion: { schemaConversionInstructions: 'Preserve identifiers.' },
                targetEnvironment: {
                    type: 'azure',
                    endpoint: 'https://example.invalid',
                    accountName: 'target-account',
                    subscriptionId: 'subscription',
                    subscriptionName: 'Test subscription',
                    resourceGroup: 'test-group',
                    location: 'westus',
                    verified: true,
                },
            },
        });
        expect(Buffer.byteLength(serialized)).toBeLessThan(2048);
        expect(JSON.stringify(project)).toBe(original);
    });

    it('keeps sparse projects and invalid application analysis uninitialized', () => {
        const project: ProjectJson = {
            version: 1,
            name: 'new-project',
            sourceCode: 'parent',
            phases: { discovery: { status: 'not-started' } },
        };
        for (const applicationAnalysis of [undefined, null, 'invalid', 1, []]) {
            Object.assign(project.phases.discovery, { applicationAnalysis });
            expect(JSON.parse(JSON.stringify(toMigrationProjectView(project)))).toEqual({
                name: 'new-project',
                phases: { discovery: {} },
            });
        }
    });

    it('keeps inspection available while guarding mutating commands', () => {
        for (const command of [
            'openMigrationChat',
            'loadProject',
            'openFile',
            'previewMarkdown',
            'openVolumetricsTemplate',
            'openAccessPatternsTemplate',
        ]) {
            expect(isMigrationInspectionCommand(command)).toBe(true);
        }
        for (const command of [
            'runDiscovery',
            'analyzeApplication',
            'resetProject',
            'setTargetEnvironment',
            'updateProjectName',
        ]) {
            expect(isMigrationInspectionCommand(command)).toBe(false);
        }
    });

    it('shows submitted work as running before the agent reports activity', () => {
        const tracker = new MigrationRunTracker();
        const now = Date.parse(startedAt);
        tracker.begin('run-1', invocation, now);
        expect(tracker.snapshot(now)?.activity).toBe('launching');
        expect(() => tracker.begin('run-2', invocation, now)).toThrow('already active');
        tracker.dispatched('run-1');
        expect(tracker.snapshot(now)?.activity).toBe('running');
        tracker.observe(undefined, {});
        expect(tracker.snapshot(now + migrationAcknowledgmentTimeout * 10)?.activity).toBe('running');
        expect(isMigrationRunActive(tracker.snapshot(now + migrationAcknowledgmentTimeout * 10))).toBe(true);
        expect(() => tracker.begin('run-2', invocation, now)).toThrow('already active');
        tracker.observe(execution, {});
        expect(tracker.snapshot(now + migrationAcknowledgmentTimeout * 10)?.activity).toBe('running');
    });

    it('clears locally running status on failure before agent acknowledgment', () => {
        const tracker = new MigrationRunTracker();
        tracker.begin('run-1', invocation, Date.parse(startedAt));
        tracker.dispatched('run-1');
        tracker.failed('run-1', 'Launch failed');
        expect(tracker.snapshot()).toMatchObject({ activity: 'failed', detail: 'Launch failed' });
        expect(isMigrationRunActive(tracker.snapshot())).toBe(false);
    });

    it('bounds an unresolved Chat dispatch without treating it as cancellation', () => {
        const tracker = new MigrationRunTracker();
        const now = Date.parse(startedAt);
        tracker.begin('run-1', invocation, now);
        expect(tracker.snapshot(now + migrationAcknowledgmentTimeout)?.activity).toBe('unknown');
        expect(isMigrationRunActive(tracker.snapshot(now + migrationAcknowledgmentTimeout))).toBe(true);
        tracker.dispatched('run-1');
        expect(tracker.snapshot(now + migrationAcknowledgmentTimeout)?.activity).toBe('running');
    });

    it('keeps agent acknowledgment and decisions authoritative over dispatch callbacks', () => {
        const tracker = new MigrationRunTracker();
        tracker.begin('run-1', invocation, Date.parse(startedAt));
        tracker.observe(execution, {});
        tracker.failed('run-1', 'late failure');
        tracker.dispatched('run-1');
        expect(tracker.snapshot()?.activity).toBe('running');
        tracker.observe({ ...execution, activity: 'waiting-for-decision' }, {});
        expect(isMigrationRunActive(tracker.snapshot())).toBe(true);
        tracker.observe({ ...execution, activity: 'blocked', detail: 'Missing DDL' }, {});
        expect(tracker.snapshot()).toMatchObject({ activity: 'blocked', detail: 'Missing DDL' });
        expect(isMigrationRunActive(tracker.snapshot())).toBe(false);
    });

    it('requires checked phase completion while distinguishing a finished focused request', () => {
        const tracker = new MigrationRunTracker();
        tracker.observe({ ...execution, activity: 'complete' }, { discovery: { complete: false } });
        expect(tracker.snapshot()).toMatchObject({ activity: 'blocked', validationFailed: true });
        tracker.observe({ ...execution, activity: 'complete' }, { discovery: { complete: true } });
        expect(tracker.snapshot()?.activity).toBe('complete');
        tracker.observe({ ...execution, phase: 'preflight', step: 'volumetrics', activity: 'complete' }, {});
        expect(tracker.snapshot()).toMatchObject({ activity: 'complete', validationFailed: false });
    });

    it('preserves a completed run when its evidence later becomes stale, including after reopening', () => {
        const tracker = new MigrationRunTracker();
        const completed = { ...execution, activity: 'complete' as const, detail: 'Discovery completed.' };
        tracker.observe(completed, { discovery: { complete: true, freshness: 'current' } });
        tracker.observe(completed, { discovery: { complete: false, freshness: 'stale' } });
        expect(tracker.snapshot()).toMatchObject({
            activity: 'complete',
            validationFailed: true,
            detail: 'Discovery completed.',
        });
        const reopened = new MigrationRunTracker();
        reopened.observe(completed, { discovery: { complete: false, freshness: 'stale' } });
        expect(reopened.snapshot()).toMatchObject({ activity: 'complete', validationFailed: true });
        reopened.observe({ ...completed, activity: 'blocked' }, { discovery: { complete: false, freshness: 'stale' } });
        expect(reopened.snapshot()?.activity).toBe('blocked');
    });

    it('does not revive a confirmed stopped run or let an old callback clear a new launch', () => {
        const tracker = new MigrationRunTracker();
        tracker.observe(execution, {});
        tracker.confirmStopped();
        tracker.observe(execution, {});
        expect(tracker.snapshot()?.activity).toBe('cancelled');
        const now = Date.parse(startedAt) + 1;
        tracker.begin('run-2', invocation, now);
        tracker.failed('run-1', 'old failure');
        tracker.observe(execution, {});
        expect(tracker.snapshot(now)).toMatchObject({ runId: 'run-2', activity: 'launching' });
    });

    it('turns an unexpected checker exception into incomplete state', () => {
        const completion = safeCheckPhaseCompletion(
            {
                checkPhaseCompletion: () => {
                    throw new TypeError("Cannot read properties of undefined (reading 'includes')");
                },
            },
            '/workspace',
            'code-migration',
        );

        expect(completion).toMatchObject({
            phase: 'code-migration',
            complete: false,
            freshness: 'unknown',
            staleInputs: [{ id: 'completion-check', reason: 'Completion checker failed unexpectedly' }],
            artifacts: [],
            errors: [expect.stringContaining("reading 'includes'")],
        });
    });

    it('checks every phase off-thread and passes workspace paths as data', async () => {
        await withCompletionChecker(
            `import { isMainThread } from 'node:worker_threads';
             export function checkPhaseCompletions(workspace, phases) {
                 return Object.fromEntries(phases.map(phase => [phase, {
                     phase, status: 'not-started', complete: false, freshness: 'unknown',
                     staleInputs: [], artifacts: [], errors: [String(isMainThread), workspace],
                 }]));
             }`,
            async (extensionPath) => {
                const workspace = path.join(extensionPath, 'workspace with spaces', '"quoted"');
                fs.mkdirSync(path.join(workspace, '.cosmosdb-migration'), { recursive: true });
                const completion = await readMigrationPhaseCompletion(extensionPath, workspace);
                expect(Object.keys(completion)).toEqual([...migrationPhaseNames]);
                expect(completion.discovery.errors).toEqual(['false', workspace]);
            },
        );
    });

    it.each([
        ['throw new Error("Import failed");', 'Import failed'],
        ['export function checkPhaseCompletions() { throw new Error("Validation failed"); }', 'Validation failed'],
        ['export function checkPhaseCompletions() { process.exit(0); }', 'exited without a result'],
    ])('rejects worker failures without hanging: %s', async (source, message) => {
        await withCompletionChecker(source, async (extensionPath) => {
            await expect(readMigrationPhaseCompletion(extensionPath, extensionPath)).rejects.toThrow(message);
        });
    });

    it('cancels an active worker and permits the next check', async () => {
        await withCompletionChecker('export function checkPhaseCompletions() { return {}; }', async (extensionPath) => {
            const controller = new AbortController();
            const pending = readMigrationPhaseCompletion(extensionPath, extensionPath, controller.signal);
            controller.abort();
            await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
            await expect(readMigrationPhaseCompletion(extensionPath, extensionPath)).resolves.toEqual({});
            await expect(
                readMigrationPhaseCompletion(extensionPath, extensionPath, controller.signal),
            ).rejects.toMatchObject({ name: 'AbortError' });
        });
    });

    it('treats an absent migration folder as a new migration without creating files', async () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-state-new-'));
        const extensionPath = path.resolve(__dirname, '../../../..');
        const migrationRoot = path.join(workspace, '.cosmosdb-migration');
        try {
            const fresh = await readMigrationPhaseCompletion(extensionPath, workspace);
            expect(Object.keys(fresh)).toEqual([...migrationPhaseNames]);
            for (const phase of migrationPhaseNames) {
                expect(fresh[phase]).toEqual({
                    phase,
                    status: 'not-started',
                    complete: false,
                    freshness: 'not-applicable',
                    staleInputs: [],
                    artifacts: [],
                    errors: [],
                });
            }
            expect(fs.existsSync(migrationRoot)).toBe(false);
            fs.mkdirSync(migrationRoot);
            const missingProject = await readMigrationPhaseCompletion(extensionPath, workspace);
            expect(missingProject.discovery.errors).toContain('project.json is missing or invalid');
            fs.writeFileSync(path.join(migrationRoot, 'project.json'), '{');
            const invalidProject = await readMigrationPhaseCompletion(extensionPath, workspace);
            expect(invalidProject.discovery.errors).toContain('project.json is missing or invalid');
            fs.rmSync(migrationRoot, { recursive: true });
            expect(await readMigrationPhaseCompletion(extensionPath, workspace)).toEqual(fresh);
            expect(fs.existsSync(migrationRoot)).toBe(false);
        } finally {
            fs.rmSync(workspace, { recursive: true });
        }
    });

    it('uses status plus portable artifact validation', async () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-state-sync-'));
        const migrationRoot = path.join(workspace, '.cosmosdb-migration');
        fs.mkdirSync(migrationRoot, { recursive: true });
        fs.writeFileSync(
            path.join(migrationRoot, 'project.json'),
            `${JSON.stringify({
                version: 1,
                name: 'migration-app',
                sourceCode: 'parent',
                phases: { discovery: { status: 'complete' } },
            })}\n`,
        );

        try {
            const extensionPath = path.resolve(__dirname, '../../../..');
            const completion = await readMigrationPhaseCompletion(extensionPath, workspace);
            expect(Object.keys(completion)).toEqual([...migrationPhaseNames]);
            expect(completion.discovery.status).toBe('complete');
            expect(completion.discovery.complete).toBe(false);
            expect(completion.discovery.artifacts).toContainEqual(
                expect.objectContaining({ description: 'Discovery summary', state: 'missing' }),
            );
            expect(await readMigrationExecution(extensionPath, workspace)).toBeUndefined();
            const projectPath = path.join(migrationRoot, 'project.json');
            const updatedProject = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
            updatedProject.phases.discovery.status = 'in-progress';
            fs.writeFileSync(projectPath, JSON.stringify(updatedProject));
            const updatedCompletion = await readMigrationPhaseCompletion(extensionPath, workspace);
            expect(updatedCompletion.discovery.status).toBe('in-progress');
            expect(completion.discovery.status).toBe('complete');

            const content = JSON.stringify({ version: 1, execution });
            fs.writeFileSync(projectPath, content);
            expect(await readMigrationExecution(extensionPath, workspace)).toEqual(execution);
            expect(fs.readFileSync(projectPath, 'utf8')).toBe(content);
            fs.writeFileSync(projectPath, JSON.stringify({ execution: { ...execution, activity: 'invented' } }));
            await expect(readMigrationExecution(extensionPath, workspace)).rejects.toThrow('$.execution.activity');
        } finally {
            fs.rmSync(workspace, { recursive: true });
        }
    });
});
