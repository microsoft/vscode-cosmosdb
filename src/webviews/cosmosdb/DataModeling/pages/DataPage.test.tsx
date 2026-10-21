/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankContainer, type DataModel, withDerivedCandidates } from '../dataModel';
import { inferSchemaFromJson } from '../jsonInference';
import { DataPage } from './DataPage';

const confirm = vi.hoisted(() => vi.fn());
vi.mock('@microsoft/vscode-ext-webview/react', () => ({
    useTrpcClient: () => ({ dataModeling: { confirm: { mutate: confirm } } }),
}));

beforeEach(() => {
    confirm.mockReset();
});

describe('DataPage partition-key eligibility', () => {
    it('hides imported array fields from the input box and explains their restrictions in Role', async () => {
        confirm.mockResolvedValue(true);
        const container = createBlankContainer('Orders');
        const model: DataModel = { containers: [container], activeContainerId: container.id };
        const onChange = vi.fn<(next: DataModel) => void>();
        const page = render(<DataPage model={model} onChange={onChange} />);
        const text = JSON.stringify([
            { id: 'order-1', items: [{ productId: 'p1' }] },
            { id: 'order-2', items: [{ productId: 'p2' }, { productId: 'p3' }] },
            { id: 'order-3', items: [] },
        ]);
        const file = new File([text], 'orders.json', { type: 'application/json' });
        Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(text) });
        fireEvent.change(page.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
        await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
        const imported = withDerivedCandidates(onChange.mock.lastCall![0]);
        expect(imported.containers[0].partitionKey).toBe('/id');
        expect(imported.containers[0].scale.candidates.map((candidate) => candidate.attribute)).toEqual(['id']);
        page.rerender(<DataPage model={imported} onChange={onChange} />);

        const tags = within(screen.getByRole('textbox', { name: 'Add property…' }).parentElement!);
        expect(tags.getByText('id')).toBeVisible();
        expect(tags.queryByText('items')).not.toBeInTheDocument();
        expect(tags.queryByText('items/productId')).not.toBeInTheDocument();
        const table = within(screen.getByRole('table', { name: 'Schema properties' }));
        const itemsRow = within(table.getByRole('row', { name: /^items array / }));
        const productRow = within(table.getByRole('row', { name: /^items\/productId / }));
        expect(itemsRow.getAllByRole('cell')[2]).toHaveTextContent(
            'Not usable as a partition key: this field has object or array values.',
        );
        expect(productRow.getAllByRole('cell')[2]).toHaveTextContent(
            'Not usable as a partition key: this field is inside an array.',
        );
        for (const row of [itemsRow, productRow]) {
            const roleCell = row.getAllByRole('cell')[2];
            const icon = roleCell.querySelector('svg');
            expect(icon).toBeVisible();
            expect(icon).toHaveAttribute('aria-hidden', 'true');
            expect(icon?.parentElement).toHaveStyle({ color: 'var(--vscode-editorWarning-foreground)' });
            expect(roleCell).toHaveAccessibleName(roleCell.textContent);
        }
        expect(table.queryByRole('combobox', { name: 'Role for items' })).not.toBeInTheDocument();
        expect(table.queryByRole('combobox', { name: 'Role for items/productId' })).not.toBeInTheDocument();
        expect(table.getByRole('combobox', { name: 'Role for id' })).toHaveAccessibleName('Role for id');
        expect(screen.getByRole('button', { name: 'Upload JSON' })).toHaveFocus();

        fireEvent.click(itemsRow.getByRole('button', { name: 'Remove items' }));
        const withoutParent = withDerivedCandidates(onChange.mock.lastCall![0]);
        page.rerender(<DataPage model={withoutParent} onChange={onChange} />);
        expect(withoutParent.containers[0].scale.candidates.map((candidate) => candidate.attribute)).toEqual(['id']);
        expect(tags.queryByText('items/productId')).not.toBeInTheDocument();
        expect(screen.getByText('Not usable as a partition key: this field is inside an array.')).toBeVisible();
    });

    it('keeps nested scalar fields editable while excluding objects and numeric arrays', () => {
        const container = createBlankContainer();
        const schema = inferSchemaFromJson(
            JSON.stringify({ id: '1', customer: { customerId: 'customer-1' }, embedding: [0.1, 0.2] }),
        );
        container.properties = schema.properties.map((property) => ({
            ...property,
            id: property.name,
            type: property.name === 'embedding' ? 'number[]' : property.type,
        }));
        render(<DataPage model={{ containers: [container], activeContainerId: container.id }} onChange={vi.fn()} />);
        const tags = within(screen.getByRole('textbox', { name: 'Add property…' }).parentElement!);
        expect(tags.getByText('customer/customerId')).toBeVisible();
        expect(tags.queryByText('customer')).not.toBeInTheDocument();
        expect(tags.queryByText('embedding')).not.toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Role for customer/customerId' })).toHaveValue('key');
        expect(
            screen.getAllByText('Not usable as a partition key: this field has object or array values.'),
        ).toHaveLength(2);
    });

    it('updates the input tags and role controls when a field type changes', () => {
        const container = createBlankContainer();
        const onChange = vi.fn<(next: DataModel) => void>();
        const page = render(
            <DataPage model={{ containers: [container], activeContainerId: container.id }} onChange={onChange} />,
        );
        const tags = within(screen.getByRole('textbox', { name: 'Add property…' }).parentElement!);
        const typeSelect = screen.getByRole('combobox', { name: 'Type for type' });
        fireEvent.change(typeSelect, { target: { value: 'object' } });
        const withObject = withDerivedCandidates(onChange.mock.lastCall![0]);
        page.rerender(<DataPage model={withObject} onChange={onChange} />);
        expect(tags.queryByText('type')).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: 'Role for type' })).not.toBeInTheDocument();
        expect(withObject.containers[0].scale.candidates.some((candidate) => candidate.attribute === 'type')).toBe(
            false,
        );
        expect(screen.getByText('Not usable as a partition key: this field has object or array values.')).toBeVisible();

        fireEvent.change(typeSelect, { target: { value: 'string' } });
        const withScalar = withDerivedCandidates(onChange.mock.lastCall![0]);
        page.rerender(<DataPage model={withScalar} onChange={onChange} />);
        expect(tags.getByText('type')).toBeVisible();
        expect(screen.getByRole('combobox', { name: 'Role for type' })).toHaveValue('filter');
        expect(withScalar.containers[0].scale.candidates.some((candidate) => candidate.attribute === 'type')).toBe(
            true,
        );
    });
});

describe('DataPage document size limits', () => {
    const fields = [
        { label: 'Average document size', field: 'avgSizeKb' },
        { label: 'Maximum document size', field: 'maxSizeKb' },
    ] as const;

    it.each(fields)('rejects negative $label edits and accepts zero', ({ label, field }) => {
        const container = createBlankContainer();
        container.document.avgSizeKb = field === 'avgSizeKb' ? 1 : 0;
        const model: DataModel = { containers: [container], activeContainerId: container.id };
        const onChange = vi.fn<(next: DataModel) => void>();
        const { rerender } = render(<DataPage model={model} onChange={onChange} />);
        const input = screen.getByRole('spinbutton', { name: label });
        expect(screen.getByText(label)).toBeVisible();
        expect(input).toHaveAccessibleName(label);

        for (const value of ['-1', '-0.01']) {
            fireEvent.change(input, { target: { value } });
            expect(onChange).not.toHaveBeenCalled();
            expect(input).toHaveValue(container.document[field]);
            expect(input).toHaveAttribute('aria-invalid', 'true');
            expect(input).toHaveAccessibleDescription('Document size cannot be negative.');
            expect(screen.getByRole('alert')).toHaveTextContent('Document size cannot be negative.');
        }

        fireEvent.change(input, { target: { value: '0' } });
        expect(onChange).toHaveBeenCalledOnce();
        const next = onChange.mock.lastCall![0];
        expect(next.containers[0].document[field]).toBe(0);
        rerender(<DataPage model={next} onChange={onChange} />);
        expect(input).toHaveValue(0);
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(input).toHaveAttribute('min', '0');
    });

    it.each(fields)('rejects oversized $label edits and accepts the inclusive boundary', ({ label, field }) => {
        const container = createBlankContainer();
        container.document.avgSizeKb = 0;
        container.document.maxSizeKb = field === 'avgSizeKb' ? 2048 : 4;
        const model: DataModel = { containers: [container], activeContainerId: container.id };
        const onChange = vi.fn<(next: DataModel) => void>();
        const { rerender } = render(<DataPage model={model} onChange={onChange} />);
        const input = screen.getByRole('spinbutton', { name: label });
        expect(screen.getByText(label)).toBeVisible();
        expect(input).toHaveAccessibleName(label);
        expect(input).toHaveAttribute('max', '2048');
        expect(input).toHaveAttribute('step', 'any');

        for (const value of ['2048.01', '2049', '49999']) {
            fireEvent.change(input, { target: { value } });
            expect(onChange).not.toHaveBeenCalled();
            expect(input).toHaveValue(container.document[field]);
            expect(input).toHaveAttribute('aria-invalid', 'true');
            expect(input).toHaveAccessibleDescription('Document size cannot exceed 2 MB (2048 KB).');
            expect(screen.getByRole('alert')).toHaveTextContent('Document size cannot exceed 2 MB (2048 KB).');
        }

        for (const value of ['2048', '2047.99', '1.5', '0']) {
            fireEvent.change(input, { target: { value } });
            const next = onChange.mock.lastCall![0];
            expect(next.containers[0].document[field]).toBe(Number(value));
            rerender(<DataPage model={next} onChange={onChange} />);
            expect(input).toHaveValue(Number(value));
            expect(input).not.toHaveAttribute('aria-invalid', 'true');
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        }
    });

    it.each([
        { label: 'Average document size', field: 'avgSizeKb', invalid: '4.01', valid: '4' },
        { label: 'Maximum document size', field: 'maxSizeKb', invalid: '1.99', valid: '2' },
    ] as const)('rejects inconsistent $label edits and allows equality', ({ label, field, invalid, valid }) => {
        const container = createBlankContainer();
        container.document.avgSizeKb = 2;
        container.document.maxSizeKb = 4;
        const model: DataModel = { containers: [container], activeContainerId: container.id };
        const onChange = vi.fn<(next: DataModel) => void>();
        const { rerender } = render(<DataPage model={model} onChange={onChange} />);
        const input = screen.getByRole('spinbutton', { name: label });
        fireEvent.change(input, { target: { value: invalid } });
        expect(onChange).not.toHaveBeenCalled();
        expect(input).toHaveValue(container.document[field]);
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAccessibleDescription('Average document size cannot exceed maximum document size.');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Average document size cannot exceed maximum document size.',
        );

        fireEvent.change(input, { target: { value: valid } });
        const next = onChange.mock.lastCall![0];
        expect(next.containers[0].document[field]).toBe(Number(valid));
        rerender(<DataPage model={next} onChange={onChange} />);
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each([
        { label: 'Average document size', value: '4' },
        { label: 'Maximum document size', value: '8' },
    ])('shows inconsistent saved estimates and allows correcting $label', ({ label, value }) => {
        const container = createBlankContainer();
        container.document.avgSizeKb = 8;
        const model: DataModel = { containers: [container], activeContainerId: container.id };
        const onChange = vi.fn<(next: DataModel) => void>();
        const { rerender } = render(<DataPage model={model} onChange={onChange} />);
        expect(screen.getAllByRole('alert')).toHaveLength(2);
        fireEvent.change(screen.getByRole('spinbutton', { name: label }), { target: { value } });
        const next = onChange.mock.lastCall![0];
        expect(next.containers[0].document.avgSizeKb).toBe(next.containers[0].document.maxSizeKb);
        rerender(<DataPage model={next} onChange={onChange} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps errors independent and clears them when switching containers', () => {
        const first = createBlankContainer('First');
        const second = createBlankContainer('Second');
        const model: DataModel = { containers: [first, second], activeContainerId: first.id };
        const onChange = vi.fn();
        const { rerender } = render(<DataPage model={model} onChange={onChange} />);
        const average = screen.getByRole('spinbutton', { name: 'Average document size' });
        const maximum = screen.getByRole('spinbutton', { name: 'Maximum document size' });
        fireEvent.change(average, { target: { value: '49999' } });
        fireEvent.change(maximum, { target: { value: '49999' } });
        expect(screen.getAllByRole('alert')).toHaveLength(2);
        fireEvent.change(maximum, { target: { value: '2048' } });
        expect(maximum).not.toHaveAttribute('aria-invalid', 'true');
        expect(average).toHaveAttribute('aria-invalid', 'true');
        rerender(<DataPage model={{ ...model, activeContainerId: second.id }} onChange={onChange} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(average).not.toHaveAttribute('aria-invalid', 'true');
    });
});

describe('DataPage property types', () => {
    it('shows three default attributes for a new container and keeps the count editable', () => {
        const container = createBlankContainer();
        const model: DataModel = { containers: [container], activeContainerId: container.id };
        const onChange = vi.fn<(next: DataModel) => void>();
        render(<DataPage model={model} onChange={onChange} />);
        const count = screen.getByRole('spinbutton', { name: 'Total attributes per document' });
        expect(screen.getByText('Total attributes per document')).toBeVisible();
        expect(count).toHaveAccessibleName('Total attributes per document');
        expect(count).toHaveValue(3);
        const table = within(screen.getByRole('table', { name: 'Schema properties' }));
        expect(table.getAllByRole('row')).toHaveLength(4);
        for (const name of ['id', 'type', 'createdAt']) {
            expect(table.getByText(name)).toBeVisible();
        }
        expect(table.getByRole('combobox', { name: 'Type for type' })).toHaveValue('string');
        expect(table.getByRole('combobox', { name: 'Type for createdAt' })).toHaveValue('string (ISO)');
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(count, { target: { value: '7' } });
        expect(onChange.mock.calls[0][0].containers[0].document.attributeCount).toBe(7);
    });

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
    it('rejects oversized imported documents with an accessible size error and no model changes', async () => {
        confirm.mockResolvedValue(true);
        const container = createBlankContainer();
        const onChange = vi.fn();
        const onTelemetry = vi.fn();
        const page = render(
            <DataPage
                model={{ containers: [container], activeContainerId: container.id }}
                onChange={onChange}
                onTelemetry={onTelemetry}
            />,
        );
        const text = JSON.stringify({ payload: 'x'.repeat(2 * 1024 * 1024) });
        const file = new File([text], 'oversized.json', { type: 'application/json' });
        Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(text) });
        fireEvent.change(page.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent('Document size cannot exceed 2 MB (2048 KB).'),
        );
        expect(onChange).not.toHaveBeenCalled();
        expect(onTelemetry).toHaveBeenCalledExactlyOnceWith({ type: 'schemaImport', outcome: 'error' });
        expect(screen.getByRole('button', { name: 'Upload JSON' })).toHaveFocus();
    });

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
