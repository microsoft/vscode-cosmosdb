/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, tokens, webLightTheme } from '@fluentui/react-components';
import { type EditorProps } from '@monaco-editor/react';
import { act, fireEvent, render as renderReact, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DeploymentTemplateInput } from '../../../dataModeling/deploymentModel';
import {
    ModelingAdvisorSnapshotSchema,
    type ModelingAdvisorSnapshot,
} from '../../../dataModeling/modelingAdvisorSchema';
import { type ModelingTelemetryEvent } from '../../../dataModeling/modelingTelemetrySchema';
import { type DataModelingEvent } from '../../api/types';
import { applyScenario, createBlankContainer } from './dataModel';
import { DataModelingWizard } from './DataModelingWizard';
import { createInitialSnapshot } from './modelingAdvisorState';

const client = vi.hoisted(() => ({
    dataModeling: {
        confirm: { mutate: vi.fn() },
        loadState: { query: vi.fn() },
        saveState: { mutate: vi.fn() },
        requestRecommendation: { mutate: vi.fn() },
        recordTelemetry: { mutate: vi.fn() },
        getDeploymentOptions: { query: vi.fn() },
        generateDeploymentTemplate: { query: vi.fn() },
        deploy: { mutate: vi.fn() },
        openDataExplorer: { mutate: vi.fn() },
        events: { subscribe: vi.fn() },
    },
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));
vi.mock('../../MonacoEditor', () => ({
    MonacoEditor: ({ value, options, onChange }: EditorProps) => (
        <textarea
            aria-label={options?.ariaLabel}
            readOnly={options?.readOnly}
            value={value}
            onChange={(event) =>
                onChange?.(event.currentTarget.value, {
                    changes: [],
                    eol: '\n',
                    versionId: 1,
                    isUndoing: false,
                    isRedoing: false,
                    isFlush: false,
                    isEolChange: false,
                })
            }
        />
    ),
}));
function restored(step = 2): ModelingAdvisorSnapshot {
    const container = createBlankContainer('Orders');
    container.scale.candidates[0].distinctValues = 872;
    return {
        wizard: {
            ...createInitialSnapshot().wizard,
            scenario: 'other',
            step,
            dataModel: { containers: [container], activeContainerId: container.id },
        },
        recommendation: {
            status: 'received',
            value: {
                summary: 'Restored result',
                containers: [
                    {
                        entity: 'Orders',
                        partitionKey: '/orderId',
                        rationale: '',
                        guardrails: [{ rule: 'Immutability', detail: 'Order IDs remain unchanged for each order.' }],
                        candidates: [
                            {
                                partitionKey: '/orderId',
                                score: 100,
                                verdict: 'recommended',
                                assessments: [],
                            },
                        ],
                    },
                ],
            },
        },
    };
}

function lastSave(): ModelingAdvisorSnapshot {
    return client.dataModeling.saveState.mutate.mock.calls.at(-1)?.[0] as ModelingAdvisorSnapshot;
}

function usage() {
    const events = client.dataModeling.recordTelemetry.mutate.mock.calls.map(
        ([event]) => event as ModelingTelemetryEvent,
    );
    const last = events.filter((event) => event.type === 'usage').at(-1);
    if (!last) throw new Error('No usage summary received');
    return last.usage;
}

function deployedSnapshot(): ModelingAdvisorSnapshot {
    return {
        ...restored(4),
        deployment: {
            input: {
                databaseMode: 'existing',
                databaseName: 'existing-db',
                containers: [{ entity: 'Orders', partitionKey: '/orderId' }],
            },
            result: { status: 'deployed', databaseName: 'existing-db', createdCount: 0, existingCount: 1 },
        },
    };
}

function render(element: ReactElement) {
    return renderReact(<FluentProvider theme={webLightTheme}>{element}</FluentProvider>);
}

let respondToConfirmation: ((result: boolean | undefined) => void) | undefined;

async function answerConfirmation(message: string | RegExp, result: boolean | undefined) {
    await waitFor(() => {
        expect(respondToConfirmation).toBeTypeOf('function');
        expect(client.dataModeling.confirm.mutate.mock.calls.at(-1)?.[0].message).toMatch(message);
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await act(async () => {
        respondToConfirmation!(result);
        respondToConfirmation = undefined;
    });
}

async function continueExisting() {
    await answerConfirmation('Continue your data model?', true);
}

async function enterDeployStep() {
    const button = screen.getAllByRole('button', { name: 'Deploy' }).find((element) => !element.closest('nav'));
    if (!button) {
        throw new Error('Result Deploy button not found');
    }
    expect(button).toHaveTextContent('Deploy');
    expect(button).toHaveAccessibleName('Deploy');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    await userEvent.click(button);
}

async function confirmAdvance() {
    await answerConfirmation('Restart from this step?', true);
}

async function confirmDeployment() {
    await answerConfirmation(/^Deploy data model to/, true);
}

/**
 * Asserts that no Deploy affordance can be activated. The footer button is a Fluent `Button` and
 * renders a plain `disabled`, while the breadcrumb step is `disabledFocusable`: it deliberately stays
 * in the tab order and reports `aria-disabled` instead, so both mechanisms have to be accepted here.
 */
function expectNoActionableDeployButton() {
    const deployButtons = screen.getAllByRole('button', { name: 'Deploy' });
    expect(deployButtons.length).toBeGreaterThan(0);
    const actionable = deployButtons.filter((button) => !button.matches(':disabled, [aria-disabled="true"]'));
    expect(actionable.map((button) => button.textContent)).toEqual([]);
}

describe('data modeler saved-work choice and revisiting steps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        respondToConfirmation = undefined;
        client.dataModeling.confirm.mutate.mockImplementation(
            () =>
                new Promise<boolean | undefined>((resolve) => {
                    respondToConfirmation = resolve;
                }),
        );
        client.dataModeling.loadState.query.mockResolvedValue(null);
        client.dataModeling.saveState.mutate.mockResolvedValue(undefined);
        client.dataModeling.requestRecommendation.mutate.mockResolvedValue(undefined);
        client.dataModeling.recordTelemetry.mutate.mockResolvedValue(undefined);
        client.dataModeling.getDeploymentOptions.query.mockResolvedValue({
            accountName: 'source',
            databases: ['existing-db'],
        });
        client.dataModeling.generateDeploymentTemplate.query.mockImplementation(
            async (input: DeploymentTemplateInput) =>
                `// ${input.databaseMode} ${input.databaseName}: ${input.containers.map((container) => container.entity).join(', ')}`,
        );
        client.dataModeling.deploy.mutate.mockResolvedValue({ status: 'cancelled' });
        client.dataModeling.openDataExplorer.mutate.mockResolvedValue(undefined);
        client.dataModeling.events.subscribe.mockReturnValue({ unsubscribe: vi.fn() });
    });

    it('uses the shared sticky-navigation layout and keeps the footer outside its scroll region', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        const navigation = screen.getByRole('navigation', { name: 'Data modeling steps' });
        const scrollRegion = navigation.closest('[data-header-behavior="sticky-navigation"]');
        expect(scrollRegion).toHaveAttribute('tabindex', '0');
        const content = scrollRegion?.firstElementChild;
        expect(content).toContainElement(navigation);
        expect(content).toHaveStyle({ maxWidth: 'none', padding: '24px' });
        const title = screen.getByRole('heading', { name: /^Workload:/ });
        expect(scrollRegion).toContainElement(title);
        expect(title).toHaveAccessibleName(title.textContent);
        const titleIcon = title.parentElement?.parentElement?.querySelector('svg');
        expect(titleIcon).toBeVisible();
        expect(titleIcon).toHaveAttribute('aria-hidden', 'true');
        expect(titleIcon).toHaveAttribute('focusable', 'false');
        expect(scrollRegion).toContainElement(screen.getByRole('heading', { name: 'Partition key recommendation' }));
        expect(scrollRegion).not.toContainElement(screen.getByRole('button', { name: 'Start Over' }));
        expect(within(navigation).getByRole('button', { name: 'Result' })).toHaveAttribute('aria-current', 'step');
    });

    it('supports keyboard step navigation, focuses its heading, and unmounts the previous content', async () => {
        const user = userEvent.setup();
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        const review = screen.getByRole('button', { name: 'Review' });
        expect(review).toHaveTextContent('Review');
        expect(review).toHaveAccessibleName('Review');
        review.focus();
        await user.keyboard('{Enter}');
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Review your inputs' })).toHaveFocus());
        expect(screen.queryByRole('region', { name: 'Partition key recommendation' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Review' })).toHaveAttribute('aria-current', 'step');
        expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
    });

    it('deploys directly from the final step without generating or submitting Bicep or saving deployment state', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        const steps = within(screen.getByRole('navigation', { name: 'Data modeling steps' }));
        expect(steps.getAllByRole('button').map((button) => button.textContent)).toEqual([
            'Workload',
            'Container:Orders',
            'Review',
            'Result',
            'Deploy',
        ]);
        expect(client.dataModeling.getDeploymentOptions.query).not.toHaveBeenCalled();
        await enterDeployStep();
        const section = within(screen.getByRole('region', { name: 'Deploy data model' }));
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Deploy data model' })).toHaveFocus());
        await screen.findByText('source', { selector: 'dd' });
        expect(client.dataModeling.deploy.mutate).not.toHaveBeenCalled();
        fireEvent.change(section.getByRole('textbox', { name: 'New database name' }), {
            target: { value: 'fresh-db' },
        });
        const deploy = section.getByRole('button', { name: 'Deploy' });
        await waitFor(() => expect(deploy).toBeEnabled());
        expect(section.queryByRole('textbox', { name: 'Bicep deployment template' })).not.toBeInTheDocument();
        expect(client.dataModeling.generateDeploymentTemplate.query).not.toHaveBeenCalled();
        await userEvent.click(deploy);
        await confirmDeployment();
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledWith({
            databaseMode: 'new',
            databaseName: 'fresh-db',
            containers: [{ entity: 'Orders', partitionKey: '/orderId' }],
        });
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('keeps a deployment draft on Back but does not restore it or Deploy navigation after reopening', async () => {
        const saved = restored(4);
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        const mounted = render(<DataModelingWizard />);
        await continueExisting();
        await enterDeployStep();
        await userEvent.click(screen.getByRole('radio', { name: 'Bicep' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), {
            target: { value: 'unsaved-db' },
        });
        await waitFor(() =>
            expect(screen.getByRole('textbox', { name: 'Bicep deployment template' })).toHaveValue(
                '// new unsaved-db: Orders',
            ),
        );
        fireEvent.change(screen.getByRole('textbox', { name: 'Bicep deployment template' }), {
            target: { value: '// unsaved Bicep' },
        });
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByText('Restored result')).toBeVisible();
        await enterDeployStep();
        expect(screen.getByRole('radio', { name: 'Bicep' })).toBeChecked();
        expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveValue('unsaved-db');
        expect(screen.getByRole('textbox', { name: 'Bicep deployment template' })).toHaveValue('// unsaved Bicep');
        await userEvent.click(screen.getByRole('checkbox', { name: 'Orders' }));
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        mounted.unmount();
        render(<DataModelingWizard />);
        await continueExisting();
        expect(screen.getByText('Restored result')).toBeVisible();
        expect(screen.queryByRole('textbox', { name: 'Bicep deployment template' })).not.toBeInTheDocument();
        await enterDeployStep();
        expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveValue('');
        expect(screen.getByRole('radio', { name: 'Direct' })).toBeChecked();
        expect(screen.queryByRole('textbox', { name: 'Bicep deployment template' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('radio', { name: 'Bicep' }));
        expect(screen.getByRole('textbox', { name: 'Bicep deployment template' })).toHaveValue('');
        expect(screen.getByRole('checkbox', { name: 'Orders' })).toBeChecked();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('restores saved deployment success, green step and portal action after closing and reopening', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        client.dataModeling.deploy.mutate.mockResolvedValueOnce({
            status: 'deployed',
            databaseName: 'fresh-db',
            createdCount: 1,
            existingCount: 0,
        });
        const mounted = render(<DataModelingWizard />);
        await continueExisting();
        await enterDeployStep();
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), { target: { value: 'fresh-db' } });
        const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
            name: 'Deploy',
        });
        await waitFor(() => expect(deploy).toBeEnabled());
        await userEvent.click(deploy);
        await confirmDeployment();
        expect(await screen.findByRole('region', { name: 'Deployment successful' })).toBeVisible();

        client.dataModeling.getDeploymentOptions.query.mockResolvedValue({
            accountName: 'source',
            databases: ['existing-db', 'fresh-db'],
        });
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
        await enterDeployStep();
        const success = within(screen.getByRole('region', { name: 'Deployment successful' }));
        expect(
            success.getByText('Data model deployed to "fresh-db": 1 container(s) created, 0 left unchanged.'),
        ).toBeVisible();
        expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveValue('fresh-db');
        const explorer = success.getByRole('button', { name: 'Open in Data Explorer' });
        expect(explorer).toHaveAccessibleName('Open in Data Explorer');
        await userEvent.click(explorer);
        expect(client.dataModeling.openDataExplorer.mutate).toHaveBeenCalledWith({
            databaseId: 'fresh-db',
            containerId: 'Orders',
        });
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledOnce();
        await waitFor(() => expect(lastSave().deployment?.result.databaseName).toBe('fresh-db'));
        const saved = ModelingAdvisorSnapshotSchema.parse(JSON.parse(JSON.stringify(lastSave())));
        expect(saved.deployment?.input).toEqual({
            databaseMode: 'new',
            databaseName: 'fresh-db',
            containers: [{ entity: 'Orders', partitionKey: '/orderId' }],
        });
        expect(saved.deployment).not.toHaveProperty('template');
        mounted.unmount();
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        expect(await screen.findByRole('region', { name: 'Deployment successful' })).toBeVisible();
        expect(
            within(screen.getByRole('navigation', { name: 'Data modeling steps' }))
                .getByRole('button', {
                    name: 'Deploy',
                })
                .querySelector('svg'),
        ).toHaveStyle({ color: tokens.colorPaletteGreenForeground1 });
        expect(
            screen.getByText('Data model deployed to "fresh-db": 1 container(s) created, 0 left unchanged.'),
        ).toBeVisible();
        expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveValue('fresh-db');
        await userEvent.click(screen.getByRole('button', { name: 'Open in Data Explorer' }));
        expect(client.dataModeling.openDataExplorer.mutate).toHaveBeenLastCalledWith({
            databaseId: 'fresh-db',
            containerId: 'Orders',
        });
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledOnce();

        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), {
            target: { value: 'another-db' },
        });
        expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), { target: { value: 'fresh-db' } });
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        await enterDeployStep();
        expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledOnce();
        await waitFor(() => expect(lastSave().deployment).toBeUndefined());
        expect(
            within(screen.getByRole('navigation', { name: 'Data modeling steps' }))
                .getByRole('button', {
                    name: 'Deploy',
                })
                .querySelector('svg'),
        ).not.toHaveStyle({ color: tokens.colorPaletteGreenForeground1 });
    });

    it('locks navigation during deployment and saves only its successful completion, not its template', async () => {
        let finish!: (result: {
            status: 'deployed';
            databaseName: string;
            createdCount: number;
            existingCount: number;
        }) => void;
        client.dataModeling.deploy.mutate.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        await enterDeployStep();
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), { target: { value: 'fresh-db' } });
        const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
            name: 'Deploy',
        });
        await waitFor(() => expect(deploy).toBeEnabled());
        await userEvent.click(deploy);
        await confirmDeployment();
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Start Over' })).toBeDisabled();
        const navigation = within(screen.getByRole('navigation'));
        for (const name of ['Workload', 'Container: Orders', 'Review', 'Result']) {
            const step = navigation.getByRole('button', { name });
            expect(step).toHaveAttribute('aria-disabled', 'true');
            await userEvent.click(step);
            expect(screen.getByRole('region', { name: 'Deploy data model' })).toBeVisible();
        }
        await act(async () =>
            finish({ status: 'deployed', databaseName: 'fresh-db', createdCount: 1, existingCount: 0 }),
        );
        expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
        await waitFor(() =>
            expect(lastSave().deployment?.result).toEqual({
                status: 'deployed',
                databaseName: 'fresh-db',
                createdCount: 1,
                existingCount: 0,
            }),
        );
        expect(lastSave().deployment).not.toHaveProperty('template');
    });

    it('restores an existing-database deployment and clears saved completion when a retry is cancelled', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(deployedSnapshot());
        render(<DataModelingWizard />);
        await continueExisting();
        expect(await screen.findByRole('region', { name: 'Deployment successful' })).toBeVisible();
        expect(screen.getByRole('radio', { name: 'Existing database' })).toBeChecked();
        expect(screen.getByRole('combobox', { name: 'Existing database' })).toHaveTextContent('existing-db');
        expect(
            screen.getByText('Data model deployed to "existing-db": 0 container(s) created, 1 left unchanged.'),
        ).toBeVisible();
        expect(client.dataModeling.deploy.mutate).not.toHaveBeenCalled();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
            name: 'Deploy',
        });
        await waitFor(() => expect(deploy).toBeEnabled());
        await userEvent.click(deploy);
        await confirmDeployment();
        expect(await screen.findByText('Deployment cancelled. No deployment was started.')).toBeVisible();
        expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
        await waitFor(() => expect(client.dataModeling.saveState.mutate).toHaveBeenCalled());
        expect(lastSave().deployment).toBeUndefined();
    });

    it.each(['Start Over', 'new recommendation'] as const)('clears persisted completion on %s', async (action) => {
        client.dataModeling.loadState.query.mockResolvedValue(deployedSnapshot());
        render(<DataModelingWizard />);
        await continueExisting();
        await screen.findByRole('region', { name: 'Deployment successful' });
        if (action === 'Start Over') {
            await userEvent.click(screen.getByRole('button', { name: 'Start Over' }));
        } else {
            await userEvent.click(
                within(screen.getByRole('navigation', { name: 'Data modeling steps' })).getByRole('button', {
                    name: 'Review',
                }),
            );
            await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
            await confirmAdvance();
        }
        await waitFor(() =>
            expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledTimes(
                action === 'new recommendation' ? 1 : 0,
            ),
        );
        await waitFor(() => expect(client.dataModeling.saveState.mutate).toHaveBeenCalled());
        expect(lastSave().deployment).toBeUndefined();
        expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
        expect(client.dataModeling.deploy.mutate).not.toHaveBeenCalled();
    });

    it('keeps deployment success visible after a save failure and retries saving without deploying again', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        client.dataModeling.saveState.mutate.mockRejectedValueOnce(new Error('Disk full'));
        client.dataModeling.deploy.mutate.mockResolvedValueOnce({
            status: 'deployed',
            databaseName: 'fresh-db',
            createdCount: 1,
            existingCount: 0,
        });
        render(<DataModelingWizard />);
        await continueExisting();
        await enterDeployStep();
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), { target: { value: 'fresh-db' } });
        const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
            name: 'Deploy',
        });
        await waitFor(() => expect(deploy).toBeEnabled());
        await userEvent.click(deploy);
        await confirmDeployment();
        const retry = await screen.findByRole('button', { name: 'Retry saving' });
        expect(screen.getByRole('region', { name: 'Deployment successful' })).toBeVisible();
        expect(screen.queryByText(/Deployment failed/)).not.toBeInTheDocument();
        await userEvent.click(retry);
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry saving' })).not.toBeInTheDocument());
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledOnce();
        expect(client.dataModeling.saveState.mutate).toHaveBeenCalledTimes(2);
        expect(lastSave().deployment?.result.databaseName).toBe('fresh-db');
    });

    it.each(['idle', 'waiting', 'error'] as const)('does not unlock Deploy for a %s recommendation', async (status) => {
        const saved = restored(4);
        saved.recommendation = { status };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        expectNoActionableDeployButton();
        expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    });

    it('opens directly on Workload with no saved project', async () => {
        render(<DataModelingWizard />);
        expect(await screen.findByRole('button', { name: 'Start' })).toBeDisabled();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('does not emit workload selections when continuing saved work', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(1));
        render(<DataModelingWizard />);
        await continueExisting();
        expect(usage().scenario).toBe('other');
        expect(
            client.dataModeling.recordTelemetry.mutate.mock.calls.some(
                ([event]) => (event as ModelingTelemetryEvent).type === 'scenarioSelected',
            ),
        ).toBe(false);
    });

    it('opens a native saved-work choice and preserves it on dismissal until the choice is reopened', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        const proceed = await screen.findByRole('button', { name: 'Continue your data model?' });
        expect(screen.getByText('Workload')).toBeInTheDocument();
        expect(proceed).toHaveTextContent('Continue your data model?');
        expect(proceed).toHaveAccessibleName('Continue your data model?');
        await answerConfirmation('Continue your data model?', undefined);
        expect(proceed).toHaveFocus();
        expect(client.dataModeling.events.subscribe).not.toHaveBeenCalled();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        expect(client.dataModeling.confirm.mutate).toHaveBeenCalledOnce();
        await userEvent.click(proceed);
        await continueExisting();
        expect(await screen.findByText('Restored result')).toBeInTheDocument();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('Start new replaces only the saved session and keeps the Workload page', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await answerConfirmation('Continue your data model?', false);
        expect(await screen.findByRole('button', { name: 'Start' })).toBeDisabled();
        expect(lastSave()).toEqual(createInitialSnapshot());
        expect(screen.queryByText('Restored result')).not.toBeInTheDocument();
    });

    it('reports a failed saved-work prompt and allows retry without overwriting the model', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        client.dataModeling.confirm.mutate.mockRejectedValueOnce(new Error('Host unavailable'));
        render(<DataModelingWizard />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not open the confirmation dialog.');
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Continue your data model?' }));
        await continueExisting();
        expect(await screen.findByText('Restored result')).toBeInTheDocument();
    });

    it.each([true, false, undefined])('removes a container only after native Yes (response: %s)', async (response) => {
        const saved = restored();
        saved.wizard.dataModel.containers.push(createBlankContainer('Users'));
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        const remove = screen.getByRole('button', { name: 'Remove this container' });
        await userEvent.click(remove);
        expect(client.dataModeling.confirm.mutate).toHaveBeenLastCalledWith({
            message: 'Remove this container?',
            detail: 'Remove the “Orders” container? This cannot be undone.',
        });
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await answerConfirmation('Remove this container?', response);
        expect(client.dataModeling.saveState.mutate).toHaveBeenCalledTimes(response === true ? 1 : 0);
        expect((lastSave() ?? saved).wizard.dataModel.containers.map((container) => container.entity)).toEqual(
            response === true ? ['Users'] : ['Orders', 'Users'],
        );
        expect(remove).toHaveProperty('disabled', response === true);
    });

    it('preserves inputs and cardinality, but does not save tabs, draft properties, or dialogs', async () => {
        const user = userEvent.setup();
        const saved = restored();
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        const mounted = render(<DataModelingWizard />);
        await continueExisting();
        await user.click(screen.getByRole('tab', { name: 'Scale' }));
        expect(screen.getByDisplayValue('872')).toBeInTheDocument();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await user.click(screen.getByRole('tab', { name: 'Data' }));
        fireEvent.change(screen.getByPlaceholderText('Add property…'), { target: { value: 'draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add container' }));
        fireEvent.change(await screen.findByRole('textbox', { name: 'Container name' }), {
            target: { value: 'unsaved name' },
        });
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        mounted.unmount();
        render(<DataModelingWizard />);
        await continueExisting();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByPlaceholderText('Add property…')).toHaveValue('');
        await user.click(screen.getByRole('button', { name: 'Next' }));
        expect(lastSave().wizard).toEqual({
            ...saved.wizard,
            step: 3,
            reachedSteps: ['workload', `container:${saved.wizard.dataModel.activeContainerId}`, 'review'],
        });
        const { deployment, ...modelingState } = lastSave();
        expect(deployment).toBeUndefined();
        expect(Object.keys(modelingState).sort()).toEqual(['recommendation', 'wizard']);
    });

    it('reports load failures without enabling edits or saving, and retries detection', async () => {
        client.dataModeling.loadState.query
            .mockRejectedValueOnce(new Error('invalid file'))
            .mockResolvedValue(restored());
        render(<DataModelingWizard />);
        await userEvent.click(await screen.findByRole('button', { name: 'Retry loading' }));
        await waitFor(() => expect(client.dataModeling.confirm.mutate).toHaveBeenCalledOnce());
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('surfaces a failed Start new save and retries the fresh state', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored());
        client.dataModeling.saveState.mutate.mockRejectedValueOnce(new Error('disk full'));
        render(<DataModelingWizard />);
        await answerConfirmation('Continue your data model?', false);
        const retry = await screen.findByRole('button', { name: 'Retry saving' });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
        await userEvent.click(retry);
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry saving' })).not.toBeInTheDocument());
        expect(lastSave()).toEqual(createInitialSnapshot());
    });

    it('saves recommendation events and ignores late events after Start Over', async () => {
        const saved = restored(3);
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        await confirmAdvance();
        expect(lastSave().recommendation.status).toBe('waiting');
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        act(() => callbacks.onData({ type: 'recommendationReceived', recommendation: saved.recommendation.value! }));
        expect(lastSave().recommendation).toEqual({
            status: 'received',
            value: saved.recommendation.value,
        });
        await userEvent.click(screen.getByRole('button', { name: 'Start Over' }));
        act(() => callbacks.onData({ type: 'recommendationReceived', recommendation: saved.recommendation.value! }));
        expect(lastSave()).toEqual(createInitialSnapshot());
        expect(screen.getByRole('button', { name: 'Review' })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: 'Result' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('waits for the input save before opening Chat', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        let finishSave!: () => void;
        client.dataModeling.saveState.mutate.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishSave = resolve;
                }),
        );
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        expect(lastSave().wizard.step).toBe(4);
        expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
        await act(async () => {
            finishSave();
        });
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledOnce();
    });

    it('preserves the recommendation and forward navigation when browsing completed steps', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        await userEvent.click(screen.getByRole('button', { name: 'Result' }));
        expect(screen.getByText('Restored result')).toBeInTheDocument();
        expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
    });

    it('preserves model scores, verdicts, and the selected key through save, restore, and deployment', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        const mounted = render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledWith({
            ...lastSave().wizard,
            requestId: expect.any(String),
        });
        expect(lastSave().wizard.dataModel).toEqual(saved.wizard.dataModel);
        await userEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        const result = restored().recommendation.value!;
        result.containers[0].partitionKey = '/write';
        result.containers[0].rationale = 'Write distribution best fits this workload.';
        result.containers[0].candidates = [
            {
                partitionKey: '/write',
                score: 100,
                verdict: 'recommended',
                assessments: [],
            },
            {
                partitionKey: '/read',
                score: 0,
                verdict: 'avoid',
                assessments: [],
            },
        ];
        act(() => callbacks.onData({ type: 'recommendationReceived', recommendation: result }));
        const persisted = lastSave();
        expect(persisted.wizard).not.toHaveProperty('weights');
        expect(persisted.recommendation).toEqual({ status: 'received', value: result });
        mounted.unmount();
        client.dataModeling.loadState.query.mockResolvedValue({
            ...persisted,
            wizard: { ...persisted.wizard, step: 4 },
        });
        render(<DataModelingWizard />);
        await continueExisting();
        expect(screen.getByText('/write')).toBeVisible();
        expect(screen.queryByRole('textbox', { name: 'Container creation code sample' })).not.toBeInTheDocument();
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledOnce();
        await enterDeployStep();
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), {
            target: { value: 'model-db' },
        });
        const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
            name: 'Deploy',
        });
        await waitFor(() => expect(deploy).toBeEnabled());
        await userEvent.click(deploy);
        await confirmDeployment();
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledWith({
            databaseMode: 'new',
            databaseName: 'model-db',
            containers: [{ entity: 'Orders', partitionKey: '/write' }],
        });
    });

    it('shows an explicit recommendation failure, blocks deployment, and allows retry', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        const message = 'Cannot recommend a key: provide dominant read predicates and peak QPS.';
        act(() => callbacks.onData({ type: 'recommendationError', message }));
        expect(lastSave().recommendation).toEqual({ status: 'error', error: message });
        expect(screen.getByText(message)).toBeVisible();
        expectNoActionableDeployButton();
        expect(screen.queryByText('Restored result')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledTimes(2));
        expect(lastSave().recommendation).toEqual({ status: 'waiting' });
    });

    it('rejects invalid results rather than inventing missing scores', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        const invalid = restored().recommendation.value!;
        Reflect.deleteProperty(invalid.containers[0].candidates![0], 'score');
        act(() =>
            callbacks.onData({
                type: 'recommendationReceived',
                recommendation: invalid,
            }),
        );
        expect(lastSave().recommendation.status).toBe('error');
        expect(screen.getByText('The recommendation is invalid. Request a new recommendation.')).toBeInTheDocument();
    });

    it.each([false, undefined])(
        'keeps the result and restores focus when confirmation is dismissed with %s',
        async (dismissal) => {
            const user = userEvent.setup();
            client.dataModeling.loadState.query.mockResolvedValue(restored(4));
            render(<DataModelingWizard />);
            await continueExisting();
            await user.click(screen.getByRole('button', { name: 'Review' }));
            const next = screen.getByRole('button', { name: 'Get Recommendation' });
            await user.click(next);
            await answerConfirmation('Restart from this step?', dismissal);
            await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
            await waitFor(() => expect(next).toHaveFocus());
            await user.click(screen.getByRole('button', { name: 'Result' }));
            expect(screen.getByText('Restored result')).toBeInTheDocument();
            expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
        },
    );

    it.each([
        { step: 'Workload', next: 'Start' },
        { step: 'Container: Orders', next: 'Next' },
    ])('invalidates downstream progress from $step only after confirmation and persists it', async ({ step, next }) => {
        const saved = restored(4);
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        const mounted = render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: step }));
        await userEvent.click(screen.getByRole('button', { name: next }));
        await confirmAdvance();
        expect(lastSave().wizard.dataModel.containers).toEqual(saved.wizard.dataModel.containers);
        expect(lastSave().recommendation).toEqual({ status: 'idle' });
        expect(screen.getByRole('button', { name: 'Result' })).toHaveAttribute('aria-disabled', 'true');
        const persisted = lastSave();
        mounted.unmount();
        client.dataModeling.loadState.query.mockResolvedValue(persisted);
        render(<DataModelingWizard />);
        await continueExisting();
        expect(screen.getByRole('button', { name: 'Result' })).toHaveAttribute('aria-disabled', 'true');
        while (screen.queryByRole('button', { name: 'Next' })) {
            await userEvent.click(screen.getByRole('button', { name: 'Next' }));
            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        }
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledWith({
            ...lastSave().wizard,
            requestId: expect.any(String),
        });
        expect(lastSave().wizard.dataModel).toEqual(saved.wizard.dataModel);
    });

    it('sends the selected scenario and unmodified model so the host can apply the default hint rule', async () => {
        const saved = createInitialSnapshot();
        saved.wizard = { ...applyScenario(saved.wizard, 'inventory'), step: 4 };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        await waitFor(() => expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledOnce());
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledWith({
            ...lastSave().wizard,
            requestId: expect.any(String),
        });
        expect(lastSave().wizard.scenario).toBe('inventory');
        expect(lastSave().wizard.dataModel).toEqual(saved.wizard.dataModel);
    });

    it('counts only displayed container tabs and keeps restored results uncorrelated', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        expect(usage()).toMatchObject({
            containerCount: 1,
            dataViewedCount: 0,
            queriesNeverViewedCount: 1,
            scaleNeverViewedCount: 1,
        });
        expect(client.dataModeling.recordTelemetry.mutate).toHaveBeenCalledWith({
            type: 'recommendationDisplayed',
            requestId: undefined,
        });
        await userEvent.click(screen.getByRole('button', { name: 'Container: Orders' }));
        expect(usage()).toMatchObject({ dataViewedCount: 1, dataCoverage: 1, queriesViewedCount: 0 });
        await userEvent.click(screen.getByRole('tab', { name: 'Queries' }));
        expect(usage()).toMatchObject({ queriesViewedCount: 1, queriesNeverViewedCount: 0, scaleViewedCount: 0 });
        await userEvent.click(screen.getByRole('tab', { name: 'Data' }));
        await userEvent.click(screen.getByRole('tab', { name: 'Queries' }));
        expect(usage().queriesViewedCount).toBe(1);
        await userEvent.click(screen.getByRole('tab', { name: 'Scale' }));
        expect(usage()).toMatchObject({ scaleViewedCount: 1, scaleCoverage: 1 });
        const payloads = JSON.stringify(client.dataModeling.recordTelemetry.mutate.mock.calls);
        expect(payloads).not.toContain('Orders');
        expect(payloads).not.toContain('/orderId');
        expect(payloads).not.toContain('Restored result');
        const controls = client.dataModeling.recordTelemetry.mutate.mock.calls
            .map(([event]) => event as ModelingTelemetryEvent)
            .filter((event) => event.type === 'control');
        expect(controls).toEqual([
            { type: 'control', control: 'containerQueriesTab' },
            { type: 'control', control: 'containerDataTab' },
            { type: 'control', control: 'containerQueriesTab' },
            { type: 'control', control: 'containerScaleTab' },
        ]);
    });

    it.each([
        { button: 'Start', control: 'footerStart', step: 1 },
        { button: 'Next', control: 'footerNext', step: 2 },
        { button: 'Back', control: 'footerBack', step: 2 },
        { button: 'Get Recommendation', control: 'footerGetRecommendation', step: 3 },
        { button: 'Add container', control: 'footerAddContainer', step: 2 },
        { button: 'Remove this container', control: 'footerRemoveContainer', step: 2 },
        { button: 'Start Over', control: 'footerStartOver', step: 4 },
        { button: 'Deploy', control: 'footerDeploy', step: 4 },
    ])('records footer $button activation, independently of completion', async ({ button, control, step }) => {
        const saved = restored(step);
        if (control === 'footerRemoveContainer') {
            saved.wizard.dataModel.containers.push(createBlankContainer('PrivateSecondContainer'));
        }
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        const footerButton = screen.getAllByRole('button', { name: button }).find((element) => !element.closest('nav'));
        if (!footerButton) throw new Error('Missing footer button');
        await userEvent.click(footerButton);
        expect(client.dataModeling.recordTelemetry.mutate).toHaveBeenCalledWith({ type: 'control', control });
    });

    it('does not count a hidden container section until the document is visible', async () => {
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        try {
            client.dataModeling.loadState.query.mockResolvedValue(restored(2));
            render(<DataModelingWizard />);
            await continueExisting();
            expect(usage().dataViewedCount).toBe(0);
            visibility.mockReturnValue('visible');
            act(() => document.dispatchEvent(new Event('visibilitychange')));
            expect(usage().dataViewedCount).toBe(1);
        } finally {
            visibility.mockRestore();
        }
    });

    it('retains feedback across navigation, deduplicates votes, and resets for a new recommendation', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        const up = () => screen.getByRole('button', { name: 'Helpful recommendation' });
        const down = () => screen.getByRole('button', { name: 'Unhelpful recommendation' });
        await userEvent.click(up());
        expect(up()).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(screen.getByRole('button', { name: 'Review' }));
        await userEvent.click(screen.getByRole('button', { name: 'Result' }));
        expect(up()).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(up());
        await userEvent.click(down());
        expect(down()).toHaveAttribute('aria-pressed', 'true');
        const votes = client.dataModeling.recordTelemetry.mutate.mock.calls
            .map(([event]) => event as ModelingTelemetryEvent)
            .filter((event) => event.type === 'feedback');
        expect(votes).toEqual([
            { type: 'feedback', vote: 'up' },
            { type: 'feedback', vote: 'down' },
        ]);
        await userEvent.click(screen.getByRole('button', { name: 'Review' }));
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        await confirmAdvance();
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        act(() =>
            callbacks.onData({ type: 'recommendationReceived', recommendation: restored().recommendation.value! }),
        );
        expect(up()).toHaveAttribute('aria-pressed', 'false');
        expect(down()).toHaveAttribute('aria-pressed', 'false');
        expect(lastSave()).not.toHaveProperty('feedback');
        expect(lastSave().recommendation).not.toHaveProperty('feedback');
    });

    it('keeps telemetry bridge errors out of the modeling flow and never logs raw failures', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        client.dataModeling.recordTelemetry.mutate.mockRejectedValueOnce(new Error('private-transport-details'));
        try {
            render(<DataModelingWizard />);
            await screen.findByRole('button', { name: 'Start' });
            await waitFor(() =>
                expect(warning).toHaveBeenCalledWith('[Data Modeler] Could not record usage telemetry.'),
            );
            expect(JSON.stringify(warning.mock.calls)).not.toContain('private-transport-details');
            expect(screen.queryByRole('alert')).toBeEmptyDOMElement();
        } finally {
            warning.mockRestore();
        }
    });

    it('ignores stale correlated results and records the displayed current attempt without persisting IDs', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        const request = client.dataModeling.requestRecommendation.mutate.mock.calls.at(-1)?.[0] as {
            requestId: string;
        };
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        const recommendation = restored().recommendation.value!;
        act(() =>
            callbacks.onData({
                type: 'recommendationReceived',
                requestId: crypto.randomUUID(),
                recommendation,
            }),
        );
        expect(lastSave().recommendation.status).toBe('waiting');
        act(() => callbacks.onData({ type: 'recommendationReceived', requestId: request.requestId, recommendation }));
        expect(lastSave().recommendation.status).toBe('received');
        expect(client.dataModeling.recordTelemetry.mutate).toHaveBeenCalledWith({
            type: 'recommendationDisplayed',
            requestId: request.requestId,
        });
        expect(JSON.stringify(lastSave())).not.toContain(request.requestId);
    });
});
