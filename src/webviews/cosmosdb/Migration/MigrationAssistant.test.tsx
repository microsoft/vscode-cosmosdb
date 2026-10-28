/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MigrationAssistant } from './MigrationAssistant';
import {
    type MigrationCompletionMap,
    type MigrationPhaseName,
    type MigrationRunActivity,
} from './state/deriveMigrationPhaseStates';
import { type MigrationState } from './state/MigrationContext';

const { state, announce, postMessage, dispatch, client } = vi.hoisted(() => ({
    state: {} as MigrationState,
    announce: vi.fn(),
    postMessage: vi.fn(),
    dispatch: vi.fn(),
    client: {},
}));

vi.mock(import('@fluentui/react-components'), async (importOriginal) => ({
    ...(await importOriginal()),
    useAnnounce: () => ({ announce }),
}));

vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));
vi.mock('./state/MigrationChannel', () => ({
    MigrationChannel: class {
        postMessage = postMessage;
        dispose = vi.fn();
    },
}));
vi.mock('./state/MigrationContext', () => ({
    useMigrationState: () => state,
    useMigrationDispatch: () => dispatch,
    WithMigrationContext: ({ children }: { children: React.ReactNode }) => children,
}));

function renderAssistant() {
    return (
        <FluentProvider theme={webLightTheme}>
            <MigrationAssistant />
        </FluentProvider>
    );
}

function activity(phase: MigrationPhaseName | 'all', status: MigrationRunActivity['activity']): MigrationRunActivity {
    return {
        version: 1,
        runId: 'run-1',
        phase,
        step: null,
        activity: status,
        startedAt: '2026-10-16T12:00:00Z',
        updatedAt: '2026-10-16T12:00:01Z',
        detail: '',
    };
}

function addGeneratedArtifacts() {
    const completion = (phase: MigrationPhaseName): MigrationCompletionMap[MigrationPhaseName] => ({
        phase,
        status: 'complete',
        complete: true,
        ready: true,
        freshness: 'current',
        staleInputs: [],
        artifacts: [
            {
                path: `.cosmosdb-migration/${phase}.json`,
                description: phase,
                state: 'present',
                conditional: false,
                canOpen: true,
            },
        ],
        errors: [],
    });
    state.phaseCompletion = {
        preflight: completion('preflight'),
        discovery: completion('discovery'),
        assessment: completion('assessment'),
        'schema-conversion': completion('schema-conversion'),
        provisioning: completion('provisioning'),
        'code-migration': completion('code-migration'),
    };
    state.discoveryState = 'complete';
    state.assessmentState = 'complete';
    state.schemaConversionState = 'complete';
    state.provisioningState = 'complete';
    state.connectionVerified = true;
}

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state, {
        workspacePath: '/workspace',
        projectName: 'Migration',
        isLoaded: true,
        phaseCompletion: null,
        runActivity: null,
        availableModels: [],
        selectedModelId: null,
        savedModelId: null,
        consentGiven: true,
        schemaFiles: ['/workspace/schema.sql'],
        volumetricFiles: ['/workspace/volumetrics.csv'],
        accessPatternFiles: ['/workspace/access-patterns.md'],
        excludedSchemaFiles: [],
        excludedVolumetricFiles: [],
        excludedAccessPatternFiles: [],
        hasVolumetricsTemplate: false,
        hasAccessPatternsTemplate: false,
        analysisState: 'complete',
        analysisResult: {
            projectName: 'Application',
            projectType: 'Web API',
            language: 'C#',
            databaseType: 'SQL Server',
            databaseAccess: 'Entity Framework',
        },
        discoveryState: 'complete',
        assessmentState: 'available',
        assessmentInstructions: '',
        assessmentResult: null,
        schemaConversionState: 'locked',
        schemaConversionResult: null,
        schemaConversionInstructions: '',
        includeUnmappedDomains: false,
        targetType: 'azure',
        targetEndpoint: 'https://example.documents.azure.com',
        targetAccountName: null,
        targetSubscriptionId: '',
        targetSubscriptionName: '',
        targetResourceGroup: '',
        targetLocation: 'eastus',
        availableLocations: [],
        accountProvisioningState: 'available',
        connectionTestState: 'available',
        connectionTestError: null,
        connectionTestDocumentationUrl: null,
        connectionVerified: false,
        provisioningState: 'available',
        hasSampleData: false,
        bicepGenerated: false,
        hasGitRepo: true,
        isInGitignore: false,
        isAIFeaturesEnabled: true,
        discoveryInstructions: '',
        migrationInstructions: '',
        hasCodeMigrationPlan: false,
        codeMigrationPlanPath: '',
        codeMigrationAction: 'plan',
    } satisfies MigrationState);
});

describe('migration accessibility', () => {
    function addAvailableModels() {
        state.availableModels = ['GPT-5 nano', 'Auto', 'Custom model', 'GPT-5 mini', 'Claude Opus 4.5'].map((name) => ({
            id: name,
            name,
            family: name,
            vendor: 'copilot',
            maxInputTokens: name === 'Auto' ? 0 : 200_000,
        }));
        state.selectedModelId = 'GPT-5 nano';
    }

    it('groups models by migration suitability with accessible reasons and preserves the saved selection', () => {
        addAvailableModels();
        render(renderAssistant());
        const dropdown = screen.getByRole('combobox', { name: /^AI Model/ });
        expect(dropdown).toHaveTextContent('GPT-5 nano');
        fireEvent.click(dropdown);

        const groups = screen.getAllByRole('group').filter((group) => within(group).queryAllByRole('option').length);
        expect(groups).toHaveLength(4);
        for (const [index, name] of [
            'Preferred for migration',
            'Automatic selection',
            'Other capable models',
            'Not recommended for migration',
        ].entries()) {
            expect(groups[index]).toHaveAccessibleName(name);
        }

        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(5);
        for (const [index, name] of ['Claude Opus 4.5', 'Auto', 'GPT-5 mini', 'GPT-5 nano', 'Custom model'].entries()) {
            expect(options[index]).toHaveTextContent(name);
        }
        expect(options[0]).toHaveTextContent('Claude Opus 4.5');
        expect(options[0]).toHaveAccessibleName(/Claude Opus 4.5.*copilot.*200k input tokens.*complex reasoning/);
        expect(options[4]).toHaveAccessibleName(/Custom model.*Migration suitability has not been assessed/);
        expect(within(groups[3]).getByRole('option', { name: /Custom model/ })).toBe(options[4]);
        expect(options[1]).not.toHaveTextContent('input tokens');
        expect(options[3]).toHaveAttribute('aria-selected', 'true');
        expect(options[3]).not.toHaveAttribute('aria-disabled', 'true');
        expect(options[4]).not.toHaveAttribute('aria-disabled', 'true');

        fireEvent.click(options[0]);
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_MODEL', payload: 'Claude Opus 4.5' });
        expect(postMessage).toHaveBeenCalledWith({
            type: 'event',
            name: 'command',
            params: [{ commandName: 'setSelectedModel', params: ['Claude Opus 4.5'] }],
        });
    });

    it('allows keyboard selection of an unassessed model in the not-recommended group', async () => {
        addAvailableModels();
        state.selectedModelId = 'Claude Opus 4.5';
        const user = userEvent.setup();
        render(renderAssistant());
        await user.click(screen.getByRole('combobox', { name: /^AI Model/ }));
        await user.keyboard('{End}{Enter}');
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_MODEL', payload: 'Custom model' });
    });

    it('shows provider-based recommendations and explicit lack of tool support', () => {
        state.availableModels = [
            { id: 'powerful', name: 'New model', category: 'powerful', supportsToolCalling: true },
            { id: 'versatile', name: 'GPT-5', category: 'versatile', supportsToolCalling: true },
            { id: 'lightweight', name: 'Small model', category: 'lightweight', supportsToolCalling: true },
            { id: 'no-tools', name: 'Claude Opus 4.5', category: 'powerful', supportsToolCalling: false },
        ].map((model) => ({ ...model, family: model.name, vendor: 'copilot', maxInputTokens: 200_000 }));
        state.selectedModelId = 'powerful';
        render(renderAssistant());
        fireEvent.click(screen.getByRole('combobox', { name: /^AI Model/ }));

        const preferred = within(screen.getByRole('group', { name: 'Preferred for migration' }));
        expect(preferred.getByRole('option')).toHaveAccessibleName(/New model.*Provider category: powerful/);
        const capable = within(screen.getByRole('group', { name: 'Other capable models' }));
        expect(capable.getByRole('option', { name: /GPT-5/ })).toHaveAccessibleName(/Provider category: versatile/);
        expect(capable.queryByRole('option', { name: /Small model/ })).not.toBeInTheDocument();
        const unsuitable = within(screen.getByRole('group', { name: 'Not recommended for migration' }));
        expect(unsuitable.getByRole('option', { name: /Small model/ })).toHaveAccessibleName(
            /Provider category: lightweight; not recommended for complex migration/,
        );
        expect(unsuitable.getByRole('option', { name: /Small model/ })).not.toHaveAttribute('aria-disabled', 'true');
        expect(unsuitable.getByRole('option', { name: /Claude Opus 4.5/ })).toHaveAccessibleName(
            /Claude Opus 4.5.*Tool calling is not supported/,
        );
    });

    it('keeps model selection disabled during an active migration', () => {
        addAvailableModels();
        state.runActivity = activity('assessment', 'running');
        render(renderAssistant());
        expect(screen.getByRole('combobox', { name: /^AI Model/ })).toBeDisabled();
    });

    it.each([
        { consentGiven: false, isAIFeaturesEnabled: true },
        { consentGiven: true, isAIFeaturesEnabled: false },
    ])(
        'disables account provisioning when consent is $consentGiven and AI availability is $isAIFeaturesEnabled',
        (settings) => {
            state.targetType = 'provision';
            state.targetAccountName = 'migration-account';
            state.targetResourceGroup = 'migration-resources';
            const { rerender } = render(renderAssistant());
            fireEvent.click(screen.getByRole('button', { name: /Phase 4: Target Provisioning/ }));
            const button = screen.getByRole('button', { name: 'Provision New Account' });
            expect(button).toHaveTextContent('Provision New Account');
            expect(button).toBeEnabled();

            Object.assign(state, settings);
            rerender(renderAssistant());
            expect(button).toBeDisabled();
            postMessage.mockClear();
            fireEvent.click(button);
            expect(postMessage).not.toHaveBeenCalled();

            state.consentGiven = true;
            state.isAIFeaturesEnabled = true;
            rerender(renderAssistant());
            expect(button).toBeEnabled();
            fireEvent.click(button);
            expect(postMessage).toHaveBeenCalledWith({
                type: 'event',
                name: 'command',
                params: [{ commandName: 'provisionAccount', params: [] }],
            });
        },
    );

    it('places one collapsed Generated Artifacts expander directly below each generation action', () => {
        addGeneratedArtifacts();
        render(renderAssistant());
        for (const phase of [
            'Phase 2: Domain Assessment',
            'Phase 3: Schema Conversion',
            'Phase 4: Target Provisioning',
        ]) {
            fireEvent.click(screen.getByRole('button', { name: new RegExp(phase) }));
        }
        const actions = [
            ['discovery', 'migration-run-discovery'],
            ['assessment', 'migration-run-assessment'],
            ['schema-conversion', 'migration-run-conversion'],
            ['provisioning', 'migration-populate-sample-data'],
        ] as const;
        for (const [phase, actionId] of actions) {
            const section = screen.getByTestId(`migration-phase-${phase}`);
            const expander = within(section).getByTestId(`migration-${phase}-artifacts`);
            expect(expander).not.toHaveAttribute('open');
            expect(within(section).getAllByText('Generated Artifacts')).toHaveLength(1);
            expect(expander.previousElementSibling?.contains(screen.getByTestId(actionId))).toBe(true);
        }
        const details = screen.getByTestId('migration-phase-preflight');
        expect(within(details).getAllByText('Generated Artifacts')).toHaveLength(1);
        expect(details.lastElementChild).toBe(screen.getByTestId('migration-preflight-artifacts'));
        expect(screen.queryByText('Available artifacts')).not.toBeInTheDocument();
    });

    it.each([
        { action: 'plan', label: 'Plan Migration', running: false },
        { action: 'migrate', label: 'Migrate Application', running: false },
        { action: 'plan', label: 'Plan Migration', running: true },
        { action: 'migrate', label: 'Migrate Application', running: true },
    ] as const)(
        'keeps $action in the floating footer without an artifact expander (running: $running)',
        ({ action, label, running }) => {
            addGeneratedArtifacts();
            state.codeMigrationAction = action;
            state.hasCodeMigrationPlan = true;
            state.codeMigrationPlanPath = '/workspace/.cosmosdb-migration/code-migration-plan.md';
            state.runActivity = running ? activity('code-migration', 'running') : null;
            render(renderAssistant());
            const footer = screen.getByTestId('migration-footer');
            const button = within(footer).getByTestId('migration-action-button');
            expect(button).toHaveAccessibleName(running ? new RegExp(label) : label);
            expect(screen.getByTestId('migration-phase-code-migration')).not.toContainElement(button);
            expect(screen.queryByTestId('migration-code-migration-artifacts')).not.toBeInTheDocument();
            const planLink = within(footer).getByRole('button', { name: 'View Plan' });
            expect(planLink).toHaveTextContent('View Plan');
            expect(planLink).toHaveAccessibleName('View Plan');
            fireEvent.click(planLink);
            expect(postMessage).toHaveBeenCalledWith({
                type: 'event',
                name: 'command',
                params: [{ commandName: 'previewMarkdown', params: [state.codeMigrationPlanPath] }],
            });
        },
    );

    it('keeps generated artifacts outside diagnostics when a phase is blocked', () => {
        addGeneratedArtifacts();
        state.runActivity = activity('discovery', 'blocked');
        render(renderAssistant());
        const expander = screen.getByTestId('migration-discovery-artifacts');
        expect(expander.nextElementSibling).toBe(screen.getByTestId('migration-discovery-diagnostics'));
        expect(expander).not.toHaveAttribute('open');
        fireEvent.click(within(expander).getByText('Generated Artifacts'));
        fireEvent.click(within(expander).getByRole('button', { name: '.cosmosdb-migration/discovery.json' }));
        expect(postMessage).toHaveBeenCalledWith({
            type: 'event',
            name: 'command',
            params: [{ commandName: 'openFile', params: ['/workspace/.cosmosdb-migration/discovery.json'] }],
        });
    });

    it('keeps provisioning artifacts visible when connection verification is no longer available', () => {
        addGeneratedArtifacts();
        state.connectionVerified = false;
        render(renderAssistant());
        fireEvent.click(screen.getByRole('button', { name: /Phase 4: Target Provisioning/ }));
        expect(screen.queryByTestId('migration-populate-sample-data')).not.toBeInTheDocument();
        expect(
            within(screen.getByTestId('migration-provisioning-artifacts')).getByText('Generated Artifacts'),
        ).toBeVisible();
    });

    it('shows prerequisites on focus, keeps them on pointer exit, and dismisses them with Escape', () => {
        vi.useFakeTimers();
        try {
            render(renderAssistant());
            const header = screen.getByRole('button', { name: /Phase 3: Schema Conversion/ });
            const reason = 'Complete Phase 2: Domain Assessment first.';
            act(() => header.focus());
            expect(header).toHaveFocus();
            expect(header).toHaveAccessibleDescription(reason);
            expect(screen.getByRole('tooltip', { name: reason })).toBeVisible();

            fireEvent.pointerLeave(header);
            act(() => vi.advanceTimersByTime(500));
            expect(screen.getByRole('tooltip', { name: reason })).toBeVisible();

            fireEvent.keyDown(header, { key: 'Escape' });
            act(() => vi.advanceTimersByTime(500));
            expect(header).toHaveFocus();
            expect(screen.queryByRole('tooltip', { name: reason })).not.toBeInTheDocument();

            act(() => header.blur());
            act(() => header.focus());
            expect(screen.getByRole('tooltip', { name: reason })).toBeVisible();
            act(() => header.blur());
            expect(screen.queryByRole('tooltip', { name: reason })).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('describes every file picker and expander without changing its visible accessible name', () => {
        render(renderAssistant());
        const descriptions = ['Database Schema Files, required', 'Volumetrics:', 'Access Patterns:'];
        for (const label of ['Select Files…', 'Select Folder…', '1 file(s) selected']) {
            const controls = screen.getAllByRole('button', { name: label });
            expect(controls).toHaveLength(3);
            controls.forEach((control, index) => {
                expect(control).toHaveTextContent(label);
                expect(control).toHaveAccessibleName(label);
                expect(control).toHaveAccessibleDescription(
                    label === '1 file(s) selected' && index === 0 ? 'Database Schema Files:' : descriptions[index],
                );
            });
        }
    });

    it.each(['azure', 'emulator'] as const)(
        'keeps connection-test focus and prevents duplicate activation for %s',
        (targetType) => {
            state.targetType = targetType;
            const view = render(renderAssistant());
            fireEvent.click(screen.getByRole('button', { name: /Phase 4: Target Provisioning/ }));
            const button = screen.getByRole('button', { name: 'Test Connection' });
            button.focus();
            fireEvent.click(button);
            expect(postMessage).toHaveBeenCalledWith({
                type: 'event',
                name: 'command',
                params: [{ commandName: 'testConnection', params: [targetType, state.targetEndpoint] }],
            });
            postMessage.mockClear();
            state.connectionTestState = 'in-progress';
            view.rerender(renderAssistant());
            expect(button).toHaveFocus();
            expect(button).toHaveTextContent('Test Connection');
            expect(button).toHaveAccessibleName('Test Connection');
            expect(button).toHaveAccessibleDescription('Testing connection…');
            expect(button).toHaveAttribute('aria-disabled', 'true');
            fireEvent.click(button);
            expect(postMessage).not.toHaveBeenCalled();
            expect(announce).toHaveBeenCalledWith('Testing connection…');

            state.connectionTestState = 'complete';
            state.connectionVerified = true;
            view.rerender(renderAssistant());
            expect(button).toHaveFocus();
            expect(button).not.toHaveAttribute('aria-disabled', 'true');
            expect(announce).toHaveBeenCalledWith('Connection verified successfully.');
            announce.mockClear();
            view.rerender(renderAssistant());
            expect(announce).not.toHaveBeenCalled();
        },
    );

    it('keeps connection-test focus after a failure without announcing success', () => {
        const view = render(renderAssistant());
        fireEvent.click(screen.getByRole('button', { name: /Phase 4: Target Provisioning/ }));
        const button = screen.getByRole('button', { name: 'Test Connection' });
        button.focus();
        state.connectionTestState = 'in-progress';
        view.rerender(renderAssistant());
        announce.mockClear();
        state.connectionTestState = 'error';
        state.connectionTestError = 'Connection refused';
        view.rerender(renderAssistant());
        expect(button).toHaveFocus();
        expect(screen.getByRole('alert')).toHaveTextContent('Connection refused');
        expect(announce).not.toHaveBeenCalled();
    });

    it.each([
        ['preflight', 'Preflight'],
        ['discovery', 'Source Discovery'],
        ['assessment', 'Domain Assessment'],
        ['schema-conversion', 'Schema Conversion'],
        ['provisioning', 'Target Provisioning'],
        ['code-migration', 'Code Migration'],
        ['all', 'Migration'],
    ] as const)('announces successful %s actions once', (phase, label) => {
        state.runActivity = activity(phase, 'running');
        const view = render(renderAssistant());
        announce.mockClear();
        state.runActivity = activity(phase, 'complete');
        view.rerender(renderAssistant());
        expect(announce).toHaveBeenCalledExactlyOnceWith(`${label}: action completed successfully.`);
        view.rerender(renderAssistant());
        expect(announce).toHaveBeenCalledTimes(1);
    });

    it('announces completion while the phase is collapsed', () => {
        state.runActivity = activity('assessment', 'running');
        const view = render(renderAssistant());
        fireEvent.click(screen.getByRole('button', { name: /Phase 2: Domain Assessment/ }));
        expect(screen.getByRole('button', { name: /Phase 2: Domain Assessment/ })).toHaveAttribute(
            'aria-expanded',
            'false',
        );
        announce.mockClear();
        state.runActivity = activity('assessment', 'complete');
        view.rerender(renderAssistant());
        expect(screen.getByRole('button', { name: /Phase 2: Domain Assessment/ })).toHaveAttribute(
            'aria-expanded',
            'false',
        );
        expect(announce).toHaveBeenCalledExactlyOnceWith('Domain Assessment: action completed successfully.');
    });

    it('does not announce hydrated historical success', () => {
        state.runActivity = activity('discovery', 'complete');
        state.connectionTestState = 'complete';
        state.connectionVerified = true;
        render(renderAssistant());
        expect(announce).not.toHaveBeenCalled();
    });

    it('does not announce success when completion validation fails', () => {
        state.runActivity = activity('discovery', 'running');
        const view = render(renderAssistant());
        announce.mockClear();
        state.runActivity = { ...activity('discovery', 'complete'), validationFailed: true };
        view.rerender(renderAssistant());
        expect(announce).not.toHaveBeenCalledWith('Source Discovery: action completed successfully.');
    });
});
