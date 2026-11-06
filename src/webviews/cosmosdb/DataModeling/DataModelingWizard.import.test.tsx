/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ModelingAdvisorSnapshot } from '../../../dataModeling/modelingAdvisorSchema';
import { createBlankContainer } from './dataModel';
import { DataModelingWizard } from './DataModelingWizard';
import { createInitialSnapshot } from './modelingAdvisorState';
import { type SchemaProperty } from './models';
import { type ContainerPageProps } from './pages/ContainerPage';

const probe = vi.hoisted<{
    update: ContainerPageProps['onChangeData'];
    replay: boolean;
    results: ModelingAdvisorSnapshot[];
}>(() => ({
    update: vi.fn(),
    replay: false,
    results: [],
}));
import type * as ModelingAdvisorStateModule from './modelingAdvisorState';
// Retain the real page and persistence effects while exposing the actual wizard adapter for replay/no-op checks.
import type * as ContainerPageModule from './pages/ContainerPage';

vi.mock('./pages/ContainerPage', async (importOriginal) => {
    const actual = await importOriginal<typeof ContainerPageModule>();
    return {
        ...actual,
        ContainerPage: (props: ContainerPageProps) => {
            probe.update = props.onChangeData;
            return <actual.ContainerPage {...props} />;
        },
    };
});
vi.mock('./modelingAdvisorState', async (importOriginal) => {
    const actual = await importOriginal<typeof ModelingAdvisorStateModule>();
    return {
        ...actual,
        useModelingAdvisorPersistence: (...args: Parameters<typeof actual.useModelingAdvisorPersistence>) => {
            const persistence = actual.useModelingAdvisorPersistence(...args);
            if (!probe.replay) return persistence;
            const setSnapshot: typeof persistence.setSnapshot = (update) => {
                probe.results =
                    typeof update === 'function'
                        ? [update(persistence.snapshot), update(persistence.snapshot)]
                        : [update, update];
                persistence.setSnapshot(update);
            };
            return { ...persistence, setSnapshot };
        },
    };
});

const client = vi.hoisted(() => ({
    dataModeling: {
        confirm: { mutate: vi.fn() },
        loadState: { query: vi.fn() },
        saveState: { mutate: vi.fn() },
        recordTelemetry: { mutate: vi.fn() },
        events: { subscribe: vi.fn() },
    },
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));
vi.mock('../../MonacoEditor', () => ({ MonacoEditor: () => null }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

function savedModel(): ModelingAdvisorSnapshot {
    const saved = createInitialSnapshot();
    const orders = createBlankContainer('Orders');
    orders.scale.candidates[0].distinctValues = 872;
    saved.wizard = {
        ...saved.wizard,
        step: 2,
        scenario: 'other',
        dataModel: { containers: [orders, createBlankContainer('Users')], activeContainerId: orders.id },
    };
    return saved;
}

async function openWizard(saved = savedModel(), strict = false) {
    client.dataModeling.loadState.query.mockResolvedValue(saved);
    const wizard = <DataModelingWizard />;
    const page = render(
        <FluentProvider theme={webLightTheme}>{strict ? <StrictMode>{wizard}</StrictMode> : wizard}</FluentProvider>,
    );
    await screen.findByRole('button', { name: 'Upload JSON' });
    return page;
}

function selectFile(container: HTMLElement) {
    const read = deferred<string>();
    const text = vi.fn(() => read.promise);
    const file = new File([], 'schema.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: text });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    return { ...read, text };
}

function lastSave(): ModelingAdvisorSnapshot {
    return client.dataModeling.saveState.mutate.mock.calls.at(-1)?.[0] as ModelingAdvisorSnapshot;
}

beforeEach(() => {
    vi.clearAllMocks();
    probe.replay = false;
    probe.results = [];
    client.dataModeling.confirm.mutate.mockResolvedValue(true);
    client.dataModeling.saveState.mutate.mockResolvedValue(undefined);
    client.dataModeling.recordTelemetry.mutate.mockResolvedValue(undefined);
    client.dataModeling.events.subscribe.mockReturnValue({ unsubscribe: vi.fn() });
});

describe('committed wizard schema updates', () => {
    it.each([false, true])(
        'replays new candidate identities and preserves cardinalities (StrictMode: %s)',
        async (strict) => {
            probe.replay = true;
            const saved = savedModel();
            const target = saved.wizard.dataModel.containers[1];
            target.scale.candidates[0] = {
                ...target.scale.candidates[0],
                id: 'legacy-candidate',
                distinctValues: 1937,
            };
            const properties: SchemaProperty[] = [
                { id: 'customer-prop', name: 'customerId', type: 'string', role: 'key', pkCandidate: true },
                { id: 'region-prop', name: 'region', type: 'string', role: 'filter', pkCandidate: false },
            ];
            await openWizard(saved, strict);
            await act(async () => {
                probe.update((previous) => ({
                    ...previous,
                    containers: previous.containers.map((container) =>
                        container.id === target.id
                            ? {
                                  ...container,
                                  properties: [...container.properties, ...properties],
                              }
                            : container,
                    ),
                }));
            });
            const [first, replay] = probe.results;
            expect(first).toEqual(replay);
            expect(lastSave()).toEqual(first);
            expect(first.wizard.dataModel.activeContainerId).toBe(saved.wizard.dataModel.activeContainerId);
            expect(first.wizard.dataModel.containers[0]).toBe(saved.wizard.dataModel.containers[0]);
            const candidates = first.wizard.dataModel.containers[1].scale.candidates;
            expect(candidates.slice(0, 3)).toEqual(target.scale.candidates);
            expect(candidates.slice(3).map(({ attribute, distinctValues }) => ({ attribute, distinctValues }))).toEqual(
                [
                    { attribute: 'customerId', distinctValues: 500000 },
                    { attribute: 'region', distinctValues: 1000 },
                ],
            );
            expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(candidates.length);
            expect(target.properties).toHaveLength(3);
            expect(saved.wizard.dataModel.containers[0].scale.candidates[0].distinctValues).toBe(872);
        },
    );

    it('does not autosave a functional no-op after saving the latest edit', async () => {
        await openWizard();
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Average document size' }), { target: { value: '2' } });
        await waitFor(() => expect(client.dataModeling.saveState.mutate).toHaveBeenCalledOnce());
        const latest = lastSave();
        await act(async () => probe.update((previous) => previous));
        expect(client.dataModeling.saveState.mutate).toHaveBeenCalledOnce();
        expect(lastSave()).toBe(latest);
        expect(lastSave().wizard.dataModel.containers[0].document.avgSizeKb).toBe(2);
    });

    it.each([false, undefined])(
        'keeps the latest persisted state without autosaving a cancelled import (%s)',
        async (answer) => {
            const confirmation = deferred<boolean | undefined>();
            client.dataModeling.confirm.mutate.mockReturnValueOnce(confirmation.promise);
            const page = await openWizard();
            const read = selectFile(page.container);
            fireEvent.change(screen.getByRole('spinbutton', { name: 'Average document size' }), {
                target: { value: '2' },
            });
            await waitFor(() => expect(client.dataModeling.saveState.mutate).toHaveBeenCalledOnce());
            const latest = lastSave();
            await act(async () => confirmation.resolve(answer));
            expect(read.text).not.toHaveBeenCalled();
            expect(client.dataModeling.saveState.mutate).toHaveBeenCalledOnce();
            expect(lastSave()).toBe(latest);
            expect(lastSave().wizard.dataModel.containers[0].document.avgSizeKb).toBe(2);
            expect(client.dataModeling.recordTelemetry.mutate).toHaveBeenCalledWith({
                type: 'schemaImport',
                outcome: 'cancelled',
            });
            expect(screen.getByRole('button', { name: 'Upload JSON' })).toHaveFocus();
        },
    );

    it('does not report success when removal and file completion share a React batch', async () => {
        const saved = savedModel();
        const page = await openWizard(saved);
        const read = selectFile(page.container);
        await waitFor(() => expect(read.text).toHaveBeenCalledOnce());
        const removal = deferred<boolean>();
        client.dataModeling.confirm.mutate.mockReturnValueOnce(removal.promise);
        await userEvent.click(screen.getByRole('button', { name: 'Remove from model' }));
        await act(async () => {
            removal.resolve(true);
            read.resolve('{"discarded":true}');
        });
        expect(lastSave().wizard.dataModel.containers).toEqual([saved.wizard.dataModel.containers[1]]);
        expect(client.dataModeling.saveState.mutate).toHaveBeenCalledOnce();
        expect(client.dataModeling.recordTelemetry.mutate).not.toHaveBeenCalledWith({
            type: 'schemaImport',
            outcome: 'success',
        });
        expect(screen.queryByText(/Inferred schema from/)).not.toBeInTheDocument();
    });
});
