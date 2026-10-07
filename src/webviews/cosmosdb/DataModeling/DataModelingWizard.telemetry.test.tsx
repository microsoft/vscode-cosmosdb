/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import type * as WebviewComponents from '@microsoft/vscode-ext-webview-fluentui/components';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Children, isValidElement, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { type ModelingTelemetryEvent } from '../../../dataModeling/modelingTelemetrySchema';
import { DataModelingWizard } from './DataModelingWizard';
import { getScenarioList } from './scenarios';

const client = vi.hoisted(() => ({
    dataModeling: {
        loadState: { query: vi.fn().mockResolvedValue(null) },
        saveState: { mutate: vi.fn().mockResolvedValue(undefined) },
        recordTelemetry: { mutate: vi.fn().mockResolvedValue(undefined) },
        requestRecommendation: { mutate: vi.fn() },
        events: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
    },
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));
vi.mock('../../MonacoEditor', () => ({ MonacoEditor: () => null }));

// Navigation layout is covered separately; changing workloads here must not depend on jsdom overflow measurements.
vi.mock('@microsoft/vscode-ext-webview-fluentui/components', async (importOriginal) => ({
    ...(await importOriginal<typeof WebviewComponents>()),
    Wizard: ({ activeStep, children, footer }: { activeStep: string; children: ReactNode; footer: ReactNode }) => (
        <div>
            {Children.toArray(children).filter(
                (child) => isValidElement<{ value: string }>(child) && child.props.value === activeStep,
            )}
            {footer}
        </div>
    ),
    WizardStep: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ContainerFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

it('records workload choices before Start, for mouse and keyboard, without filter text', async () => {
    const user = userEvent.setup();
    render(
        <FluentProvider theme={webLightTheme}>
            <DataModelingWizard />
        </FluentProvider>,
    );
    await screen.findByRole('button', { name: 'Start' });
    const selections = () =>
        client.dataModeling.recordTelemetry.mutate.mock.calls
            .map(([event]) => event as ModelingTelemetryEvent)
            .filter((event) => event.type === 'scenarioSelected');
    expect(selections()).toEqual([]);
    const filter = screen.getByPlaceholderText('Filter scenarios…');
    await user.type(filter, 'private workload filter');
    await user.clear(filter);
    const workloads = getScenarioList();
    const chat = workloads.find((scenario) => scenario.id === 'chat')!;
    const iot = workloads.find((scenario) => scenario.id === 'iot')!;
    await user.click(screen.getByRole('radio', { name: chat.title }));
    screen.getByRole('radio', { name: iot.title }).focus();
    await user.keyboard('{Enter}{Enter}');
    expect(selections()).toEqual([
        { type: 'scenarioSelected', scenario: 'chat' },
        { type: 'scenarioSelected', scenario: 'iot' },
        { type: 'scenarioSelected', scenario: 'iot' },
    ]);
    expect(client.dataModeling.saveState.mutate).toHaveBeenLastCalledWith(
        expect.objectContaining({ wizard: expect.objectContaining({ scenario: 'iot' }) }),
    );
    expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
    expect(JSON.stringify(client.dataModeling.recordTelemetry.mutate.mock.calls)).not.toContain(
        'private workload filter',
    );
});
