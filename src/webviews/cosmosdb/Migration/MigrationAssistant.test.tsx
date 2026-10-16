/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MigrationAssistant } from './MigrationAssistant';
import { type MigrationPhaseName, type MigrationRunActivity } from './state/deriveMigrationPhaseStates';
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
