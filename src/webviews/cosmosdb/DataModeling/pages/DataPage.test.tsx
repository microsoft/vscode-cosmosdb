/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankContainer, type DataModel } from '../dataModel';
import { DataPage } from './DataPage';

const confirm = vi.hoisted(() => vi.fn());
vi.mock('@microsoft/vscode-ext-webview/react', () => ({
    useTrpcClient: () => ({ dataModeling: { confirm: { mutate: confirm } } }),
}));

beforeEach(() => {
    confirm.mockReset();
});

describe('DataPage property types', () => {
    it('displays the descriptive date/time label and preserves the stored type when editing', async () => {
        const user = userEvent.setup();
        const container = createBlankContainer();
        container.properties = [
            { id: 'created-at', name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
        ];
        const model: DataModel = { containers: [container], activeContainerId: container.id };
        const onChange = vi.fn<(next: DataModel) => void>();
        const { rerender } = render(<DataPage model={model} onChange={onChange} />);
        const typeSelect = screen.getByRole('combobox', { name: 'Type for createdAt' });
        const dateOption = within(typeSelect).getByRole('option', { name: 'Date/time (ISO 8601 string)' });
        expect(dateOption).toHaveTextContent('Date/time (ISO 8601 string)');
        expect(dateOption).toHaveAccessibleName('Date/time (ISO 8601 string)');
        expect(dateOption).toHaveValue('string (ISO)');
        expect(typeSelect).toHaveValue('string (ISO)');
        expect(within(typeSelect).queryByRole('option', { name: 'string (ISO)' })).not.toBeInTheDocument();
        expect(within(typeSelect).getByRole('option', { name: 'string' })).toHaveValue('string');
        expect(onChange).not.toHaveBeenCalled();

        await user.selectOptions(typeSelect, 'string');
        const plainModel = onChange.mock.calls[0][0];
        expect(plainModel.containers[0].properties[0].type).toBe('string');
        rerender(<DataPage model={plainModel} onChange={onChange} />);
        expect(typeSelect).toHaveValue('string');

        await user.selectOptions(typeSelect, 'Date/time (ISO 8601 string)');
        const dateModel = onChange.mock.calls[1][0];
        expect(dateModel.containers[0].properties[0].type).toBe('string (ISO)');
        rerender(<DataPage model={dateModel} onChange={onChange} />);
        expect(typeSelect).toHaveValue('string (ISO)');
    });
});

describe('DataPage native schema confirmation', () => {
    it.each([true, false, undefined])('replaces the schema only on Yes (response: %s)', async (response) => {
        let answer!: (result: boolean | undefined) => void;
        confirm.mockImplementation(
            () =>
                new Promise<boolean | undefined>((resolve) => {
                    answer = resolve;
                }),
        );
        const container = createBlankContainer('Orders');
        const model: DataModel = { containers: [container], activeContainerId: container.id };
        const onChange = vi.fn<(next: DataModel) => void>();
        const onTelemetry = vi.fn();
        const page = render(<DataPage model={model} onChange={onChange} onTelemetry={onTelemetry} />);
        const file = new File(['{"id":"1","amount":5}'], 'orders.json', { type: 'application/json' });
        const readFile = vi.fn().mockResolvedValue('{"id":"1","amount":5}');
        Object.defineProperty(file, 'text', { value: readFile });

        fireEvent.change(page.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
        expect(confirm).toHaveBeenCalledWith({
            message: 'Replace schema?',
            detail: 'Replace the properties of “Orders” with the schema inferred from orders.json?',
        });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(readFile).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        await act(async () => answer(response));

        expect(readFile).toHaveBeenCalledTimes(response === true ? 1 : 0);
        expect(onChange).toHaveBeenCalledTimes(response === true ? 1 : 0);
        expect(onChange.mock.calls[0]?.[0].containers[0].properties.map((p) => p.name)).toEqual(
            response === true ? ['id', 'amount'] : undefined,
        );
        expect(screen.getByRole('button', { name: 'Upload JSON' })).toHaveFocus();
        expect(onTelemetry).toHaveBeenCalledExactlyOnceWith({
            type: 'schemaImport',
            outcome: response === true ? 'success' : 'cancelled',
        });
        expect(JSON.stringify(onTelemetry.mock.calls)).not.toContain('orders.json');
    });

    it('reports confirmation failures and leaves the schema unchanged', async () => {
        confirm.mockRejectedValue(new Error('Host disconnected'));
        const container = createBlankContainer('Orders');
        const onChange = vi.fn();
        const page = render(
            <DataPage model={{ containers: [container], activeContainerId: container.id }} onChange={onChange} />,
        );
        fireEvent.change(page.container.querySelector('input[type="file"]')!, {
            target: { files: [new File(['{}'], 'orders.json', { type: 'application/json' })] },
        });
        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent('Could not open the confirmation dialog.'),
        );
        expect(onChange).not.toHaveBeenCalled();
    });

    it('records an upload activation and a parse failure without file names or JSON contents', async () => {
        confirm.mockResolvedValue(true);
        const container = createBlankContainer('Private entity');
        const onTelemetry = vi.fn();
        const onChange = vi.fn();
        const page = render(
            <DataPage
                model={{ containers: [container], activeContainerId: container.id }}
                onChange={onChange}
                onTelemetry={onTelemetry}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Upload JSON' }));
        expect(onTelemetry).toHaveBeenCalledWith({ type: 'control', control: 'schemaUpload' });
        const file = new File(['private-invalid-json'], 'private-file.json');
        Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('private-invalid-json') });
        fireEvent.change(page.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
        await waitFor(() => expect(onTelemetry).toHaveBeenCalledWith({ type: 'schemaImport', outcome: 'error' }));
        expect(onChange).not.toHaveBeenCalled();
        expect(JSON.stringify(onTelemetry.mock.calls)).not.toContain('private');
    });

    it('records a cancelled native file picker without applying a schema', () => {
        const container = createBlankContainer();
        const onTelemetry = vi.fn();
        const onChange = vi.fn();
        const page = render(
            <DataPage
                model={{ containers: [container], activeContainerId: container.id }}
                onChange={onChange}
                onTelemetry={onTelemetry}
            />,
        );
        fireEvent(page.container.querySelector('input[type="file"]')!, new Event('cancel'));
        expect(onTelemetry).toHaveBeenCalledExactlyOnceWith({ type: 'schemaImport', outcome: 'cancelled' });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('records only successful new fields, not typing, empty submissions or duplicates', async () => {
        const container = createBlankContainer();
        const onTelemetry = vi.fn();
        render(
            <DataPage
                model={{ containers: [container], activeContainerId: container.id }}
                onChange={vi.fn()}
                onTelemetry={onTelemetry}
            />,
        );
        const user = userEvent.setup();
        const input = screen.getByPlaceholderText('Add property…');
        await user.type(input, 'id{Enter}   {Enter}');
        expect(onTelemetry).not.toHaveBeenCalled();
        await user.type(input, 'privateNewField');
        expect(onTelemetry).not.toHaveBeenCalled();
        await user.keyboard('{Enter}');
        expect(onTelemetry).toHaveBeenCalledExactlyOnceWith({ type: 'fieldAdded' });
    });
});
