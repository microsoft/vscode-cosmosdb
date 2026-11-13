/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankContainer, type DataModel, withDerivedCandidates } from '../dataModel';
import { inferSchemaFromJson } from '../jsonInference';
import { ContainerPage, type ContainerPageProps } from './ContainerPage';
import { DataPage as StatefulDataPage, type DataPageProps } from './DataPage';

// These field-level tests inspect each emitted model. Import race tests exercise React state and the parent adapters.
function DataPage({
    model,
    onChange,
    ...props
}: Omit<DataPageProps, 'onChange'> & { onChange: (next: DataModel) => void }) {
    return (
        <StatefulDataPage
            {...props}
            model={model}
            onChange={(update) => onChange(typeof update === 'function' ? update(model) : update)}
        />
    );
}

function LiveDataPage({ initialModel }: { initialModel: DataModel }) {
    const [model, setModel] = useState(initialModel);
    return <StatefulDataPage model={model} onChange={setModel} />;
}

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
            // The remove button shares the cell, so browsers may append its label to the cell's computed name.
            const warning = roleCell.textContent ?? '';
            expect(warning).toMatch(/^Not usable as a partition key: /);
            expect(roleCell).toHaveAccessibleName(expect.stringContaining(warning));
            expect(within(roleCell).getByRole('button', { name: /^Remove items/ })).toBeVisible();
        }
        expect(table.queryByRole('combobox', { name: 'Role for items' })).not.toBeInTheDocument();
        expect(table.queryByRole('combobox', { name: 'Role for items/productId' })).not.toBeInTheDocument();
        expect(table.getByRole('combobox', { name: 'Role for id: 🔑 Unique / business key' })).toHaveAccessibleName(
            'Role for id: 🔑 Unique / business key',
        );
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
        expect(
            screen.getByRole('combobox', { name: 'Role for customer/customerId: 🔑 Unique / business key' }),
        ).toHaveTextContent('🔑 Unique / business key');
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
        expect(screen.getByRole('combobox', { name: 'Role for type: 🔎 Query filter' })).toHaveTextContent(
            '🔎 Query filter',
        );
        expect(withScalar.containers[0].scale.candidates.some((candidate) => candidate.attribute === 'type')).toBe(
            true,
        );
    });
});

describe('DataPage role descriptions', () => {
    it('explains each option and preserves role selection by mouse and keyboard', async () => {
        const user = userEvent.setup();
        const container = createBlankContainer();
        const onChange = vi.fn<(next: DataModel) => void>();
        const page = render(
            <DataPage model={{ containers: [container], activeContainerId: container.id }} onChange={onChange} />,
        );
        const dropdown = screen.getByRole('combobox', { name: 'Role for id: 🔑 Unique / business key' });
        expect(dropdown).toHaveTextContent('🔑 Unique / business key');
        for (const roleDropdown of screen.getAllByRole('combobox', { name: /^Role for / })) {
            // Fluent applies className to the documented .fui-Dropdown root; the inner button fills it at 100%.
            const roleDropdownStyle = getComputedStyle(roleDropdown.closest('.fui-Dropdown')!);
            expect(roleDropdownStyle.width).toBe('260px');
            expect(roleDropdownStyle.minWidth).toBe('260px');

            const cell = roleDropdown.closest('td');
            expect(cell).not.toBeNull();

            const remove = within(cell!).getByRole('button', { name: /^Remove / });

            // Ensure the remove control is in the same cell and follows the dropdown in DOM order,
            // without relying on specific parent/child nesting or adjacency wrappers.
            expect(remove.closest('td')).toBe(cell);
            expect(roleDropdown.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        await user.click(dropdown);

        expect(screen.getByRole('listbox')).toHaveStyle({ width: 'max-content' });
        expect(getComputedStyle(screen.getByRole('listbox')).maxWidth).toBe(`${window.innerWidth - 32}px`);
        for (const [label, description] of [
            [
                '🔑 Unique / business key',
                'Choose for a field that identifies a document or business entity, such as an order ID.',
            ],
            ['🔎 Query filter', 'Choose for a field used to filter queries, such as a category or status.'],
            [
                '📄 Payload / other',
                'Choose for a field stored in the document but not used to identify it or filter queries.',
            ],
        ]) {
            const option = screen.getByRole('option', { name: label });
            expect(option).toHaveAccessibleName(label);
            expect(option).toHaveAccessibleDescription(description);
            expect(option).toHaveStyle({
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr)',
                textAlign: 'left',
                whiteSpace: 'normal',
            });
            const [icon, ...titleWords] = label.split(' ');
            expect(within(option).getByText(icon)).toBeVisible();
            const heading = within(option).getByText(titleWords.join(' '));
            expect(heading).toBeVisible();
            expect(heading).toHaveStyle({ whiteSpace: 'nowrap', gridColumn: '2' });
            expect(option.querySelector('svg')).not.toBeInTheDocument();
            const descriptionText = within(option).getByText(description);
            expect(descriptionText).toBeVisible();
            // The description starts in the title column, so it lines up with the title text after the icon.
            expect(descriptionText).toHaveStyle({ gridColumn: '2' });
            expect(heading.parentElement).toBe(option);
            expect(descriptionText.parentElement).toBe(option);
        }
        // jsdom drops the SelectedItem system colour, so verify the generated rule and that it keys off aria-selected.
        const roleMenu = () => within(screen.getByRole('listbox'));
        const selectedRule = Array.from(document.styleSheets)
            .flatMap((sheet) => Array.from(sheet.cssRules))
            .find((rule) => rule.cssText.includes('[aria-selected="true"]') && /SelectedItem\b/i.test(rule.cssText));
        expect(selectedRule).toBeDefined();
        const selectedClass = selectedRule!.cssText.match(/^\.([\w-]+)\[aria-selected/)![1];
        for (const option of roleMenu().getAllByRole('option')) {
            expect(option).toHaveClass(selectedClass);
        }
        expect(roleMenu().getByRole('option', { selected: true })).toHaveAccessibleName('🔑 Unique / business key');

        await user.click(screen.getByRole('option', { name: '🔎 Query filter' }));
        const filtered = onChange.mock.lastCall![0];
        expect(filtered.containers[0].properties.find((property) => property.name === 'id')?.role).toBe('filter');
        page.rerender(<DataPage model={filtered} onChange={onChange} />);
        expect(dropdown).toHaveTextContent('🔎 Query filter');
        expect(dropdown).toHaveAccessibleName('Role for id: 🔎 Query filter');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

        dropdown.focus();
        await user.keyboard('{ArrowDown}{ArrowDown}');
        // Arrow keys move the active option (focus ring); aria-selected, and so the blue highlight, changes on commit.
        const payloadOption = roleMenu().getByRole('option', { name: '📄 Payload / other' });
        expect(dropdown).toHaveAttribute('aria-activedescendant', payloadOption.id);
        expect(payloadOption).toHaveAttribute('aria-selected', 'false');
        expect(roleMenu().getByRole('option', { name: '🔎 Query filter' })).toHaveAttribute('aria-selected', 'true');
        expect(onChange.mock.lastCall![0]).toBe(filtered);
        await user.keyboard('{Enter}');
        const payload = onChange.mock.lastCall![0];
        expect(payload.containers[0].properties.find((property) => property.name === 'id')?.role).toBe('payload');
        page.rerender(<DataPage model={payload} onChange={onChange} />);
        expect(dropdown).toHaveTextContent('📄 Payload / other');
        expect(dropdown).toHaveAccessibleName('Role for id: 📄 Payload / other');
        expect(dropdown).toHaveFocus();
    });

    it('does not size the role menu to the closed control width', async () => {
        const user = userEvent.setup();
        const container = createBlankContainer();
        render(<DataPage model={{ containers: [container], activeContainerId: container.id }} onChange={vi.fn()} />);
        const dropdown = screen.getByRole('combobox', { name: 'Role for id: 🔑 Unique / business key' });
        // jsdom has no layout; give the trigger a width so Fluent's matchTargetSize middleware would act if enabled.
        const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            const width = this === dropdown || this === dropdown.parentElement ? 260 : 0;
            return DOMRect.fromRect({ width, height: width ? 32 : 0 });
        });
        try {
            await user.click(dropdown);
            const listbox = screen.getByRole('listbox');
            await waitFor(() => expect(listbox.style.position).not.toBe(''));
            expect(listbox.style.getPropertyValue('--fui-match-target-size')).toBe('');
            expect(listbox.style.width).toBe('');
        } finally {
            rect.mockRestore();
        }
    });
});

describe('DataPage document size limits', () => {
    const fields = [
        { label: 'Average document size', field: 'avgSizeKb' },
        { label: 'Maximum document size', field: 'maxSizeKb' },
    ] as const;

    it.each(fields)('retains negative $label edits with an error and accepts zero', ({ label, field }) => {
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
            const next = onChange.mock.lastCall![0];
            expect(next.containers[0].document[field]).toBe(Number(value));
            rerender(<DataPage model={next} onChange={onChange} />);
            expect(input).toHaveValue(Number(value));
            expect(input).toHaveAttribute('aria-invalid', 'true');
            expect(input).toHaveAccessibleDescription('Document size cannot be negative.');
            expect(screen.getByRole('alert')).toHaveTextContent('Document size cannot be negative.');
        }

        fireEvent.change(input, { target: { value: '0' } });
        const next = onChange.mock.lastCall![0];
        expect(next.containers[0].document[field]).toBe(0);
        rerender(<DataPage model={next} onChange={onChange} />);
        expect(input).toHaveValue(0);
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(input).toHaveAttribute('min', '0');
    });

    it.each(fields)(
        'retains oversized $label edits with an error and accepts the inclusive boundary',
        ({ label, field }) => {
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
                const next = onChange.mock.lastCall![0];
                expect(next.containers[0].document[field]).toBe(Number(value));
                rerender(<DataPage model={next} onChange={onChange} />);
                expect(input).toHaveValue(Number(value));
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
        },
    );

    it.each([
        { label: 'Average document size', field: 'avgSizeKb', invalid: '4.01', valid: '4' },
        { label: 'Maximum document size', field: 'maxSizeKb', invalid: '1.99', valid: '2' },
    ] as const)('retains inconsistent $label edits and allows equality', ({ label, field, invalid, valid }) => {
        const container = createBlankContainer();
        container.document.avgSizeKb = 2;
        container.document.maxSizeKb = 4;
        const model: DataModel = { containers: [container], activeContainerId: container.id };
        const onChange = vi.fn<(next: DataModel) => void>();
        const { rerender } = render(<DataPage model={model} onChange={onChange} />);
        const input = screen.getByRole('spinbutton', { name: label });
        fireEvent.change(input, { target: { value: invalid } });
        expect(onChange.mock.lastCall![0].containers[0].document[field]).toBe(Number(invalid));
        rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        expect(input).toHaveValue(Number(invalid));
        const average = screen.getByRole('spinbutton', { name: 'Average document size' });
        expect(average).toHaveAttribute('aria-invalid', 'true');
        expect(average).toHaveAccessibleDescription('Average document size cannot exceed maximum document size.');
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
        expect(screen.getAllByRole('alert')).toHaveLength(1);
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
        rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        fireEvent.change(maximum, { target: { value: '49999' } });
        rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        expect(screen.getAllByRole('alert')).toHaveLength(2);
        fireEvent.change(maximum, { target: { value: '2048' } });
        rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        expect(maximum).not.toHaveAttribute('aria-invalid', 'true');
        expect(average).toHaveAttribute('aria-invalid', 'true');
        rerender(<DataPage model={{ ...model, activeContainerId: second.id }} onChange={onChange} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(average).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('clears the average error immediately when the maximum is raised, without replacing the average', () => {
        const container = createBlankContainer();
        render(<LiveDataPage initialModel={{ containers: [container], activeContainerId: container.id }} />);
        const average = screen.getByRole('spinbutton', { name: 'Average document size' });
        const maximum = screen.getByRole('spinbutton', { name: 'Maximum document size' });
        fireEvent.change(average, { target: { value: '5' } });
        expect(average).toHaveValue(5);
        const error = screen.getByRole('alert');
        expect(error).toHaveTextContent('Average document size cannot exceed maximum document size.');
        expect(
            getComputedStyle(error)
                .gridColumn.split('/')
                .map((part) => part.trim()),
        ).toEqual(['1', '-1']);
        expect(getComputedStyle(error.parentElement!).gridTemplateColumns).toBe('subgrid');

        fireEvent.change(maximum, { target: { value: '6' } });
        expect(average).toHaveValue(5);
        expect(maximum).toHaveValue(6);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(average).not.toHaveAttribute('aria-invalid', 'true');
        fireEvent.change(maximum, { target: { value: '4' } });
        expect(screen.getByRole('alert')).toBeVisible();
        fireEvent.change(average, { target: { value: '3' } });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
        expect(onTelemetry.mock.calls.map(([event]) => event)).toEqual(
            response === true ? [] : [{ type: 'schemaImport', outcome: 'cancelled' }],
        );
        // A callback alone is not an accepted import: the parent must commit the emitted model.
        page.rerender(
            <DataPage model={onChange.mock.calls[0]?.[0] ?? model} onChange={onChange} onTelemetry={onTelemetry} />,
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

describe('DataPage count limits', () => {
    function arraysModel(): DataModel {
        const container = createBlankContainer();
        container.arrays = { hasArrays: true, avgItems: 10, maxItems: 100, updatePattern: 'none' };
        return { containers: [container], activeContainerId: container.id };
    }

    it.each([
        { label: 'Total attributes per document', invalid: '10001', valid: '10000', field: 'attributeCount' },
        { label: 'Maximum items per array', invalid: '100001', valid: '100000', field: 'maxItems' },
        { label: 'Maximum items per array', invalid: '20.5', valid: '20', field: 'maxItems' },
        { label: 'Average items per array', invalid: '-1', valid: '2.5', field: 'avgItems' },
    ] as const)('retains $invalid for $label with an error and accepts $valid', ({ label, invalid, valid, field }) => {
        const onChange = vi.fn<(next: DataModel) => void>();
        const page = render(<DataPage model={arraysModel()} onChange={onChange} />);
        const input = screen.getByRole('spinbutton', { name: label });
        fireEvent.change(input, { target: { value: invalid } });
        const invalidContainer = onChange.mock.lastCall![0].containers[0];
        expect(field === 'attributeCount' ? invalidContainer.document[field] : invalidContainer.arrays[field]).toBe(
            Number(invalid),
        );
        page.rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        expect(input).toHaveValue(Number(invalid));
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toBeInTheDocument();

        fireEvent.change(input, { target: { value: valid } });
        const next = onChange.mock.lastCall![0].containers[0];
        expect(field === 'attributeCount' ? next.document.attributeCount : next.arrays[field]).toBe(Number(valid));
        page.rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        expect(screen.queryByRole('alert')?.textContent).toBe(
            field === 'attributeCount'
                ? 'Total attributes per document must match the 3 attributes in the schema properties table.'
                : undefined,
        );
    });

    it.each([0, 3, 5])('raises a total of %s only when adding a property would exceed it', (initialCount) => {
        const model = arraysModel();
        model.containers[0].document.attributeCount = initialCount;
        const onChange = vi.fn<(next: DataModel) => void>();
        const page = render(<DataPage model={model} onChange={onChange} />);
        const add = screen.getByRole('textbox', { name: 'Add property…' });
        fireEvent.change(add, { target: { value: 'extra' } });
        fireEvent.keyDown(add, { key: 'Enter' });
        const next = onChange.mock.lastCall![0];
        page.rerender(<DataPage model={next} onChange={onChange} />);

        const rows = within(screen.getByRole('table', { name: 'Schema properties' })).getAllByRole('row').length - 1;
        expect(rows).toBe(4);
        const total = screen.getByRole('spinbutton', { name: 'Total attributes per document' });
        expect(total).toHaveValue(Math.max(initialCount, rows));
        expect(total.getAttribute('aria-invalid') === 'true').toBe(initialCount > rows);
        expect(screen.queryByRole('alert')?.textContent).toBe(
            initialCount > rows
                ? 'Total attributes per document must match the 4 attributes in the schema properties table.'
                : undefined,
        );

        fireEvent.change(add, { target: { value: 'EXTRA' } });
        fireEvent.keyDown(add, { key: 'Enter' });
        expect(onChange.mock.lastCall![0].containers[0]).toEqual(next.containers[0]);
    });

    it.each([2, 7])('keeps a manually entered total of %s editable and shows a mismatch until corrected', (count) => {
        const onChange = vi.fn<(next: DataModel) => void>();
        const page = render(<DataPage model={arraysModel()} onChange={onChange} />);
        const input = screen.getByRole('spinbutton', { name: 'Total attributes per document' });
        fireEvent.change(input, { target: { value: String(count) } });
        const next = onChange.mock.lastCall![0];
        expect(next.containers[0].document.attributeCount).toBe(count);
        page.rerender(<DataPage model={next} onChange={onChange} />);
        expect(input).toHaveValue(count);
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAccessibleDescription(
            'Total attributes per document must match the 3 attributes in the schema properties table.',
        );
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Total attributes per document must match the 3 attributes in the schema properties table.',
        );

        fireEvent.change(input, { target: { value: '3' } });
        page.rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('validates against all table rows after removing a property', () => {
        const model = arraysModel();
        model.containers[0].properties[1].type = 'object';
        const onChange = vi.fn<(next: DataModel) => void>();
        const page = render(<DataPage model={model} onChange={onChange} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        const table = within(screen.getByRole('table', { name: 'Schema properties' }));
        fireEvent.click(table.getByRole('button', { name: 'Remove createdAt' }));
        page.rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        expect(table.getAllByRole('row')).toHaveLength(3);
        expect(screen.getByRole('spinbutton', { name: 'Total attributes per document' })).toHaveValue(3);
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Total attributes per document must match the 2 attributes in the schema properties table.',
        );
    });

    it('retains an average above the maximum and clears the error as the maximum is raised', () => {
        const onChange = vi.fn<(next: DataModel) => void>();
        const { rerender } = render(<DataPage model={arraysModel()} onChange={onChange} />);
        const average = screen.getByRole('spinbutton', { name: 'Average items per array' });
        fireEvent.change(average, { target: { value: '150' } });
        rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        expect(average).toHaveValue(150);
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Average items per array cannot exceed maximum items per array.',
        );

        const maximum = screen.getByRole('spinbutton', { name: 'Maximum items per array' });
        fireEvent.change(maximum, { target: { value: '200' } });
        rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(average).toHaveValue(150);
    });

    it.each([
        { label: 'Maximum items per array', hasIntermediateError: true },
        { label: 'Average items per array', hasIntermediateError: false },
        { label: 'Average document size', hasIntermediateError: false },
        { label: 'Maximum document size', hasIntermediateError: false },
        { label: 'Total attributes per document', hasIntermediateError: true },
    ])('allows typing a replacement for $label with live validation', async ({ label, hasIntermediateError }) => {
        const user = userEvent.setup();
        const model = arraysModel();
        model.containers[0].document.maxSizeKb = 100;
        render(<LiveDataPage initialModel={model} />);
        const input = screen.getByRole('spinbutton', { name: label });

        await user.clear(input);
        expect(input).toHaveDisplayValue('');
        await user.type(input, '2');
        expect(input).toHaveValue(2);
        expect(screen.queryByRole('alert') !== null).toBe(hasIntermediateError);
        await user.type(input, '0');
        expect(input).toHaveValue(20);
        await user.tab();

        expect(input).toHaveValue(20);
        expect(input.getAttribute('aria-invalid') === 'true').toBe(label === 'Total attributes per document');
    });

    it('preserves invalid array ordering on blur and allows a typed correction', async () => {
        const user = userEvent.setup();
        render(<LiveDataPage initialModel={arraysModel()} />);
        const input = screen.getByRole('spinbutton', { name: 'Maximum items per array' });
        await user.clear(input);
        await user.type(input, '2');
        await user.tab();
        expect(input).toHaveValue(2);
        expect(screen.getByRole('spinbutton', { name: 'Average items per array' })).toHaveAttribute(
            'aria-invalid',
            'true',
        );
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Average items per array cannot exceed maximum items per array.',
        );
        await user.clear(input);
        await user.type(input, '20');
        await user.tab();
        expect(input).toHaveValue(20);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('rejects an upload above the attribute limit with a message and leaves the schema unchanged', async () => {
        confirm.mockResolvedValue(true);
        const container = createBlankContainer('Orders');
        const onChange = vi.fn<(next: DataModel) => void>();
        const onTelemetry = vi.fn();
        const page = render(
            <DataPage
                model={{ containers: [container], activeContainerId: container.id }}
                onChange={onChange}
                onTelemetry={onTelemetry}
            />,
        );
        const text = JSON.stringify(Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`a${index}`, 1])));
        const file = new File([text], 'wide.json', { type: 'application/json' });
        Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(text) });
        fireEvent.change(page.container.querySelector('input[type="file"]')!, { target: { files: [file] } });

        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent(
                `wide.json contains ${(10_001).toLocaleString()} distinct attributes, more than the limit of ${(10_000).toLocaleString()}. Upload a smaller sample of documents.`,
            ),
        );
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('spinbutton', { name: 'Total attributes per document' })).toHaveValue(3);
        expect(onTelemetry).toHaveBeenCalledWith({ type: 'schemaImport', outcome: 'error' });
        expect(JSON.stringify(onTelemetry.mock.calls)).not.toContain('wide.json');
    });

    it('clears replaced attribute errors after a successful JSON upload', async () => {
        confirm.mockResolvedValue(true);
        const model = arraysModel();
        const onChange = vi.fn<(next: DataModel) => void>();
        const page = render(<DataPage model={model} onChange={onChange} />);
        const attributes = screen.getByRole('spinbutton', { name: 'Total attributes per document' });
        fireEvent.change(attributes, { target: { value: '10001' } });
        page.rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        expect(attributes).toHaveAttribute('aria-invalid', 'true');
        const average = screen.getByRole('spinbutton', { name: 'Average items per array' });
        fireEvent.change(average, { target: { value: '-1' } });
        page.rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        onChange.mockClear();

        const text = '{"id":"1","items":[]}';
        const file = new File([text], 'valid.json', { type: 'application/json' });
        Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(text) });
        fireEvent.change(page.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
        await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
        page.rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);

        expect(attributes).toHaveValue(2);
        expect(attributes).not.toHaveAttribute('aria-invalid', 'true');
        expect(average).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('Value cannot be negative.');
    });

    it('resets count errors and drafts when switching containers', () => {
        const model = arraysModel();
        const other = createBlankContainer('Other');
        other.arrays.hasArrays = true;
        model.containers.push(other);
        const onChange = vi.fn<(next: DataModel) => void>();
        const page = render(<DataPage model={model} onChange={onChange} />);
        for (const label of ['Total attributes per document', 'Average items per array', 'Maximum items per array']) {
            fireEvent.change(screen.getByRole('spinbutton', { name: label }), { target: { value: '-1' } });
            page.rerender(<DataPage model={onChange.mock.lastCall![0]} onChange={onChange} />);
        }
        expect(screen.getAllByRole('alert')).toHaveLength(3);

        page.rerender(<DataPage model={{ ...model, activeContainerId: other.id }} onChange={onChange} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('spinbutton', { name: 'Total attributes per document' })).toHaveValue(
            other.document.attributeCount,
        );
        for (const input of screen.getAllByRole('spinbutton')) {
            expect(input).not.toHaveAttribute('aria-invalid', 'true');
        }
        expect(screen.getByRole('spinbutton', { name: 'Average items per array' })).toHaveValue(other.arrays.avgItems);
        expect(screen.getByRole('spinbutton', { name: 'Maximum items per array' })).toHaveValue(other.arrays.maxItems);
    });
});

describe('DataPage schema import concurrency', () => {
    function deferred<T>() {
        let resolve!: (value: T) => void;
        let reject!: (reason: Error) => void;
        const promise = new Promise<T>((yes, no) => {
            resolve = yes;
            reject = no;
        });
        return { promise, resolve, reject };
    }

    /** Commits updates through real React state, as the wizard does, instead of inspecting emitted models. */
    function ImportHarness({
        batchRename = false,
        onTelemetry,
        onEdited,
    }: Pick<ContainerPageProps, 'onTelemetry' | 'onEdited'> & { batchRename?: boolean }) {
        const [model, setModel] = useState<DataModel>(() => {
            const container = createBlankContainer('Orders');
            return { containers: [container], activeContainerId: container.id };
        });
        const rename = () =>
            setModel((previous) => ({
                ...previous,
                containers: previous.containers.map((c) => ({ ...c, entity: 'LatestOrders' })),
            }));
        return (
            <>
                <output data-testid="model">{JSON.stringify(model)}</output>
                <div onClickCapture={batchRename ? rename : undefined}>
                    <ContainerPage
                        model={model}
                        tab="data"
                        onTabChange={vi.fn()}
                        onChange={setModel}
                        onChangeData={setModel}
                        onTelemetry={onTelemetry}
                        onEdited={onEdited}
                    />
                </div>
            </>
        );
    }

    function committedModel(): DataModel {
        return JSON.parse(screen.getByTestId('model').textContent) as DataModel;
    }

    function selectDelayedFile(container: HTMLElement, name = 'sample.json') {
        const read = deferred<string>();
        const file = new File([], name, { type: 'application/json' });
        const text = vi.fn(() => read.promise);
        Object.defineProperty(file, 'text', { value: text });
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
        return { ...read, text };
    }

    beforeEach(() => {
        confirm.mockResolvedValue(true);
    });

    it('reports a committed import and data edit once under StrictMode', async () => {
        const onTelemetry = vi.fn();
        const onEdited = vi.fn();
        const page = render(
            <StrictMode>
                <ImportHarness onTelemetry={onTelemetry} onEdited={onEdited} />
            </StrictMode>,
        );
        const read = selectDelayedFile(page.container);
        await waitFor(() => expect(read.text).toHaveBeenCalledOnce());
        await act(async () => read.resolve('{"imported":true}'));
        expect(committedModel().containers[0].properties.map((p) => p.name)).toEqual(['imported']);
        expect(onTelemetry).toHaveBeenCalledExactlyOnceWith({ type: 'schemaImport', outcome: 'success' });
        expect(onEdited).toHaveBeenCalledExactlyOnceWith('data');
        expect(screen.getByText(/Inferred schema from sample.json/)).toBeVisible();
        expect(screen.getByRole('button', { name: 'Upload JSON' })).toHaveFocus();
    });

    it('composes synchronous batched parent and field edits through the parent adapter', () => {
        render(
            <StrictMode>
                <ImportHarness batchRename />
            </StrictMode>,
        );
        // The parent capture handler queues a rename before the DataPage click handler queues its edit.
        fireEvent.click(screen.getAllByRole('button', { name: 'Remove type' })[0]);
        expect(committedModel().containers[0].entity).toBe('LatestOrders');
        expect(committedModel().containers[0].properties.map((p) => p.name)).not.toContain('type');
        expect(screen.queryByRole('row', { name: /^type / })).not.toBeInTheDocument();
    });

    it.each(['success', 'invalid', 'read error'])(
        'ignores an older %s after a newer import completes',
        async (outcome) => {
            const onTelemetry = vi.fn();
            const page = render(<ImportHarness onTelemetry={onTelemetry} />);
            const old = selectDelayedFile(page.container, 'old.json');
            await waitFor(() => expect(old.text).toHaveBeenCalledOnce());
            const current = selectDelayedFile(page.container, 'current.json');
            await waitFor(() => expect(current.text).toHaveBeenCalledOnce());
            await act(async () => current.resolve('{"newest":true}'));
            const afterCurrent = committedModel();
            await act(async () => {
                if (outcome === 'read error') old.reject(new Error('read failed'));
                else old.resolve(outcome === 'invalid' ? 'invalid' : '{"older":true}');
            });
            expect(committedModel()).toEqual(afterCurrent);
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.getByRole('row', { name: /^newest / })).toBeVisible();
            expect(screen.getByText(/Inferred schema from current.json/)).toBeVisible();
            expect(screen.queryByText(/old.json/)).not.toBeInTheDocument();
            expect(onTelemetry).toHaveBeenCalledExactlyOnceWith({ type: 'schemaImport', outcome: 'success' });
        },
    );
});
