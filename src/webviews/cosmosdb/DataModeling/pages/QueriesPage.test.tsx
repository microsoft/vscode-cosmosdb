/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ModelingAdvisorProjectSchema } from '../../../../dataModeling/modelingAdvisorSchema';
import { buildDataModel, createBlankContainer, createInitialState, type DataModel } from '../dataModel';
import { inferSchemaFromJson } from '../jsonInference';
import { QueriesPage } from './QueriesPage';

const filtersHint = 'Properties used in the query.';

function Editor({ initialModel, onChange }: { initialModel: DataModel; onChange: (model: DataModel) => void }) {
    const [model, setModel] = useState(initialModel);
    return (
        <QueriesPage
            model={model}
            onChange={(next) => {
                setModel(next);
                onChange(next);
            }}
        />
    );
}

function restore(model: DataModel): DataModel {
    return ModelingAdvisorProjectSchema.parse(
        JSON.parse(
            JSON.stringify({
                version: 1,
                name: 'Queries',
                state: {
                    wizard: { ...createInitialState(), dataModel: model },
                    recommendation: { status: 'idle' },
                },
            }),
        ),
    ).state.wizard.dataModel;
}

function nestedModel(): DataModel {
    const container = createBlankContainer('Orders');
    const schema = inferSchemaFromJson(
        JSON.stringify({ id: 'order-1', customerId: 'top-level-id', customer: { customerId: 'nested-id' } }),
    );
    container.properties = schema.properties.map((property) => ({ id: property.name, ...property }));
    container.reads = [{ id: 'read', pattern: '', query: '', filters: [], qps: 10 }];
    return { containers: [container], activeContainerId: container.id };
}

describe('nested query property references', () => {
    it('names the sparkle button, disables blank descriptions, and exposes launch status', async () => {
        const model = nestedModel();
        const generate = vi.fn().mockResolvedValue(undefined);
        const { rerender } = render(<QueriesPage model={model} onChange={vi.fn()} onGenerateQuery={generate} />);
        const label = 'Generate query for read 1 with Copilot';
        expect(screen.getByRole('button', { name: label })).toBeDisabled();
        model.containers[0].reads[0].pattern = 'Get customer orders';
        rerender(<QueriesPage model={model} onChange={vi.fn()} onGenerateQuery={generate} />);
        const button = screen.getByRole('button', { name: label });
        button.focus();
        await userEvent.keyboard('{Enter}');
        expect(generate).toHaveBeenCalledWith(model.containers[0].id, 'read');
        rerender(
            <QueriesPage
                model={model}
                onChange={vi.fn()}
                onGenerateQuery={generate}
                queryStatuses={{
                    [JSON.stringify([model.containers[0].id, 'read'])]: {
                        opening: true,
                        message: 'Opening Copilot Chat…',
                    },
                }}
            />,
        );
        expect(screen.getByRole('button', { name: label })).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('Opening Copilot Chat…');
    });

    it.each([{ savedFilters: [] }, { savedFilters: ['items/productId'] }])(
        'resolves iterator references with saved filters $savedFilters without selecting a same-named root property or warning on the nested one',
        ({ savedFilters }) => {
            const model = nestedModel();
            const container = model.containers[0];
            container.properties = ['productId', 'items/productId'].map((name) => ({
                ...container.properties[0],
                id: name,
                name,
            }));
            container.reads[0].filters = savedFilters;
            const onChange = vi.fn<(model: DataModel) => void>();
            render(<Editor initialModel={model} onChange={onChange} />);
            const sql = 'SELECT * FROM c JOIN i IN c.items WHERE i.productId = @p';
            fireEvent.change(screen.getByRole('textbox', { name: 'Query for read 1' }), { target: { value: sql } });
            const filters = screen.getByRole('combobox', { name: 'Filters on for read 1' });
            expect(filters).toHaveTextContent(/^items\/productId$/);
            expect(filters).toHaveAccessibleDescription(filtersHint);
            expect(screen.queryByText(/Selected properties not referenced/)).not.toBeInTheDocument();
            const edited = onChange.mock.lastCall![0];
            expect(edited.containers[0].reads[0].filters).toEqual(['items/productId']);
            expect(restore(edited)).toEqual(edited);
        },
    );

    const references = [
        'c.customer.customerId',
        'c["customer"]["customerId"]',
        'c.customer["customerId"]',
        'c["customer"].customerId',
    ];

    it.each(references)('auto-selects the full path for %s without a false warning', (reference) => {
        const onChange = vi.fn<(model: DataModel) => void>();
        render(<Editor initialModel={nestedModel()} onChange={onChange} />);
        const sql = `SELECT * FROM c WHERE ${reference} = @customerId`;
        fireEvent.change(screen.getByRole('textbox', { name: 'Query for read 1' }), { target: { value: sql } });
        const filters = screen.getByRole('combobox', { name: 'Filters on for read 1' });
        expect(filters).toHaveTextContent(/^customer\/customerId$/);
        expect(filters).toHaveAccessibleDescription(filtersHint);
        expect(screen.queryByText(/Selected properties not referenced/)).not.toBeInTheDocument();
        const edited = onChange.mock.lastCall![0];
        expect(edited.containers[0].reads[0].filters).toEqual(['customer/customerId']);
        expect(edited.containers[0].reads[0].query).toBe(sql);
        expect(restore(edited)).toEqual(edited);
    });

    it.each(references)('recognizes a manually selected nested field in %s', async (reference) => {
        const user = userEvent.setup();
        const model = nestedModel();
        const sql = `SELECT * FROM c WHERE ${reference} = @customerId`;
        model.containers[0].reads[0].query = sql;
        const onChange = vi.fn<(model: DataModel) => void>();
        render(<Editor initialModel={model} onChange={onChange} />);
        const filters = screen.getByRole('combobox', { name: 'Filters on for read 1' });
        await user.click(filters);
        await user.click(screen.getByRole('menuitemcheckbox', { name: 'customer/customerId' }));
        await user.keyboard('{Escape}');
        expect(filters).toHaveAccessibleDescription(filtersHint);
        expect(screen.queryByText(/Selected properties not referenced/)).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Query for read 1' })).toHaveValue(sql);
        expect(onChange.mock.lastCall![0].containers[0].reads[0].filters).toEqual(['customer/customerId']);

        await user.click(filters);
        await user.click(screen.getByRole('menuitemcheckbox', { name: 'customerId' }));
        await user.keyboard('{Escape}');
        expect(filters).toHaveAccessibleDescription(
            `Selected properties not referenced in the query: customerId ${filtersHint}`,
        );
    });
});

describe('catalog query fields', () => {
    it('shows all four catalog values with visible labels included in their accessible names', () => {
        render(<QueriesPage model={buildDataModel('multitenant')} onChange={vi.fn()} />);
        const fields = [
            {
                label: 'Description',
                value: 'Get all records for a tenant',
                role: 'textbox',
                hint: 'What this read retrieves.',
            },
            {
                label: 'Query',
                value: 'SELECT * FROM c WHERE tenantId = @tenantId',
                role: 'textbox',
                hint: 'Full NoSQL SELECT query.',
            },
            {
                label: 'Peak QPS',
                value: 200,
                role: 'spinbutton',
                hint: 'Peak queries/sec, all users.',
            },
        ];
        for (const { label, value, role, hint } of fields) {
            expect(screen.getAllByText(label)[0]).toBeVisible();
            const control = screen.getByRole(role, { name: `${label} for read 1` });
            expect(control).toBeVisible();
            expect(control).toHaveValue(value);
            expect(control).toHaveAccessibleName(`${label} for read 1`);
            expect(screen.getAllByText(hint)[0]).toBeVisible();
            expect(control).toHaveAccessibleDescription(hint);
            const caption = screen.getAllByText(hint)[0];
            expect(caption).toHaveStyle({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
            expect(caption).toHaveAttribute('title', hint);
            expect(control.closest('.fui-Field')).toContainElement(caption);
            expect(control.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        expect(screen.getByRole('textbox', { name: 'Query for read 1' }).tagName).toBe('TEXTAREA');
        const filters = screen.getByRole('combobox', { name: 'Filters on for read 1' });
        expect(filters).toHaveTextContent('tenantId');
        expect(filters).toHaveAccessibleName('Filters on for read 1');
        expect(screen.getAllByText(filtersHint)[0]).toBeVisible();
        expect(filters).toHaveAccessibleDescription(filtersHint);
        expect(screen.getAllByText(filtersHint)[0]).toHaveStyle({ whiteSpace: 'nowrap' });
        const queryField = screen.getByRole('textbox', { name: 'Query for read 1' }).closest('.fui-Field')!;
        const filtersField = filters.closest('.fui-Field')!;
        expect(queryField.nextElementSibling).toBe(filtersField);
        expect(queryField.parentElement).toHaveStyle({
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
        });
    });

    it('visually and semantically groups each query with its own four inputs and remove button', () => {
        const model = buildDataModel('multitenant');
        render(<QueriesPage model={model} onChange={vi.fn()} />);
        const groups = screen.getAllByRole('group', { name: /^Read query \d+$/ });
        expect(groups).toHaveLength(model.containers[0].reads.length);
        for (const [index, group] of groups.entries()) {
            expect(group.tagName).toBe('FIELDSET');
            expect(group).toHaveAccessibleName(`Read query ${index + 1}`);
            expect(within(group).getByText(`Read query ${index + 1}`)).toBeVisible();
            expect(group).toHaveStyle({ borderTopStyle: 'solid', borderTopWidth: '1px' });
            for (const label of ['Description', 'Query', 'Peak QPS', 'Filters on']) {
                expect(within(group).getByLabelText(`${label} for read ${index + 1}`)).toBeVisible();
            }
            expect(within(group).getByRole('button', { name: 'Remove read query' })).toBeVisible();
        }
    });

    it('edits the active container, auto-selects query properties, and retains all fields through project restore', () => {
        const model = buildDataModel('inventory');
        model.activeContainerId = model.containers[1].id;
        const onChange = vi.fn();
        render(<Editor initialModel={model} onChange={onChange} />);
        const sql = 'SELECT c.id FROM c WHERE c.skuId = @skuId ORDER BY c.occurredAt DESC';
        const edits = [
            { label: 'Description', value: 'Recent movements', role: 'textbox' },
            { label: 'Query', value: sql, role: 'textbox' },
            { label: 'Peak QPS', value: '125', role: 'spinbutton' },
        ];
        for (const { label, value, role } of edits) {
            fireEvent.change(screen.getByRole(role, { name: `${label} for read 1` }), { target: { value } });
        }
        const edited: DataModel = onChange.mock.lastCall![0];
        expect(edited.containers[0]).toEqual(model.containers[0]);
        expect(edited.containers[1].reads[0]).toEqual({
            id: model.containers[1].reads[0].id,
            pattern: 'Recent movements',
            query: sql,
            filters: ['skuId', 'occurredAt', 'id'],
            qps: 125,
        });
        expect(edited.containers[1].reads.slice(1)).toEqual(model.containers[1].reads.slice(1));
        expect(restore(edited)).toEqual(edited);
    });

    it('adds and removes complete query rows without changing other reads', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const model = buildDataModel('multitenant');
        render(<Editor initialModel={model} onChange={onChange} />);
        await user.click(screen.getByRole('button', { name: 'Add read query' }));
        expect(screen.getByRole('textbox', { name: 'Query for read 3' })).toHaveValue('');
        expect(onChange.mock.lastCall![0].containers[0].reads[2]).toEqual({
            id: expect.any(String),
            pattern: '',
            query: '',
            filters: [],
            qps: 0,
        });
        await user.click(screen.getAllByRole('button', { name: 'Remove read query' })[2]);
        expect(screen.queryByRole('textbox', { name: 'Query for read 3' })).not.toBeInTheDocument();
        expect(onChange.mock.lastCall![0].containers[0].reads).toEqual(model.containers[0].reads);
    });

    it('opens legacy projects without inventing SQL and allows the missing field to be edited', () => {
        const model = buildDataModel('multitenant');
        delete model.containers[0].reads[0].query;
        const onChange = vi.fn();
        render(<Editor initialModel={restore(model)} onChange={onChange} />);
        const query = screen.getByRole('textbox', { name: 'Query for read 1' });
        expect(query).toHaveValue('');
        expect(screen.getByRole('combobox', { name: 'Filters on for read 1' })).toHaveTextContent('tenantId');
        fireEvent.change(query, { target: { value: 'SELECT * FROM c' } });
        expect(restore(onChange.mock.lastCall![0]).containers[0].reads[0].query).toBe('SELECT * FROM c');
    });

    it('offers only active-container properties, supports multiple selections, and warns without rewriting SQL', async () => {
        const user = userEvent.setup();
        const model = buildDataModel('inventory');
        const onChange = vi.fn();
        render(<Editor initialModel={model} onChange={onChange} />);
        const query = screen.getByRole('textbox', { name: 'Query for read 1' });
        const originalQuery = model.containers[0].reads[0].query;
        const filters = screen.getByRole('combobox', { name: 'Filters on for read 1' });
        await user.click(filters);
        expect(screen.getAllByRole('menuitemcheckbox').map((option) => option.textContent)).toEqual(
            model.containers[0].properties.map((property) => property.name),
        );
        await user.click(screen.getByRole('menuitemcheckbox', { name: 'quantity' }));
        expect(screen.getByRole('menuitemcheckbox', { name: 'quantity' })).toHaveAttribute('aria-checked', 'true');
        await user.keyboard('{Escape}');
        expect(query).toHaveValue(originalQuery);
        expect(filters).toHaveAccessibleDescription(
            `Selected properties not referenced in the query: quantity ${filtersHint}`,
        );
        const edited: DataModel = onChange.mock.lastCall![0];
        expect(restore(edited)).toEqual(edited);
        expect(edited.containers[0].reads[0].filters).toContain('quantity');
        expect(edited.containers[1]).toEqual(model.containers[1]);
        await user.click(filters);
        await user.click(screen.getByRole('menuitemcheckbox', { name: 'quantity' }));
        await user.keyboard('{Escape}');
        expect(filters).not.toHaveAccessibleDescription(/quantity/);
        expect(query).toHaveValue(originalQuery);
    });

    it('auto-selects references on SQL edits, retains missing selections, and handles incomplete queries', () => {
        const onChange = vi.fn();
        render(<Editor initialModel={buildDataModel('multitenant')} onChange={onChange} />);
        const query = screen.getByRole('textbox', { name: 'Query for read 1' });
        const filters = screen.getByRole('combobox', { name: 'Filters on for read 1' });
        fireEvent.change(query, { target: { value: 'SELECT c.id FROM c WHERE c.tenantId = @value' } });
        expect(filters).toHaveTextContent('tenantId, id');
        fireEvent.change(query, { target: { value: 'SELECT c.id FROM c WHERE' } });
        expect(filters).toHaveTextContent('tenantId, id');
        expect(filters).toHaveAccessibleDescription(
            `Finish the SQL query to validate selected properties. ${filtersHint}`,
        );
        fireEvent.change(query, { target: { value: 'SELECT c.id FROM c' } });
        expect(filters).toHaveAccessibleDescription(
            `Selected properties not referenced in the query: tenantId ${filtersHint}`,
        );
    });

    it('allows keyboard selection and deselection, including clearing all properties', async () => {
        const user = userEvent.setup();
        const model = buildDataModel('multitenant');
        model.containers[0].reads[0].filters = [];
        render(<Editor initialModel={model} onChange={vi.fn()} />);
        const filters = screen.getByRole('combobox', { name: 'Filters on for read 1' });
        filters.focus();
        await user.keyboard('{ArrowDown} ');
        expect(screen.getByRole('menuitemcheckbox', { name: 'id' })).toHaveAttribute('aria-checked', 'true');
        await user.keyboard(' ');
        expect(screen.getByRole('menuitemcheckbox', { name: 'id' })).toHaveAttribute('aria-checked', 'false');
        await user.keyboard('{Escape}');
        expect(filters).toHaveFocus();
        expect(filters).toHaveTextContent('Select properties');
    });

    it('keeps removed properties visible for deselection rather than silently discarding saved selections', async () => {
        const user = userEvent.setup();
        const model = buildDataModel('multitenant');
        model.containers[0].reads[0].filters = ['removed'];
        render(<Editor initialModel={model} onChange={vi.fn()} />);
        const filters = screen.getByRole('combobox', { name: 'Filters on for read 1' });
        expect(filters).toHaveAccessibleDescription(`Properties no longer in this container: removed ${filtersHint}`);
        await user.click(filters);
        await user.click(screen.getByRole('menuitemcheckbox', { name: 'removed' }));
        await user.keyboard('{Escape}');
        expect(filters).toHaveTextContent('Select properties');
        expect(filters).not.toHaveAccessibleDescription(/removed/);
    });
});
