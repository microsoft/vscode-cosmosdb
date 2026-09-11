/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider } from '@fluentui/react-components';
import { type EditorProps } from '@monaco-editor/react';
import { act, fireEvent, render as renderReact, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Children, isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DeploymentTemplateInput } from '../../../dataModeling/deploymentModel';
import { type ModelingAdvisorSnapshot } from '../../../dataModeling/modelingAdvisorSchema';
import { type DataModelingEvent } from '../../api/types';
import { type StepListItemProps, type StepListProps } from './components/StepList/StepList.types';
import { createBlankContainer } from './dataModel';
import { DataModelingWizard } from './DataModelingWizard';
import { createInitialSnapshot } from './modelingAdvisorState';

const client = vi.hoisted(() => ({
    dataModeling: {
        loadState: { query: vi.fn() },
        saveState: { mutate: vi.fn() },
        requestRecommendation: { mutate: vi.fn() },
        getDeploymentOptions: { query: vi.fn() },
        generateDeploymentTemplate: { query: vi.fn() },
        deploy: { mutate: vi.fn() },
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
// jsdom has no layout callbacks to initialize Fluent's priority-overflow manager.
vi.mock('./components/StepList/StepList', () => ({
    StepList: ({ children, ariaLabel, onStepSelect }: StepListProps) => (
        <nav aria-label={ariaLabel}>
            {Children.map(children, (child) =>
                isValidElement<StepListItemProps>(child) ? (
                    <button
                        disabled={!child.props.navigable}
                        onClick={(event) => onStepSelect(event, { value: child.props.value })}
                    >
                        {child.props.children}
                    </button>
                ) : null,
            )}
        </nav>
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

function render(element: ReactElement) {
    return renderReact(<FluentProvider>{element}</FluentProvider>);
}

async function continueExisting() {
    await userEvent.click(await screen.findByRole('button', { name: 'Continue existing' }));
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
    const yes = within(await screen.findByRole('alertdialog', { name: 'Restart from this step?' })).getByRole(
        'button',
        { name: 'Yes' },
    );
    expect(yes).toHaveTextContent('Yes');
    expect(yes).toHaveAccessibleName('Yes');
    await userEvent.click(yes);
}

describe('data modeler saved-work choice and revisiting steps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        client.dataModeling.loadState.query.mockResolvedValue(null);
        client.dataModeling.saveState.mutate.mockResolvedValue(undefined);
        client.dataModeling.requestRecommendation.mutate.mockResolvedValue(undefined);
        client.dataModeling.getDeploymentOptions.query.mockResolvedValue({
            accountName: 'source',
            databases: ['existing-db'],
        });
        client.dataModeling.generateDeploymentTemplate.query.mockImplementation(
            async (input: DeploymentTemplateInput) =>
                `// ${input.databaseMode} ${input.databaseName}: ${input.containers.map((container) => container.entity).join(', ')}`,
        );
        client.dataModeling.deploy.mutate.mockResolvedValue({ status: 'cancelled' });
        client.dataModeling.events.subscribe.mockReturnValue({ unsubscribe: vi.fn() });
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
        await userEvent.click(screen.getByRole('radio', { name: 'Deploy with Biceps' }));
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
        expect(screen.getByRole('radio', { name: 'Deploy with Biceps' })).toBeChecked();
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
        expect(screen.getByRole('radio', { name: 'Deploy now' })).toBeChecked();
        expect(screen.queryByRole('textbox', { name: 'Bicep deployment template' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('radio', { name: 'Deploy with Biceps' }));
        expect(screen.getByRole('textbox', { name: 'Bicep deployment template' })).toHaveValue('');
        expect(screen.getByRole('checkbox', { name: 'Orders' })).toBeChecked();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('locks navigation during deployment and never saves its completion or template', async () => {
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
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Start Over' })).toBeDisabled();
        for (const step of within(screen.getByRole('navigation')).getAllByRole('button')) {
            expect(step).toBeDisabled();
        }
        await act(async () =>
            finish({ status: 'deployed', databaseName: 'fresh-db', createdCount: 1, existingCount: 0 }),
        );
        expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it.each(['idle', 'waiting', 'error'] as const)('does not unlock Deploy for a %s recommendation', async (status) => {
        const saved = restored(4);
        saved.recommendation = { status };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        for (const button of screen.getAllByRole('button', { name: 'Deploy' })) {
            expect(button).toBeDisabled();
        }
        expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    });

    it('opens directly on Workload with no saved project', async () => {
        render(<DataModelingWizard />);
        expect(await screen.findByRole('button', { name: 'Start' })).toBeDisabled();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('shows an accessible choice on Workload without overwriting or resuming saved work', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        const dialog = await screen.findByRole('alertdialog', { name: 'Continue your data model?' });
        expect(screen.getByText('Workload')).toBeInTheDocument();
        const proceed = screen.getByRole('button', { name: 'Continue existing' });
        expect(proceed).toHaveTextContent('Continue existing');
        expect(proceed).toHaveAccessibleName('Continue existing');
        expect(screen.getByRole('button', { name: 'Start new' })).toHaveTextContent('Start new');
        expect(screen.getByRole('button', { name: 'Start new' })).toHaveAccessibleName('Start new');
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
        await userEvent.keyboard('{Escape}');
        expect(dialog).toBeInTheDocument();
        expect(client.dataModeling.events.subscribe).not.toHaveBeenCalled();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await userEvent.click(proceed);
        expect(await screen.findByText('Restored result')).toBeInTheDocument();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('Start new replaces only the saved session and keeps the Workload page', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await userEvent.click(await screen.findByRole('button', { name: 'Start new' }));
        expect(await screen.findByRole('button', { name: 'Start' })).toBeDisabled();
        expect(lastSave()).toEqual(createInitialSnapshot());
        expect(screen.queryByText('Restored result')).not.toBeInTheDocument();
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
        expect(Object.keys(lastSave()).sort()).toEqual(['recommendation', 'wizard']);
    });

    it('reports load failures without enabling edits or saving, and retries detection', async () => {
        client.dataModeling.loadState.query
            .mockRejectedValueOnce(new Error('invalid file'))
            .mockResolvedValue(restored());
        render(<DataModelingWizard />);
        await userEvent.click(await screen.findByRole('button', { name: 'Retry loading' }));
        expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('surfaces a failed Start new save and retries the fresh state', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored());
        client.dataModeling.saveState.mutate.mockRejectedValueOnce(new Error('disk full'));
        render(<DataModelingWizard />);
        await userEvent.click(await screen.findByRole('button', { name: 'Start new' }));
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
        expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Result' })).toBeDisabled();
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
            dataModelJson: JSON.stringify(saved.wizard.dataModel),
        });
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
        expect(
            screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Container creation code sample' }).value,
        ).toContain("paths: ['/write']");
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
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledWith({
            databaseMode: 'new',
            databaseName: 'model-db',
            containers: [{ entity: 'Orders', partitionKey: '/write' }],
        });
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

    it.each(['Cancel', 'Escape'])(
        'keeps the result and restores focus when confirmation is dismissed with %s',
        async (dismissal) => {
            const user = userEvent.setup();
            client.dataModeling.loadState.query.mockResolvedValue(restored(4));
            render(<DataModelingWizard />);
            await continueExisting();
            await user.click(screen.getByRole('button', { name: 'Review' }));
            const next = screen.getByRole('button', { name: 'Get Recommendation' });
            await user.click(next);
            const cancel = within(
                await screen.findByRole('alertdialog', { name: 'Restart from this step?' }),
            ).getByRole('button', { name: 'Cancel' });
            expect(cancel).toHaveTextContent('Cancel');
            expect(cancel).toHaveAccessibleName('Cancel');
            await waitFor(() => expect(cancel).toHaveFocus());
            if (dismissal === 'Escape') await user.keyboard('{Escape}');
            else await user.click(cancel);
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
        expect(screen.getByRole('button', { name: 'Result' })).toBeDisabled();
        const persisted = lastSave();
        mounted.unmount();
        client.dataModeling.loadState.query.mockResolvedValue(persisted);
        render(<DataModelingWizard />);
        await continueExisting();
        expect(screen.getByRole('button', { name: 'Result' })).toBeDisabled();
        while (screen.queryByRole('button', { name: 'Next' })) {
            await userEvent.click(screen.getByRole('button', { name: 'Next' }));
            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        }
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledWith({
            dataModelJson: JSON.stringify(saved.wizard.dataModel),
        });
    });
});
