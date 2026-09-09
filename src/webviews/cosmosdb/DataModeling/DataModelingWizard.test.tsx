/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import type * as FluentComponents from '@fluentui/react-components';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DataModelingEvent } from '../../api/types';
import { DataModelingWizard } from './DataModelingWizard';
import { type ContainerPageProps } from './pages/ContainerPage';
import { type ResultPage } from './pages/ResultPage';
import { type WorkloadPageProps } from './pages/WorkloadPage';

const { client, events } = vi.hoisted(() => {
    const events = { onData: (_event: DataModelingEvent) => {} };
    return {
        events,
        client: {
            dataModeling: {
                requestRecommendation: {
                    mutate: vi.fn<(input: { dataModelJson: string }) => Promise<void>>().mockResolvedValue(undefined),
                },
                events: {
                    subscribe: vi.fn((_input, handlers: typeof events) => {
                        events.onData = handlers.onData;
                        return { unsubscribe: vi.fn() };
                    }),
                },
            },
        },
    };
});

vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));
// jsdom has no layout measurements for Fluent's priority-overflow manager.
vi.mock('@fluentui/react-components', async (importOriginal) => ({
    ...(await importOriginal<typeof FluentComponents>()),
    Overflow: ({ children }: PropsWithChildren) => <>{children}</>,
    OverflowItem: ({ children }: PropsWithChildren) => <>{children}</>,
    OverflowDivider: ({ children }: PropsWithChildren) => <>{children}</>,
    useOverflowMenu: () => ({ isOverflowing: false }),
}));
vi.mock('./pages/WorkloadPage', () => ({
    WorkloadPage: ({ onPickScenario }: WorkloadPageProps) => (
        <button onClick={() => onPickScenario('chat')}>Choose chat</button>
    ),
}));
vi.mock('./pages/ContainerPage', () => ({
    ContainerPage: ({ model, onChange }: ContainerPageProps) => (
        <>
            <div>{JSON.stringify(model.containers)}</div>
            <button
                onClick={() =>
                    onChange({
                        ...model,
                        containers: model.containers.map((container) =>
                            container.id === model.activeContainerId
                                ? {
                                      ...container,
                                      scale: {
                                          ...container.scale,
                                          candidates: container.scale.candidates.map((candidate) => ({
                                              ...candidate,
                                              distinctValues: 1234,
                                          })),
                                      },
                                  }
                                : container,
                        ),
                    })
                }
            >
                Set cardinality
            </button>
        </>
    ),
}));
vi.mock('./pages/ReviewPage', () => ({ ReviewPage: () => <div>Review inputs</div> }));
vi.mock('./pages/ResultPage', () => ({
    ResultPage: ({ recommendation, recommendationStatus }: ComponentProps<typeof ResultPage>) => (
        <div>{recommendation?.summary ?? recommendationStatus}</div>
    ),
}));

function renderWizard() {
    render(
        <FluentProvider theme={webLightTheme}>
            <DataModelingWizard />
        </FluentProvider>,
    );
}

async function completeWizard(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Choose chat' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.click(screen.getByRole('button', { name: 'Set cardinality' }));
    while (screen.queryByRole('button', { name: 'Next' })) {
        await user.click(screen.getByRole('button', { name: 'Next' }));
    }
    await user.click(screen.getByRole('button', { name: 'Get Recommendation' }));
    act(() =>
        events.onData({
            type: 'recommendationReceived',
            recommendation: { summary: 'Saved recommendation', containers: [] },
        }),
    );
    expect(screen.getByText('Saved recommendation')).toBeInTheDocument();
}

describe('Data Modeling wizard revisiting steps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('preserves the recommendation and forward navigation when browsing completed steps', async () => {
        const user = userEvent.setup();
        renderWizard();
        await completeWizard(user);

        await user.click(screen.getByRole('button', { name: 'Review' }));
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Back' }));
        await user.click(screen.getByRole('button', { name: 'Result' }));

        expect(screen.getByText('Saved recommendation')).toBeInTheDocument();
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledTimes(1);
    });

    it.each(['Cancel', 'Escape'])('keeps the result when confirmation is dismissed with %s', async (dismissal) => {
        const user = userEvent.setup();
        renderWizard();
        await completeWizard(user);
        await user.click(screen.getByRole('button', { name: 'Review' }));
        const next = screen.getByRole('button', { name: 'Get Recommendation' });
        await user.click(next);

        const dialog = screen.getByRole('alertdialog', { name: 'Restart from this step?' });
        const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
        expect(cancel).toHaveTextContent('Cancel');
        expect(cancel).toHaveAccessibleName('Cancel');
        await waitFor(() => expect(cancel).toHaveFocus());
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledTimes(1);

        if (dismissal === 'Escape') {
            await user.keyboard('{Escape}');
        } else {
            await user.click(cancel);
        }
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
        await waitFor(() => expect(next).toHaveFocus());
        await user.click(screen.getByRole('button', { name: 'Result' }));
        expect(screen.getByText('Saved recommendation')).toBeInTheDocument();
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledTimes(1);
    });

    it('requests a new recommendation only after confirming from Review', async () => {
        const user = userEvent.setup();
        renderWizard();
        await completeWizard(user);
        await user.click(screen.getByRole('button', { name: 'Review' }));
        await user.click(screen.getByRole('button', { name: 'Get Recommendation' }));

        const yes = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes' });
        expect(yes).toHaveTextContent('Yes');
        expect(yes).toHaveAccessibleName('Yes');
        await user.click(yes);

        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledTimes(2);
        expect(screen.queryByText('Saved recommendation')).not.toBeInTheDocument();
        expect(screen.getByText('waiting')).toBeInTheDocument();
    });

    it.each([
        { step: 'Workload', next: 'Start' },
        { step: /^Container:.*ChatSession$/, next: 'Next' },
    ])('invalidates downstream progress from $step, preserving model inputs', async ({ step, next }) => {
        const user = userEvent.setup();
        renderWizard();
        await completeWizard(user);
        const originalRequest = client.dataModeling.requestRecommendation.mutate.mock.calls[0];
        expect(originalRequest?.[0].dataModelJson).toContain('"distinctValues":1234');

        await user.click(screen.getByRole('button', { name: step }));
        await user.click(screen.getByRole('button', { name: next }));
        await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes' }));

        expect(screen.getByRole('button', { name: 'Review' })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: 'Result' })).toHaveAttribute('aria-disabled', 'true');
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledTimes(1);
        while (screen.queryByRole('button', { name: 'Next' })) {
            await user.click(screen.getByRole('button', { name: 'Next' }));
            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        }
        await user.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        expect(client.dataModeling.requestRecommendation.mutate.mock.calls[1]).toEqual(originalRequest);
        expect(screen.getByText('waiting')).toBeInTheDocument();
    });

    it('clears reached steps on Start Over', async () => {
        const user = userEvent.setup();
        renderWizard();
        await completeWizard(user);
        await user.click(screen.getByRole('button', { name: 'Start Over' }));
        expect(screen.getByRole('button', { name: 'Review' })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: 'Result' })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    });
});
