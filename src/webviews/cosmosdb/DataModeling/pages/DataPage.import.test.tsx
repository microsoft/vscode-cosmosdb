/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankContainer, type DataModel } from '../dataModel';
import { ContainerPage, type ContainerPageProps } from './ContainerPage';

const confirm = vi.hoisted(() => vi.fn());
vi.mock('@microsoft/vscode-ext-webview/react', () => ({
    useTrpcClient: () => ({ dataModeling: { confirm: { mutate: confirm } } }),
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

function Harness({
    onChange = vi.fn(),
    batchRename = false,
    onTelemetry,
    onEdited,
}: {
    onChange?: () => void;
    batchRename?: boolean;
    onTelemetry?: ContainerPageProps['onTelemetry'];
    onEdited?: ContainerPageProps['onEdited'];
}) {
    const [model, setModel] = useState<DataModel>(() => {
        const containers = [createBlankContainer('Orders'), createBlankContainer('Users')];
        return { containers, activeContainerId: containers[0].id };
    });
    return (
        <>
            <button
                onClick={() => setModel((previous) => ({ ...previous, activeContainerId: previous.containers[1].id }))}
            >
                Switch
            </button>
            <button
                onClick={() => setModel((previous) => ({ ...previous, activeContainerId: previous.containers[0].id }))}
            >
                Back
            </button>
            <button onClick={() => setModel((previous) => ({ ...previous, containers: previous.containers.slice(1) }))}>
                Remove
            </button>
            <button onClick={() => setModel({ containers: [createBlankContainer('Replacement')] })}>Reset</button>
            <output data-testid="model">{JSON.stringify(model)}</output>
            <div
                onClickCapture={
                    batchRename
                        ? () =>
                              setModel((previous) => ({
                                  ...previous,
                                  containers: previous.containers.map((c, index) =>
                                      index === 0 ? { ...c, entity: 'LatestOrders' } : c,
                                  ),
                              }))
                        : undefined
                }
            >
                <ContainerPage
                    model={model}
                    tab="data"
                    onTabChange={vi.fn()}
                    onChange={setModel}
                    onTelemetry={onTelemetry}
                    onEdited={onEdited}
                    onChangeData={(update) => {
                        onChange();
                        setModel(update);
                    }}
                />
            </div>
        </>
    );
}

function model(): DataModel {
    return JSON.parse(screen.getByTestId('model').textContent) as DataModel;
}

function selectFile(container: HTMLElement, name = 'sample.json') {
    const read = deferred<string>();
    const file = new File([], name, { type: 'application/json' });
    const text = vi.fn(() => read.promise);
    Object.defineProperty(file, 'text', { value: text });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    return { ...read, text };
}

beforeEach(() => {
    confirm.mockReset().mockResolvedValue(true);
});

describe('schema import concurrency', () => {
    it('reports a committed import and data edit once under StrictMode', async () => {
        const onTelemetry = vi.fn();
        const onEdited = vi.fn();
        const page = render(
            <StrictMode>
                <Harness onTelemetry={onTelemetry} onEdited={onEdited} />
            </StrictMode>,
        );
        const read = selectFile(page.container);
        await waitFor(() => expect(read.text).toHaveBeenCalledOnce());
        await act(async () => read.resolve('{"imported":true}'));
        expect(model().containers[0].properties.map((p) => p.name)).toEqual(['imported']);
        expect(onTelemetry).toHaveBeenCalledExactlyOnceWith({ type: 'schemaImport', outcome: 'success' });
        expect(onEdited).toHaveBeenCalledExactlyOnceWith('data');
        expect(screen.getByText(/Inferred schema from sample.json/)).toBeVisible();
        expect(screen.getByRole('button', { name: 'Upload JSON' })).toHaveFocus();
    });

    it('does not report an import or data edit discarded by a batched removal', async () => {
        const onTelemetry = vi.fn();
        const onEdited = vi.fn();
        const page = render(<Harness onTelemetry={onTelemetry} onEdited={onEdited} />);
        const before = model();
        const read = selectFile(page.container);
        await waitFor(() => expect(read.text).toHaveBeenCalledOnce());
        await act(async () => {
            fireEvent.click(screen.getByText('Remove'));
            read.resolve('{"discarded":true}');
        });
        expect(model().containers).toEqual([before.containers[1]]);
        expect(onTelemetry).not.toHaveBeenCalled();
        expect(onEdited).not.toHaveBeenCalled();
        expect(screen.queryByText(/Inferred schema from/)).not.toBeInTheDocument();
    });

    it('keeps the original target through confirmation and reading without moving selection or feedback', async () => {
        const answer = deferred<boolean>();
        confirm.mockReturnValueOnce(answer.promise);
        const page = render(<Harness />);
        const before = model();
        const read = selectFile(page.container);
        expect(confirm.mock.calls[0][0].detail).toContain('“Orders”');
        await userEvent.click(screen.getByText('Switch'));
        await act(async () => answer.resolve(true));
        await act(async () => read.resolve('{"id":"1","amount":5}'));
        const after = model();
        expect(after.activeContainerId).toBe(before.containers[1].id);
        expect(after.containers[0].properties.map((p) => p.name)).toEqual(['id', 'amount']);
        expect(after.containers[1]).toEqual(before.containers[1]);
        expect(screen.queryByText(/Inferred schema from/)).not.toBeInTheDocument();
        expect(screen.getByText('Switch')).toHaveFocus();
        fireEvent.click(screen.getByText('Back'));
        expect(screen.getByRole('row', { name: /^amount / })).toBeVisible();
    });

    it('keeps a pending confirmation error associated with its original target when another upload is selected', async () => {
        const answer = deferred<boolean>();
        confirm.mockReturnValueOnce(answer.promise);
        const page = render(<Harness />);
        selectFile(page.container, 'orders.json');
        await userEvent.click(screen.getByText('Switch'));
        const second = selectFile(page.container, 'users.json');
        await act(async () => answer.reject(new Error('dialog failed')));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(confirm).toHaveBeenCalledOnce();
        expect(second.text).not.toHaveBeenCalled();
    });

    it('composes synchronous batched parent and field edits through the parent adapter', () => {
        render(
            <StrictMode>
                <Harness batchRename />
            </StrictMode>,
        );
        // The parent capture handler queues a rename before the DataPage click handler queues its edit.
        fireEvent.click(screen.getAllByRole('button', { name: 'Remove type' })[0]);
        expect(model().containers[0].entity).toBe('LatestOrders');
        expect(model().containers[0].properties.map((p) => p.name)).not.toContain('type');
        expect(screen.queryByRole('row', { name: /^type / })).not.toBeInTheDocument();
    });

    it.each(['Remove', 'Reset'])('does not restore the target after %s', async (action) => {
        const page = render(<Harness />);
        const read = selectFile(page.container);
        await waitFor(() => expect(read.text).toHaveBeenCalledOnce());
        fireEvent.click(screen.getByText(action));
        const afterRemoval = model();
        await act(async () => read.resolve('{"imported":true}'));
        expect(model()).toEqual(afterRemoval);
        expect(screen.queryByText(/Inferred schema from/)).not.toBeInTheDocument();
    });

    it.each(['confirmation', 'read'])('ignores completion after unmount during %s', async (phase) => {
        const answer = deferred<boolean>();
        if (phase === 'confirmation') confirm.mockReturnValueOnce(answer.promise);
        const onChange = vi.fn();
        const onTelemetry = vi.fn();
        const page = render(<Harness onChange={onChange} onTelemetry={onTelemetry} />);
        const read = selectFile(page.container);
        await waitFor(() => expect(read.text).toHaveBeenCalledTimes(phase === 'read' ? 1 : 0));
        page.unmount();
        await act(async () => {
            answer.resolve(true);
            read.resolve('{"imported":true}');
        });
        expect(onChange).not.toHaveBeenCalled();
        expect(onTelemetry).not.toHaveBeenCalled();
        expect(read.text).toHaveBeenCalledTimes(phase === 'read' ? 1 : 0);
    });

    it.each(['success', 'invalid', 'read error'])(
        'ignores an older %s after a newer import completes',
        async (outcome) => {
            const onTelemetry = vi.fn();
            const page = render(<Harness onTelemetry={onTelemetry} />);
            const old = selectFile(page.container, 'old.json');
            await waitFor(() => expect(old.text).toHaveBeenCalledOnce());
            const current = selectFile(page.container, 'current.json');
            await waitFor(() => expect(current.text).toHaveBeenCalledOnce());
            await act(async () => current.resolve('{"newest":true}'));
            const afterCurrent = model();
            await act(async () => {
                if (outcome === 'read error') old.reject(new Error('read failed'));
                else old.resolve(outcome === 'invalid' ? 'invalid' : '{"older":true}');
            });
            expect(model()).toEqual(afterCurrent);
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.getByRole('row', { name: /^newest / })).toBeVisible();
            expect(screen.getByText(/Inferred schema from current.json/)).toBeVisible();
            expect(screen.queryByText(/old.json/)).not.toBeInTheDocument();
            expect(onTelemetry).toHaveBeenCalledExactlyOnceWith({ type: 'schemaImport', outcome: 'success' });
        },
    );

    it.each(['invalid JSON', 'confirmation error'])('does not show a late %s on another container', async (outcome) => {
        const answer = deferred<boolean>();
        if (outcome === 'confirmation error') confirm.mockReturnValueOnce(answer.promise);
        const page = render(<Harness />);
        const read = selectFile(page.container);
        await waitFor(() => expect(read.text).toHaveBeenCalledTimes(outcome === 'invalid JSON' ? 1 : 0));
        await userEvent.click(screen.getByText('Switch'));
        const afterSwitch = model();
        await act(async () => {
            if (outcome === 'confirmation error') answer.reject(new Error('dialog failed'));
            else read.resolve('invalid');
        });
        expect(model()).toEqual(afterSwitch);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByText('Switch')).toHaveFocus();
    });
});
