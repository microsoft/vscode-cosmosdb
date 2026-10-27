/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { toMigrationProjectView } from '../../../../panels/migration/helpers/migrationStateSync';
import { MigrationGeneratedArtifacts, MigrationPhaseDiagnostics } from '../MigrationAssistant';
import {
    deriveMigrationPhaseStates,
    getMigrationPhaseOutcome,
    getMigrationPrerequisite,
    getMigrationRunPhase,
    isCodeMigrationReady,
    isDiscoveryLaunchReady,
    MigrationRunTracker,
    shouldResetMigrationTargetEndpoint,
    type MigrationCompletionMap,
    type MigrationPhaseName,
    type MigrationRunActivity,
} from './deriveMigrationPhaseStates';
import { MigrationChannel, type Channel } from './MigrationChannel';
import { useMigrationDispatch, useMigrationState, WithMigrationContext } from './MigrationContext';

describe('shouldResetMigrationTargetEndpoint', () => {
    it.each(['azure', 'provision'] as const)('clears the emulator endpoint when selecting %s', (targetType) => {
        expect(shouldResetMigrationTargetEndpoint('emulator', targetType)).toBe(true);
        expect(shouldResetMigrationTargetEndpoint(targetType, 'emulator')).toBe(true);
    });

    it('clears an existing account endpoint when selecting a new account', () => {
        expect(shouldResetMigrationTargetEndpoint('azure', 'provision', 'old', 'new')).toBe(true);
        expect(shouldResetMigrationTargetEndpoint('azure', 'provision', 'same', 'same')).toBe(true);
        expect(shouldResetMigrationTargetEndpoint('provision', 'provision', 'old', 'new')).toBe(true);
        expect(shouldResetMigrationTargetEndpoint('azure', null)).toBe(true);
    });

    it('preserves an endpoint when adopting the same provisioned account', () => {
        expect(shouldResetMigrationTargetEndpoint('provision', 'azure')).toBe(false);
    });

    it('preserves endpoints for same-target partial updates', () => {
        expect(shouldResetMigrationTargetEndpoint('emulator', 'emulator')).toBe(false);
        expect(shouldResetMigrationTargetEndpoint('azure', 'azure')).toBe(false);
        expect(shouldResetMigrationTargetEndpoint('provision', 'provision', 'same', 'same')).toBe(false);
        expect(shouldResetMigrationTargetEndpoint('provision', 'provision', 'same', null)).toBe(false);
        expect(shouldResetMigrationTargetEndpoint('provision', 'provision', 'same')).toBe(false);
    });
});

describe('Discovery launch readiness', () => {
    const ready = {
        projectName: 'migration-app',
        consentGiven: true,
        selectedModelId: 'auto',
        isAIFeaturesEnabled: true,
    };

    it('allows launch without application analysis, schema files, or preflight completion', () => {
        expect(isDiscoveryLaunchReady(ready)).toBe(true);
    });

    it.each([
        { projectName: '' },
        { projectName: '   ' },
        { consentGiven: false },
        { selectedModelId: null },
        { selectedModelId: '' },
        { isAIFeaturesEnabled: false },
    ])('requires all launch preconditions: %j', (missing) => {
        expect(isDiscoveryLaunchReady({ ...ready, ...missing })).toBe(false);
    });
});

describe('migration model state', () => {
    const models = ['auto', 'first', 'second'].map((id) => ({
        id,
        name: id,
        family: id,
        vendor: 'copilot',
        maxInputTokens: 100_000,
    }));
    const channel: Channel = { on: () => ({ dispose: () => {} }), postMessage: async () => {} };
    const setup = () =>
        renderHook(() => ({ state: useMigrationState(), dispatch: useMigrationDispatch() }), {
            wrapper: ({ children }: { children: ReactNode }) =>
                createElement(WithMigrationContext, { channel }, children),
        });

    it('clears stale UI endpoints when selecting or renaming a new account', () => {
        const { result } = setup();
        act(() => result.current.dispatch({ type: 'SET_TARGET_TYPE', payload: 'emulator' }));
        act(() => result.current.dispatch({ type: 'SET_TARGET_ENDPOINT', payload: 'https://localhost:8081/' }));
        act(() => result.current.dispatch({ type: 'SET_TARGET_TYPE', payload: 'provision' }));
        expect(result.current.state.targetEndpoint).toBe('');
        expect(result.current.state.accountProvisioningState).toBe('available');
        expect(result.current.state.connectionVerified).toBe(false);

        act(() => result.current.dispatch({ type: 'SET_TARGET_ACCOUNT_NAME', payload: 'old-account' }));
        act(() =>
            result.current.dispatch({
                type: 'SET_TARGET_ENDPOINT',
                payload: 'https://old-account.documents.azure.com/',
            }),
        );
        act(() => result.current.dispatch({ type: 'SET_TARGET_ACCOUNT_NAME', payload: 'new-account' }));
        expect(result.current.state.targetEndpoint).toBe('');
        expect(result.current.state.accountProvisioningState).toBe('available');
    });

    it('preserves saved Auto across model refreshes', () => {
        const { result } = setup();
        act(() =>
            result.current.dispatch({
                type: 'SET_MODELS',
                payload: { models, savedModelId: 'auto' },
            }),
        );
        expect(result.current.state.selectedModelId).toBe('auto');
        expect(result.current.state.savedModelId).toBe('auto');
        expect(result.current.state.availableModels.map((model) => model.id)).toEqual(['first', 'second', 'auto']);
        act(() =>
            result.current.dispatch({
                type: 'SET_MODELS',
                payload: { models, savedModelId: 'auto' },
            }),
        );
        expect(result.current.state.selectedModelId).toBe('auto');
    });

    it('replaces the saved preference only on explicit selection', () => {
        const { result } = setup();
        act(() =>
            result.current.dispatch({
                type: 'SET_MODELS',
                payload: { models, savedModelId: 'auto' },
            }),
        );
        act(() => result.current.dispatch({ type: 'SET_SELECTED_MODEL', payload: 'second' }));
        expect(result.current.state.savedModelId).toBe('second');
        expect(result.current.state.selectedModelId).toBe('second');
    });

    it('supports an empty model list without losing the saved preference', () => {
        const { result } = setup();
        act(() =>
            result.current.dispatch({
                type: 'SET_MODELS',
                payload: { models: [], savedModelId: 'auto' },
            }),
        );
        expect(result.current.state.selectedModelId).toBeNull();
        expect(result.current.state.savedModelId).toBe('auto');
    });
});

describe('migration selection command ordering', () => {
    const setup = () => {
        const mutate = vi
            .fn<(input: { commandName: string; params: unknown[] }) => Promise<unknown>>()
            .mockResolvedValue(undefined);
        const channel = new MigrationChannel({
            migration: { events: { subscribe: () => ({ unsubscribe: () => {} }) }, command: { mutate } },
        } as unknown as ConstructorParameters<typeof MigrationChannel>[0]);
        const post = (commandName: string, ...params: unknown[]) =>
            channel.postMessage({
                type: 'event',
                name: 'command',
                params: [{ commandName, params }],
            });
        return { channel, mutate, post };
    };

    it('waits for a model save before dispatching', async () => {
        const { channel, mutate, post } = setup();
        let finish!: () => void;
        mutate.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
        );
        const selection = post('setSelectedModel', 'auto');
        const dispatch = post('runDiscovery');
        await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        expect(mutate).toHaveBeenCalledWith({ commandName: 'setSelectedModel', params: ['auto'] });
        finish();
        await Promise.all([selection, dispatch]);
        expect(mutate.mock.calls.map(([input]) => input.commandName)).toEqual(['setSelectedModel', 'runDiscovery']);
        channel.dispose();
    });

    it.each([
        'analyzeVolumetrics',
        'analyzeAccessPatterns',
        'analyzeDatabaseSchema',
        'analyzeApplication',
        'runDiscovery',
        'runAssessment',
        'runSchemaConversion',
        'reviewMigrationPhase',
        'provisionAccount',
        'populateSampleData',
        'planMigration',
        'migrateApplication',
    ])('blocks %s after a failed save and recovers on an explicit new choice', async (command) => {
        const { channel, mutate, post } = setup();
        mutate.mockRejectedValueOnce(new Error('save failed'));
        await expect(post('setSelectedModel', 'auto')).rejects.toThrow('save failed');
        await expect(post(command)).rejects.toThrow('save failed');
        expect(mutate).toHaveBeenCalledTimes(1);
        await post('setSelectedModel', 'first');
        await post(command);
        expect(mutate).toHaveBeenCalledTimes(3);
        channel.dispose();
    });

    it.each([
        'loadProject',
        'getAvailableModels',
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
        'resetProject',
        'updateConsent',
        'updateProjectName',
    ])('allows %s after a failed save without unblocking launches', async (command) => {
        const { channel, mutate, post } = setup();
        try {
            mutate.mockRejectedValueOnce(new Error('save failed'));
            await expect(post('setSelectedModel', 'auto')).rejects.toThrow('save failed');
            await expect(post(command)).resolves.toBeUndefined();
            await expect(post('runDiscovery')).rejects.toThrow('save failed');
            expect(mutate.mock.calls.map(([input]) => input.commandName)).toEqual(['setSelectedModel', command]);
        } finally {
            channel.dispose();
        }
    });

    it.each(['loadProject', 'resetProject', 'updateConsent', 'updateProjectName'])(
        'allows %s while a save is pending but keeps launches ordered',
        async (command) => {
            const { channel, mutate, post } = setup();
            let finish!: () => void;
            mutate.mockReturnValueOnce(
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
            );
            const selection = post('setSelectedModel', 'auto');
            const launch = post('runDiscovery');
            await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
            const independent = post(command);
            try {
                await vi.waitFor(() => {
                    expect(mutate.mock.calls.map(([input]) => input.commandName)).toEqual([
                        'setSelectedModel',
                        command,
                    ]);
                });
            } finally {
                finish();
                await Promise.all([selection, launch, independent]);
                channel.dispose();
            }
            expect(mutate.mock.calls.map(([input]) => input.commandName)).toEqual([
                'setSelectedModel',
                command,
                'runDiscovery',
            ]);
        },
    );

    it('surfaces inspection errors instead of the earlier model-save error', async () => {
        const { channel, mutate, post } = setup();
        try {
            mutate.mockRejectedValueOnce(new Error('save failed'));
            await expect(post('setSelectedModel', 'auto')).rejects.toThrow('save failed');
            mutate.mockRejectedValueOnce(new Error('file unavailable'));
            await expect(post('openFile', 'report.md')).rejects.toThrow('file unavailable');
            expect(mutate).toHaveBeenLastCalledWith({ commandName: 'openFile', params: ['report.md'] });
        } finally {
            channel.dispose();
        }
    });
});

function completion(overrides: Partial<Record<MigrationPhaseName, boolean>> = {}): MigrationCompletionMap {
    const phase = (name: MigrationPhaseName): MigrationCompletionMap[MigrationPhaseName] => ({
        phase: name,
        status: overrides[name] ? 'complete' : 'not-started',
        complete: overrides[name] ?? false,
        artifacts: [],
        errors: [],
    });
    return {
        preflight: phase('preflight'),
        discovery: phase('discovery'),
        assessment: phase('assessment'),
        'schema-conversion': phase('schema-conversion'),
        provisioning: phase('provisioning'),
        'code-migration': phase('code-migration'),
    };
}

describe('migration project reload', () => {
    it('restores historical projects without bypassing portable evidence validation', () => {
        const on = vi.fn<Channel['on']>(() => ({ dispose: () => {} }));
        const channel: Channel = { on, postMessage: async () => {} };
        const { result } = renderHook(() => useMigrationState(), {
            wrapper: ({ children }: { children: ReactNode }) =>
                createElement(WithMigrationContext, { channel }, children),
        });
        const projectLoaded = on.mock.calls.find(([name]) => name === 'projectLoaded')?.[1] as
            | ((data: unknown) => void)
            | undefined;
        if (!projectLoaded) throw new Error('Missing projectLoaded subscription');

        const phases = completion();
        phases.discovery.status = 'complete';
        const reload = (verified = false) => {
            act(() =>
                projectLoaded({
                    project: toMigrationProjectView({
                        version: 1,
                        name: 'legacy-project',
                        sourceCode: 'parent',
                        migrationInstructions: 'Preserve source keys.',
                        phases: {
                            discovery: {
                                status: phases.discovery.status ?? 'not-started',
                                discoveryInstructions: 'Inspect the application.',
                                applicationAnalysis: {
                                    projectName: 'source-project',
                                    projectType: 'service',
                                    language: 'TypeScript',
                                    frameworks: ['Express'],
                                    databaseType: 'PostgreSQL',
                                    databaseAccess: 'ORM',
                                },
                            },
                            assessment: {
                                status: phases.assessment.status ?? 'not-started',
                                assessmentInstructions: 'Group by ownership.',
                            },
                            schemaConversion: {
                                status: 'not-started',
                                schemaConversionInstructions: 'Preserve identifiers.',
                            },
                            targetEnvironment: {
                                type: 'emulator',
                                endpoint: 'https://localhost:8081/',
                                accountName: 'target-account',
                                subscriptionId: 'subscription',
                                subscriptionName: 'Test subscription',
                                resourceGroup: 'test-group',
                                location: 'westus',
                                verified,
                            },
                        },
                    }),
                    workspacePath: '/workspace',
                    schemaFiles: [],
                    volumetricFiles: [],
                    accessPatternFiles: [],
                    excludedSchemaFiles: [],
                    excludedVolumetricFiles: [],
                    excludedAccessPatternFiles: [],
                    hasDiscoveryReport: true,
                    hasAssessmentSummary: phases.assessment.status === 'complete',
                    assessmentResult: null,
                    hasSchemaConversion: false,
                    schemaConversionResult: null,
                    hasSampleData: false,
                    hasBicep: false,
                    hasVolumetricsTemplate: false,
                    hasAccessPatternsTemplate: false,
                    isAIFeaturesEnabled: true,
                    consentGiven: true,
                    hasCodeMigrationPlan: false,
                    codeMigrationPlanPath: '',
                    phaseCompletion: phases,
                    runActivity: null,
                }),
            );
        };

        reload();
        expect(result.current).toMatchObject({
            projectName: 'legacy-project',
            migrationInstructions: 'Preserve source keys.',
            discoveryInstructions: 'Inspect the application.',
            assessmentInstructions: 'Group by ownership.',
            schemaConversionInstructions: 'Preserve identifiers.',
            analysisState: 'complete',
            analysisResult: {
                projectName: 'source-project',
                projectType: 'service',
                language: 'TypeScript',
                frameworks: ['Express'],
                databaseType: 'PostgreSQL',
                databaseAccess: 'ORM',
            },
            targetType: 'emulator',
            targetEndpoint: 'https://localhost:8081/',
            targetAccountName: 'target-account',
            targetSubscriptionId: 'subscription',
            targetSubscriptionName: 'Test subscription',
            targetResourceGroup: 'test-group',
            targetLocation: 'westus',
            connectionVerified: false,
            discoveryState: 'available',
            assessmentState: 'locked',
            schemaConversionState: 'locked',
            connectionTestState: 'locked',
        });

        phases.assessment.status = 'complete';
        reload();
        expect(result.current).toMatchObject({
            discoveryState: 'available',
            assessmentState: 'available',
            schemaConversionState: 'locked',
            connectionTestState: 'locked',
        });

        expect(phases.discovery.complete).toBe(false);

        phases['code-migration'].ready = true;
        reload();
        expect(result.current).toMatchObject({ discoveryState: 'complete', connectionTestState: 'locked' });

        reload(true);
        expect(result.current.connectionTestState).toBe('complete');
    });
});

describe('migration phase outcomes', () => {
    afterEach(cleanup);
    const activity: MigrationRunActivity = {
        version: 1,
        runId: 'blocked-run',
        phase: 'schema-conversion',
        step: null,
        activity: 'blocked',
        startedAt: '2026-10-15T00:00:00.000Z',
        updatedAt: '2026-10-15T00:01:00.000Z',
        detail: 'Model needs review.',
    };

    it('retains a terminal blocker without changing the persisted checkpoint or other phases', () => {
        const phases = completion({ discovery: true, assessment: true, 'schema-conversion': true });
        expect(getMigrationPhaseOutcome('schema-conversion', phases, activity)).toBe('blocked');
        expect(getMigrationPhaseOutcome('assessment', phases, activity)).toBeNull();
        expect(phases['schema-conversion'].status).toBe('complete');
    });

    it.each(['running', 'waiting-for-decision', 'unknown'] as const)('does not present %s as terminal', (current) => {
        const phases = completion();
        phases['schema-conversion'].status = 'complete';
        expect(getMigrationPhaseOutcome('schema-conversion', phases, { ...activity, activity: current })).toBeNull();
    });

    it('locates the checkpoint of an all-phase blocker', () => {
        const phases = completion();
        phases.assessment.status = 'in-progress';
        expect(getMigrationRunPhase({ ...activity, phase: 'all' }, phases)).toBe('assessment');
        expect(getMigrationPhaseOutcome('assessment', phases, { ...activity, phase: 'all' })).toBe('blocked');
    });

    it('finds the earliest unmet prerequisite without invalidating accepted code-migration readiness', () => {
        const phases = completion({ preflight: true, discovery: true });
        expect(getMigrationPrerequisite('schema-conversion', phases)).toBe('assessment');
        phases.discovery.complete = false;
        expect(getMigrationPrerequisite('schema-conversion', phases)).toBe('discovery');
        phases['code-migration'].ready = true;
        expect(getMigrationPrerequisite('code-migration', phases)).toBeNull();
    });

    it('shows failed validation and freshness without inventing blockers for unstarted phases', () => {
        const phases = completion();
        expect(getMigrationPhaseOutcome('schema-conversion', phases, null)).toBeNull();
        phases['schema-conversion'].status = 'complete';
        expect(getMigrationPhaseOutcome('schema-conversion', phases, null)).toBe('invalid');
        phases['schema-conversion'].freshness = 'stale';
        expect(getMigrationPhaseOutcome('schema-conversion', phases, null)).toBe('stale');
        phases['schema-conversion'].freshness = 'unknown';
        expect(getMigrationPhaseOutcome('schema-conversion', phases, null)).toBe('unknown');
    });

    it.each([
        ['project', 'project-invalid'],
        ['completion-check', 'validation-unavailable'],
        ['phase', 'validation-unavailable'],
    ] as const)('distinguishes %s failures from freshness and prevents guessed prerequisites', (id, outcome) => {
        const phases = completion();
        phases.assessment.status = 'complete';
        phases.assessment.freshness = 'unknown';
        phases.assessment.staleInputs = [{ id, reason: 'Validation could not run' }];
        expect(getMigrationPhaseOutcome('assessment', phases, null)).toBe(outcome);
        expect(getMigrationPrerequisite('assessment', phases)).toBeUndefined();
        expect(getMigrationPrerequisite('schema-conversion', phases)).toBeUndefined();
        expect(
            getMigrationPhaseOutcome('assessment', phases, { ...activity, phase: 'assessment', activity: 'running' }),
        ).toBeNull();
    });

    it('does not guess prerequisites when completion results are missing', () => {
        expect(getMigrationPrerequisite('assessment', undefined)).toBeUndefined();
        expect(getMigrationPrerequisite('assessment', { assessment: completion().assessment })).toBeUndefined();
    });

    it.each(['/workspace', '/work/C#/shop', 'C:\\work\\C#\\shop'])(
        'shows completed provisioning artifacts with exact file and property targets under %s',
        (workspacePath) => {
            const phases = completion({ provisioning: true });
            const files = [
                'main.bicep',
                'main#draft.bicep',
                'model.json#draft',
                'main.bicepparam',
                'seed-data.csh',
                'sample-data.json',
                'summary.md',
            ];
            phases.provisioning.artifacts = files.map((file) => ({
                path: `.cosmosdb-migration/phases/4-provisioning/${file}`,
                description: file,
                conditional: false,
                state: 'present',
                canOpen: true,
            }));
            phases.provisioning.artifacts.push({
                path: '.cosmosdb-migration/project.json#phases.provisioning.completedAt',
                description: 'Completion time',
                conditional: false,
                state: 'present',
                canOpen: true,
            });
            const onOpenFile = vi.fn();
            render(
                createElement(MigrationGeneratedArtifacts, {
                    phase: 'provisioning',
                    completion: phases,
                    workspacePath,
                    onOpenFile,
                }),
            );
            const summary = screen.getByText('Generated Artifacts');
            expect(summary.parentElement).not.toHaveAttribute('open');
            expect(summary).toHaveAccessibleName('Generated Artifacts');
            expect(summary).toHaveAccessibleDescription('Target Provisioning');
            fireEvent.click(summary);
            for (const file of files) {
                const artifactPath = `.cosmosdb-migration/phases/4-provisioning/${file}`;
                const link = screen.getByRole('button', { name: artifactPath });
                expect(link).toBeVisible();
                expect(link).toHaveTextContent(artifactPath);
                expect(link).toHaveAccessibleName(artifactPath);
                fireEvent.click(link);
                expect(onOpenFile).toHaveBeenLastCalledWith(`${workspacePath}/${artifactPath}`);
            }
            const propertyPath = '.cosmosdb-migration/project.json#phases.provisioning.completedAt';
            fireEvent.click(screen.getByRole('button', { name: propertyPath }));
            expect(onOpenFile).toHaveBeenLastCalledWith(
                `${workspacePath}/.cosmosdb-migration/project.json`,
                'phases.provisioning.completedAt',
            );
            expect(screen.queryByTestId('migration-provisioning-diagnostics')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Review and Fix' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Refresh Status' })).not.toBeInTheDocument();
        },
    );

    it('deduplicates and alphabetizes artifact paths without merging JSON properties or changing validation entries', () => {
        const phases = completion({ discovery: true });
        const root = '.cosmosdb-migration';
        const manifest = `${root}/phases/1-discovery/discovery-manifest.json`;
        const report = `${root}/phases/1-discovery/discovery-report.md`;
        const project = `${root}/project.json`;
        const completedAt = `${project}#phases.provisioning.completedAt`;
        const databaseName = `${project}#phases.provisioning.databaseName`;
        const paths = [completedAt, report, manifest, project, manifest, databaseName];
        phases.discovery.artifacts = paths.map((path, index) => ({
            path,
            description: `Validation ${index}`,
            conditional: false,
            state: 'present',
            canOpen: true,
        }));
        const onOpenFile = vi.fn();
        render(
            createElement(MigrationGeneratedArtifacts, {
                phase: 'discovery',
                completion: phases,
                workspacePath: '/workspace',
                onOpenFile,
            }),
        );
        const summary = screen.getByText('Generated Artifacts');
        expect(summary.parentElement).not.toHaveAttribute('open');
        fireEvent.click(summary);
        const links = screen.getAllByRole('button');
        const expectedPaths = [manifest, report, project, completedAt, databaseName];
        const expectedLocations = [
            [`/workspace/${manifest}`],
            [`/workspace/${report}`],
            [`/workspace/${project}`],
            [`/workspace/${project}`, 'phases.provisioning.completedAt'],
            [`/workspace/${project}`, 'phases.provisioning.databaseName'],
        ];
        expect(links.map((link) => link.textContent)).toEqual(expectedPaths);
        links.forEach((link, index) => {
            expect(link).toHaveAccessibleName(expectedPaths[index]);
            fireEvent.click(link);
            expect(onOpenFile).toHaveBeenLastCalledWith(...expectedLocations[index]);
        });
        expect(phases.discovery.artifacts.map((artifact) => artifact.path)).toEqual(paths);
    });

    it('does not show unavailable or unsafe artifacts for a completed phase', () => {
        const phases = completion({ provisioning: true });
        phases.provisioning.artifacts = (
            [
                { path: 'missing.json', state: 'missing' },
                { path: 'unavailable.json', state: 'present' },
                { path: '../outside.json', state: 'present', canOpen: true },
                { path: '/absolute.json', state: 'present', canOpen: true },
                { path: 'file:///outside.json', state: 'present', canOpen: true },
                { path: 'C:\\outside.json', state: 'present', canOpen: true },
                { path: '.cosmosdb-migration\\..\\outside.json', state: 'present', canOpen: true },
            ] as const
        ).map((artifact) => ({ description: artifact.path, conditional: false, ...artifact }));
        render(
            createElement(MigrationGeneratedArtifacts, {
                phase: 'provisioning',
                completion: phases,
                workspacePath: '/workspace',
                onOpenFile: vi.fn(),
            }),
        );
        expect(screen.queryByText('Generated Artifacts')).not.toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders blocker details, exact diagnostic paths and inspection actions without linking missing artifacts', () => {
        const phases = completion();
        phases['schema-conversion'].artifacts = [
            {
                path: '.cosmosdb-migration/model.json#containers',
                description: 'Converted model',
                conditional: false,
                state: 'invalid',
                canOpen: true,
                diagnostics: [
                    { code: 'missing-key', path: '$.containers[0].partitionKey', message: 'Required key missing' },
                ],
            },
            {
                path: '.cosmosdb-migration/missing.json',
                description: 'Missing model',
                conditional: false,
                state: 'missing',
            },
            {
                path: '.cosmosdb-migration/project.json',
                description: 'Checkpoint',
                conditional: false,
                state: 'present',
                canOpen: true,
            },
        ];
        const onReload = vi.fn();
        const onOpenFile = vi.fn();
        const onRestart = vi.fn();
        const props = {
            phase: 'schema-conversion' as const,
            completion: phases,
            activity,
            workspacePath: '/workspace',
            onOpenFile,
            onReload,
            onReview: onRestart,
        };
        const view = render(createElement(MigrationPhaseDiagnostics, props));
        expect(screen.getByText('Blocked')).toBeInTheDocument();
        expect(screen.getByText('Model needs review.')).toBeInTheDocument();
        const failure = screen.getByRole('button', { name: 'Converted model Invalid' });
        expect(failure).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByRole('button', { name: 'Missing model Missing' })).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(failure);
        expect(failure).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText(/missing-key: \$\.containers\[0\]\.partitionKey: Required key missing/)).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Open Artifact' }));
        expect(onOpenFile).toHaveBeenCalledWith('/workspace/.cosmosdb-migration/model.json#containers');
        expect(screen.queryByRole('button', { name: /missing.json/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Open (in )?Chat/ })).not.toBeInTheDocument();
        const refresh = screen.getByRole('button', { name: 'Refresh Status' });
        refresh.focus();
        fireEvent.click(refresh);
        view.rerender(createElement(MigrationPhaseDiagnostics, { ...props, completion: { ...phases } }));
        expect(refresh).toHaveFocus();
        expect(failure).toHaveAttribute('aria-expanded', 'true');
        expect(onReload).toHaveBeenCalledOnce();
        expect(screen.queryByText('Generated Artifacts')).not.toBeInTheDocument();
        const review = screen.getByRole('button', { name: 'Review and Fix' });
        expect(review).toHaveAccessibleName('Review and Fix');
        expect(review).toHaveAccessibleDescription(
            'Schema Conversion: review blockers and propose fixes. Changes require your approval.',
        );
        expect(review.parentElement?.firstElementChild).toBe(review);
        fireEvent.click(review);
        expect(onRestart).toHaveBeenCalledWith('schema-conversion');
    });

    it('opens diagnostic checkpoint properties separately from a workspace path containing a hash', () => {
        const phases = completion();
        phases['schema-conversion'].artifacts = [
            {
                path: '.cosmosdb-migration/project.json#phases.schemaConversion.domains',
                description: 'Checkpoint metadata',
                conditional: false,
                state: 'invalid',
                canOpen: true,
                diagnostics: ['Needs review'],
            },
        ];
        const onOpenFile = vi.fn();
        render(
            createElement(MigrationPhaseDiagnostics, {
                phase: 'schema-conversion',
                completion: phases,
                activity,
                workspacePath: '/work/C#/shop',
                onOpenFile,
                onReload: vi.fn(),
            }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Checkpoint metadata Invalid' }));
        const openArtifact = screen.getByRole('button', { name: 'Open Artifact' });
        expect(openArtifact).toHaveTextContent('Open Artifact');
        expect(openArtifact).toHaveAccessibleName('Open Artifact');
        fireEvent.click(openArtifact);
        expect(onOpenFile).toHaveBeenCalledWith(
            '/work/C#/shop/.cosmosdb-migration/project.json',
            'phases.schemaConversion.domains',
        );
    });

    it('directs a blocked phase without run detail to persisted diagnostics rather than Chat', () => {
        render(
            createElement(MigrationPhaseDiagnostics, {
                phase: 'schema-conversion',
                completion: completion(),
                activity: { ...activity, detail: '' },
                workspacePath: '/workspace',
                onOpenFile: vi.fn(),
                onReload: vi.fn(),
            }),
        );
        expect(screen.getByText('The phase could not be accepted. Review the diagnostics below.')).toBeVisible();
        expect(screen.queryByRole('button', { name: /Open (in )?Chat/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refresh Status' })).toBeEnabled();
    });

    it('disables review during dispatch and reports an opening failure without losing inspection actions', async () => {
        let rejectReview: ((error: Error) => void) | undefined;
        const onReview = vi.fn(
            () =>
                new Promise<void>((_resolve, reject) => {
                    rejectReview = reject;
                }),
        );
        render(
            createElement(MigrationPhaseDiagnostics, {
                phase: 'schema-conversion',
                completion: completion(),
                activity,
                workspacePath: '/workspace',
                onOpenFile: vi.fn(),
                onReload: vi.fn(),
                onReview,
            }),
        );
        const review = screen.getByRole('button', { name: 'Review and Fix' });
        fireEvent.click(review);
        expect(review).toBeDisabled();
        expect(onReview).toHaveBeenCalledWith('schema-conversion');
        expect(screen.getByRole('button', { name: 'Refresh Status' })).toBeEnabled();
        await act(async () => rejectReview!(new Error('Chat unavailable')));
        expect(screen.getByRole('alert')).toHaveTextContent('Could not open the review: Chat unavailable');
        expect(review).toBeEnabled();
    });

    it('groups all errors in one expandable list and preserves focus and expansion on refresh', () => {
        const phases = completion();
        phases['schema-conversion'].errors = Array.from({ length: 80 }, (_, index) => `Diagnostic ${index}`);
        phases['schema-conversion'].errors.push('Diagnostic 0');
        const props = {
            phase: 'schema-conversion' as const,
            completion: phases,
            activity,
            workspacePath: '/workspace',
            onOpenFile: vi.fn(),
            onReload: vi.fn(),
        };
        const view = render(createElement(MigrationPhaseDiagnostics, props));
        const toggle = screen.getByRole('button', { name: 'Errors (80)' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getAllByTestId('migration-diagnostic-failure')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Next diagnostics' })).not.toBeInTheDocument();
        fireEvent.click(toggle);
        const list = screen.getByRole('textbox', { name: 'Errors (80)' }) as HTMLTextAreaElement;
        expect(list.readOnly).toBe(true);
        expect(list.value.split('\n')).toHaveLength(80);
        expect(list.value.split('\n')).toContain('Diagnostic 79');
        list.focus();
        list.scrollTop = 120;
        phases['schema-conversion'].errors.push('Diagnostic 80');
        view.rerender(createElement(MigrationPhaseDiagnostics, { ...props, completion: { ...phases } }));
        expect(toggle).toHaveAccessibleName('Errors (81)');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(list).toHaveFocus();
        expect(list.scrollTop).toBe(120);
        expect(list.value.split('\n')).toHaveLength(81);
        phases['schema-conversion'].errors = [];
        view.rerender(createElement(MigrationPhaseDiagnostics, { ...props, completion: { ...phases } }));
        expect(screen.queryByRole('button', { name: /^Errors \(/ })).not.toBeInTheDocument();
        view.rerender(
            createElement(MigrationPhaseDiagnostics, {
                ...props,
                activity: { ...activity, activity: 'waiting-for-decision' },
            }),
        );
        expect(screen.queryByText('Blocked')).not.toBeInTheDocument();
    });

    it('groups freshness issues into one counted expander and retains genuine regeneration guidance', () => {
        const phases = completion();
        phases['schema-conversion'].status = 'complete';
        phases['schema-conversion'].freshness = 'stale';
        phases['schema-conversion'].staleInputs = [
            { id: 'schema.sql', reason: 'Source schema changed' },
            { id: 'access-patterns.md', reason: 'Access patterns changed' },
            { id: 'schema.sql', reason: 'Source schema changed' },
        ];
        render(
            createElement(MigrationPhaseDiagnostics, {
                phase: 'schema-conversion',
                completion: phases,
                activity: null,
                workspacePath: '/workspace',
                onOpenFile: vi.fn(),
                onReload: vi.fn(),
                onReview: vi.fn(),
            }),
        );
        expect(screen.getByText('Stale evidence')).toBeInTheDocument();
        const toggle = screen.getByRole('button', { name: 'Evidence freshness (2)' });
        expect(screen.getAllByTestId('migration-diagnostic-failure')).toHaveLength(1);
        fireEvent.click(toggle);
        expect(screen.getByRole('textbox', { name: 'Evidence freshness (2)' })).toHaveValue(
            'schema.sql: Source schema changed\naccess-patterns.md: Access patterns changed',
        );
        expect(screen.getByRole('button', { name: 'Review and Fix' })).toHaveAccessibleDescription(
            'Schema Conversion: review blockers and propose fixes. Changes require your approval.',
        );
    });

    it.each([
        ['project', 'Project validation failed'],
        ['completion-check', 'Validation unavailable'],
    ])('renders %s failures once without freshness or regeneration advice', (id, label) => {
        const phases = completion();
        phases.assessment.status = 'complete';
        phases.assessment.freshness = 'unknown';
        phases.assessment.errors = ['Invalid assessment field'];
        phases.assessment.staleInputs = [{ id, reason: 'Validation could not run' }];
        render(
            createElement(MigrationPhaseDiagnostics, {
                phase: 'assessment',
                completion: phases,
                activity: null,
                workspacePath: '/workspace',
                onOpenFile: vi.fn(),
                onReload: vi.fn(),
                onReview: vi.fn(),
            }),
        );
        expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.queryByText('Evidence not verified')).not.toBeInTheDocument();
        expect(screen.queryByText(/Required prerequisite:/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Evidence freshness/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Restart Generation' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Review and Fix' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Refresh Status' })).toBeEnabled();
        expect(screen.getAllByTestId('migration-diagnostic-failure')).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Errors (1)' }));
        expect(screen.getByRole('textbox', { name: 'Errors (1)' })).toHaveValue('Invalid assessment field');
    });

    it('keeps project failure details when no general errors were supplied', () => {
        const phases = completion();
        phases.assessment.staleInputs = [{ id: 'project', reason: 'project.json is missing or invalid' }];
        render(
            createElement(MigrationPhaseDiagnostics, {
                phase: 'assessment',
                completion: phases,
                activity: null,
                workspacePath: '/workspace',
                onOpenFile: vi.fn(),
                onReload: vi.fn(),
                onReview: vi.fn(),
            }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Errors (1)' }));
        expect(screen.getByRole('textbox', { name: 'Errors (1)' })).toHaveValue('project.json is missing or invalid');
        expect(screen.queryByRole('button', { name: /^Evidence freshness/ })).not.toBeInTheDocument();
    });

    it('shows the specific upstream cause and inspection actions without converting completed activity into a blocker', () => {
        const phases = completion({ preflight: true, discovery: true, assessment: true });
        const path = '.cosmosdb-migration/phases/1-discovery/volumetrics/volumetrics.md';
        const reason = 'recorded input no longer matches current content';
        for (const phase of ['preflight', 'discovery', 'assessment'] as const) {
            phases[phase].complete = false;
            phases[phase].freshness = 'stale';
        }
        phases.assessment.recordedCompletedAt = '2026-10-15T14:52:04.000Z';
        phases.assessment.staleInputs = [
            { id: 'consulted:005', path, reason: 'consulted input no longer matches current content' },
            { id: 'predecessor:discovery', reason: 'required predecessor discovery is not current and complete' },
        ];
        phases.assessment.freshnessCauses = [{ phase: 'preflight', id: 'volumetrics', path, reason, canOpen: true }];
        const tracker = new MigrationRunTracker();
        tracker.observe(
            { ...activity, phase: 'assessment', activity: 'complete', detail: 'Assessment complete.' },
            phases,
        );
        const onOpenFile = vi.fn();
        const onGoToPhase = vi.fn();
        const onRestart = vi.fn();
        render(
            createElement(MigrationPhaseDiagnostics, {
                phase: 'assessment',
                completion: phases,
                activity: tracker.snapshot(),
                workspacePath: '/workspace',
                onOpenFile,
                onGoToPhase,
                onReload: vi.fn(),
                onReview: onRestart,
            }),
        );
        expect(screen.getByText('Stale evidence')).toBeInTheDocument();
        expect(screen.queryByText('Blocked')).not.toBeInTheDocument();
        expect(screen.getByText('Last run: Assessment complete.')).toBeInTheDocument();
        expect(screen.getByTestId('migration-recorded-completion')).toHaveTextContent('Evidence is now stale.');
        expect(screen.queryByText(/Required prerequisite: Preflight/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Evidence freshness (1)' }));
        expect(screen.getAllByTestId('migration-freshness-cause')).toHaveLength(1);
        const row = screen.getByTestId('migration-freshness-cause');
        expect(row).toHaveTextContent(`Preflight / volumetrics.md: ${reason}`);
        expect(screen.getByTestId('migration-diagnostic-failures')).toContainElement(row);
        expect(screen.queryByRole('textbox', { name: 'Evidence freshness (1)' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Open Volumetrics' })).not.toBeInTheDocument();
        const open = screen.getByRole('button', { name: 'volumetrics.md' });
        expect(open).toHaveAccessibleName('volumetrics.md');
        expect(open).toHaveAccessibleDescription(path);
        fireEvent.click(open);
        expect(onOpenFile).toHaveBeenCalledWith(`/workspace/${path}`);
        fireEvent.click(screen.getByRole('button', { name: 'Go to Preflight' }));
        expect(onGoToPhase).toHaveBeenCalledWith('preflight');
        expect(onRestart).not.toHaveBeenCalled();
    });

    it('renders current-phase file causes once as inline editor links, leaving unsafe files as plain text', () => {
        const phases = completion({ preflight: true, discovery: true });
        phases.assessment.status = 'complete';
        phases.assessment.freshness = 'stale';
        const files = ['discovery-manifest.json', 'discovery-report.md', 'access-patterns.md', 'volumetrics.md'];
        phases.assessment.freshnessCauses = files.map((file) => ({
            phase: 'assessment',
            id: file,
            path: `evidence/${file}`,
            reason: 'Input changed',
            canOpen: true,
        }));
        phases.assessment.freshnessCauses.push(
            { phase: 'assessment', id: 'missing', path: 'evidence/missing.md', reason: 'Missing file', canOpen: false },
            { phase: 'assessment', id: 'unsafe', path: '../outside.md', reason: 'Outside workspace', canOpen: true },
        );
        const onOpenFile = vi.fn();
        render(
            createElement(MigrationPhaseDiagnostics, {
                phase: 'assessment',
                completion: phases,
                activity: null,
                workspacePath: '/workspace',
                onOpenFile,
                onReload: vi.fn(),
                onGoToPhase: vi.fn(),
            }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Evidence freshness (6)' }));
        const list = screen.getByRole('list', { name: 'Evidence freshness (6)' });
        expect(screen.getAllByTestId('migration-freshness-cause')).toHaveLength(6);
        for (const row of screen.getAllByTestId('migration-freshness-cause')) expect(list).toContainElement(row);
        for (const [index, file] of files.entries()) {
            const link = screen.getByRole('button', { name: file });
            expect(link).toHaveAccessibleName(file);
            expect(link).toHaveAccessibleDescription(`evidence/${file}`);
            expect(link.closest('li')).toHaveTextContent(`Domain Assessment / ${file}: Input changed`);
            fireEvent.click(link);
            expect(onOpenFile).toHaveBeenNthCalledWith(index + 1, `/workspace/evidence/${file}`);
        }
        expect(screen.queryByRole('textbox', { name: 'Evidence freshness (6)' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Open .*\.(md|json)$/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'missing.md' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'outside.md' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Go to/ })).not.toBeInTheDocument();
    });

    it('keeps recorded completion separate from Skill readiness and requires explicit preparation', () => {
        const phases = completion();
        phases.assessment.status = 'complete';
        phases.assessment.recordedCompletedAt = '2026-05-18T10:37:56.400Z';
        phases.assessment.freshness = 'unknown';
        phases.assessment.staleInputs = [{ id: 'freshness-manifest', reason: 'No recorded evidence' }];
        phases.assessment.compatibilityChanges = ['/phases/assessment/parsedAccessPatterns/0/singleOrBatch'];
        const onRestart = vi.fn();
        render(
            createElement(MigrationPhaseDiagnostics, {
                phase: 'assessment',
                completion: phases,
                activity: null,
                workspacePath: '/workspace',
                onOpenFile: vi.fn(),
                onReload: vi.fn(),
                onReview: onRestart,
            }),
        );
        expect(screen.getByTestId('migration-recorded-completion')).toHaveTextContent('Recorded as complete on');
        expect(screen.getByTestId('migration-recorded-completion')).toHaveTextContent(
            'Not verified for the current Skill workflow.',
        );
        expect(screen.getByTestId('migration-compatibility-notice')).toHaveTextContent('1 empty optional fields');
        expect(phases.assessment.complete).toBe(false);
        expect(onRestart).not.toHaveBeenCalled();
        const review = screen.getByRole('button', { name: 'Review and Fix' });
        expect(review).toHaveAccessibleDescription(
            'Domain Assessment: review blockers and propose fixes. Changes require your approval.',
        );
        fireEvent.click(review);
        expect(onRestart).toHaveBeenCalledWith('assessment');
    });

    it('discloses read compatibility even when current evidence passes without adding a restart action', () => {
        const phases = completion({ assessment: true });
        phases.assessment.compatibilityChanges = ['/phases/assessment/parsedAccessPatterns/0/singleOrBatch'];
        render(
            createElement(MigrationPhaseDiagnostics, {
                phase: 'assessment',
                completion: phases,
                activity: null,
                workspacePath: '/workspace',
                onOpenFile: vi.fn(),
                onReload: vi.fn(),
                onReview: vi.fn(),
            }),
        );
        expect(screen.getByTestId('migration-compatibility-notice')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Prepare for Skill workflow' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Restart Generation' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Review and Fix' })).not.toBeInTheDocument();
    });

    it('still pages artifact failures independently of the grouped error lines', () => {
        const phases = completion();
        phases['schema-conversion'].artifacts = Array.from({ length: 25 }, (_, index) => ({
            path: `artifact-${index}.json`,
            description: `Artifact ${index}`,
            conditional: false,
            state: 'missing',
        }));
        render(
            createElement(MigrationPhaseDiagnostics, {
                phase: 'schema-conversion',
                completion: phases,
                activity,
                workspacePath: '/workspace',
                onOpenFile: vi.fn(),
                onReload: vi.fn(),
            }),
        );
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Next diagnostics' }));
        expect(screen.getByRole('button', { name: 'Artifact 24 Missing' })).toBeInTheDocument();
    });
});

describe('deriveMigrationPhaseStates', () => {
    it('uses accepted-model readiness independently of live phases and past migration completion', () => {
        const phases = completion();
        phases['code-migration'].ready = true;
        expect(isCodeMigrationReady(phases)).toBe(true);
        expect(deriveMigrationPhaseStates(phases).schemaConversionState).toBe('locked');
        phases['code-migration'].complete = true;
        phases['code-migration'].ready = false;
        expect(isCodeMigrationReady(phases)).toBe(false);
        expect(isCodeMigrationReady(undefined)).toBe(false);
        expect(isCodeMigrationReady(completion({ 'schema-conversion': true }))).toBe(false);
    });

    it('makes Skill Discovery available before preflight validates', () => {
        expect(deriveMigrationPhaseStates(completion()).discoveryState).toBe('available');
        expect(deriveMigrationPhaseStates(completion({ preflight: true })).discoveryState).toBe('available');
    });

    it('treats missing completion entries as incomplete', () => {
        expect(deriveMigrationPhaseStates(undefined)).toEqual({
            discoveryState: 'available',
            assessmentState: 'locked',
            schemaConversionState: 'locked',
            provisioningState: 'locked',
        });
        expect(deriveMigrationPhaseStates({ discovery: completion().discovery })).toMatchObject({
            discoveryState: 'available',
            assessmentState: 'locked',
            schemaConversionState: 'locked',
            provisioningState: 'locked',
        });
    });

    it('unlocks each phase only after its validated prerequisite', () => {
        expect(deriveMigrationPhaseStates(completion({ discovery: true }))).toMatchObject({
            discoveryState: 'complete',
            assessmentState: 'available',
            schemaConversionState: 'locked',
        });
        expect(deriveMigrationPhaseStates(completion({ discovery: true, assessment: true }))).toMatchObject({
            assessmentState: 'complete',
            schemaConversionState: 'available',
        });
    });

    it('keeps previously completed phases actionable when their current evidence is stale', () => {
        const phases = completion();
        phases.discovery.status = 'complete';
        phases.assessment.status = 'complete';
        phases['schema-conversion'].status = 'complete';
        phases.provisioning.status = 'complete';
        phases['code-migration'].ready = false;

        expect(deriveMigrationPhaseStates(phases)).toEqual({
            discoveryState: 'available',
            assessmentState: 'available',
            schemaConversionState: 'available',
            provisioningState: 'available',
        });
    });

    it('restores prior completed phases when the terminal code migration still validates', () => {
        const phases = completion({ 'code-migration': true });
        phases.discovery.status = 'complete';
        phases.assessment.status = 'complete';
        phases['schema-conversion'].status = 'complete';
        phases.provisioning.status = 'complete';

        expect(deriveMigrationPhaseStates(phases)).toEqual({
            discoveryState: 'complete',
            assessmentState: 'complete',
            schemaConversionState: 'complete',
            provisioningState: 'complete',
        });
    });

    it('restores completed phases when a blocked code migration still has a validated accepted model', () => {
        const phases = completion();
        phases.discovery.status = 'complete';
        phases.assessment.status = 'complete';
        phases['schema-conversion'].status = 'complete';
        phases.provisioning.status = 'complete';
        phases['code-migration'].status = 'in-progress';
        phases['code-migration'].ready = true;

        expect(deriveMigrationPhaseStates(phases)).toEqual({
            discoveryState: 'complete',
            assessmentState: 'complete',
            schemaConversionState: 'complete',
            provisioningState: 'complete',
        });
        expect(phases['code-migration'].complete).toBe(false);
        expect(phases.discovery.complete).toBe(false);
    });

    it.each(['not-started', 'in-progress'] as const)(
        'does not mark %s phases complete solely from accepted-model readiness',
        (status) => {
            const phases = completion();
            phases.discovery.status = status;
            phases.assessment.status = status;
            phases['schema-conversion'].status = status;
            phases.provisioning.status = status;
            phases['code-migration'].ready = true;

            expect(deriveMigrationPhaseStates(phases)).toEqual({
                discoveryState: 'available',
                assessmentState: 'locked',
                schemaConversionState: 'locked',
                provisioningState: 'locked',
            });
        },
    );

    it('marks only checker-confirmed phases complete', () => {
        expect(
            deriveMigrationPhaseStates(
                completion({
                    preflight: true,
                    discovery: true,
                    assessment: true,
                    'schema-conversion': true,
                    provisioning: true,
                }),
            ),
        ).toEqual({
            discoveryState: 'complete',
            assessmentState: 'complete',
            schemaConversionState: 'complete',
            provisioningState: 'complete',
        });
    });
});
