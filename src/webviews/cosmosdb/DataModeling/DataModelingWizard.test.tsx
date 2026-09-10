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
import { type ModelingAdvisorSnapshot } from '../../../dataModeling/modelingAdvisorSchema';
import { rankRecommendation } from '../../../dataModeling/scoring';
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
        events: { subscribe: vi.fn() },
    },
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));
vi.mock('../../MonacoEditor', () => ({
    MonacoEditor: ({ value, options }: EditorProps) => (
        <textarea aria-label={options?.ariaLabel} readOnly value={value} />
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
            weights: { ...createInitialSnapshot().wizard.weights },
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
                                priorityScores: { read: 90, write: 70, storage: 80 },
                                rationale: 'Order-scoped requests.',
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
        client.dataModeling.events.subscribe.mockReturnValue({ unsubscribe: vi.fn() });
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
            weights: saved.wizard.weights,
            value: rankRecommendation(saved.recommendation.value!, saved.wizard.weights),
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

    it('uses request-time priorities even when Review priorities change before the response, and restores them', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        saved.wizard.weights = { read: 80, write: 10, storage: 10 };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        const mounted = render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledWith({
            dataModelJson: JSON.stringify(saved.wizard.dataModel),
            weights: { read: 80, write: 10, storage: 10 },
        });
        await userEvent.click(screen.getByRole('button', { name: 'Review' }));
        // Review edits are independent of the priorities captured when the pending request began.
        fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '10' } });
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        const result = restored().recommendation.value!;
        result.containers[0].candidates = [
            {
                partitionKey: '/write',
                score: 100,
                verdict: 'recommended',
                assessments: [],
                rationale: 'Write rationale',
                priorityScores: { read: 10, write: 100, storage: 50 },
            },
            {
                partitionKey: '/read',
                score: 0,
                verdict: 'avoid',
                assessments: [],
                rationale: 'Read rationale',
                priorityScores: { read: 100, write: 10, storage: 50 },
            },
        ];
        act(() => callbacks.onData({ type: 'recommendationReceived', recommendation: result }));
        const persisted = lastSave();
        expect(persisted.wizard.weights.read).toBe(10);
        expect(persisted.recommendation.weights).toEqual({ read: 80, write: 10, storage: 10 });
        expect(persisted.recommendation.value?.containers[0].partitionKey).toBe('/read');
        expect(persisted.recommendation.value?.containers[0].candidates?.[0].score).toBe(86);
        mounted.unmount();
        client.dataModeling.loadState.query.mockResolvedValue({
            ...persisted,
            wizard: { ...persisted.wizard, step: 4 },
        });
        render(<DataModelingWizard />);
        await continueExisting();
        expect(
            screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Container creation code sample' }).value,
        ).toContain("paths: [ '/read' ]");
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledOnce();
    });

    it('rejects fresh results without component scores rather than inventing a weighted score', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        act(() =>
            callbacks.onData({
                type: 'recommendationReceived',
                recommendation: { summary: '', containers: [{ entity: 'Orders', partitionKey: '/id', rationale: '' }] },
            }),
        );
        expect(lastSave().recommendation.status).toBe('error');
        expect(
            screen.getByText(
                'The recommendation is missing valid priority scores or priorities. Request a new recommendation.',
            ),
        ).toBeInTheDocument();
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
            weights: saved.wizard.weights,
        });
    });
});
