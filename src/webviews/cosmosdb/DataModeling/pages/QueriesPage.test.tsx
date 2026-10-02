/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ModelingAdvisorProjectSchema } from '../../../../dataModeling/modelingAdvisorSchema';
import { buildDataModel, createInitialState, type DataModel } from '../dataModel';
import { QueriesPage } from './QueriesPage';

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

describe('catalog query fields', () => {
    it('shows all four catalog values with visible labels included in their accessible names', () => {
        render(<QueriesPage model={buildDataModel('multitenant')} onChange={vi.fn()} />);
        const fields = [
            { label: 'Description', value: 'Get all records for a tenant', role: 'textbox' },
            { label: 'Query', value: 'SELECT * FROM c WHERE tenantId = @tenantId', role: 'textbox' },
            { label: 'Peak QPS', value: 200, role: 'spinbutton' },
        ];
        for (const { label, value, role } of fields) {
            expect(screen.getAllByText(label)[0]).toBeVisible();
            const control = screen.getByRole(role, { name: `${label} for read 1` });
            expect(control).toBeVisible();
            expect(control).toHaveValue(value);
            expect(control).toHaveAccessibleName(`${label} for read 1`);
        }
        expect(screen.getByRole('textbox', { name: 'Query for read 1' }).tagName).toBe('INPUT');
        const filters = screen.getByRole('combobox', { name: 'Filters on for read 1' });
        expect(filters).toHaveTextContent('tenantId');
        expect(filters).toHaveAccessibleName('Filters on for read 1');
        const queryField = screen.getByRole('textbox', { name: 'Query for read 1' }).closest('.fui-Field')!;
        const filtersField = filters.closest('.fui-Field')!;
        expect(queryField.nextElementSibling).toBe(filtersField);
        expect(queryField.parentElement).toHaveStyle({
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
        });
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
        expect(filters).toHaveAccessibleDescription('Selected properties not referenced in the query: quantity');
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
        expect(filters).toHaveAccessibleDescription('Finish the SQL query to validate selected properties.');
        fireEvent.change(query, { target: { value: 'SELECT c.id FROM c' } });
        expect(filters).toHaveAccessibleDescription('Selected properties not referenced in the query: tenantId');
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
        expect(filters).toHaveAccessibleDescription('Properties no longer in this container: removed');
        await user.click(filters);
        await user.click(screen.getByRole('menuitemcheckbox', { name: 'removed' }));
        await user.keyboard('{Escape}');
        expect(filters).toHaveTextContent('Select properties');
        expect(filters).not.toHaveAccessibleDescription(/removed/);
    });
});
