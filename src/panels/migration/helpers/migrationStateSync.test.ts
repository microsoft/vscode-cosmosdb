/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    isMigrationInspectionCommand,
    isMigrationRunActive,
    migrationAcknowledgmentTimeout,
    MigrationRunTracker,
    type MigrationExecution,
} from '../../../webviews/cosmosdb/Migration/state/deriveMigrationPhaseStates';
import { readMigrationExecution, readMigrationPhaseCompletion, safeCheckPhaseCompletion } from './migrationStateSync';

describe('migrationStateSync', () => {
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
            expect(completion.discovery.status).toBe('complete');
            expect(completion.discovery.complete).toBe(false);
            expect(completion.discovery.artifacts).toContainEqual(
                expect.objectContaining({ description: 'Discovery summary', state: 'missing' }),
            );
            expect(await readMigrationExecution(extensionPath, workspace)).toBeUndefined();
            const projectPath = path.join(migrationRoot, 'project.json');
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
