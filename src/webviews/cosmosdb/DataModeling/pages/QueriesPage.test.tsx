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

function blankReadModel(): DataModel {
    const container = createBlankContainer('Orders');
    container.reads = [{ id: 'read', pattern: '', query: '', qps: 10 }];
    return { containers: [container], activeContainerId: container.id };
}

describe('read evidence', () => {
    it('warns on a read without a description or query', () => {
        const model = blankReadModel();
        const onChange = vi.fn<(model: DataModel) => void>();
        render(<Editor initialModel={model} onChange={onChange} />);
        const description = screen.getByRole('textbox', { name: 'Description for read 1' });
        const describe = screen.getByRole('group', { name: 'Describe the read (at least one)' });
        const message = 'Read query 1 needs a description or a query.';
        expect(describe).toHaveAccessibleDescription(message);
        expect(within(describe).getByRole('status')).toHaveTextContent(message);

        fireEvent.change(description, { target: { value: 'Get an order' } });
        expect(describe).not.toHaveAccessibleDescription(message);
        expect(describe).not.toHaveAccessibleDescription(message);

        fireEvent.change(description, { target: { value: '' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Query for read 1' }), {
            target: { value: 'SELECT * FROM c WHERE c.customerId = @id' },
        });
        expect(within(describe).queryByRole('status')).not.toBeInTheDocument();
    });
});

describe('catalog query fields', () => {
    it('shows description, query and QPS with accessible labels and no filter dropdown', () => {
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
        expect(screen.getByRole('textbox', { name: 'Query for read 1' }).tagName).toBe('INPUT');
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        expect(screen.queryByText('Filters on')).not.toBeInTheDocument();
        const queryField = screen
            .getByRole('textbox', { name: 'Query for read 1' })
            .closest<HTMLElement>('.fui-Field')!;
        const qpsField = screen
            .getByRole('spinbutton', { name: 'Peak QPS for read 1' })
            .closest<HTMLElement>('.fui-Field')!;
        const describe = screen.getAllByRole('group', { name: 'Describe the read (at least one)' })[0];
        expect(describe).toContainElement(
            screen.getByRole('textbox', { name: 'Description for read 1' }).closest<HTMLElement>('.fui-Field'),
        );
        expect(describe).toContainElement(queryField);
        expect(describe).not.toContainElement(qpsField);
        expect(queryField.parentElement).toBe(describe);
    });

    it('visually and semantically groups each query with its own three inputs and remove button', () => {
        const model = buildDataModel('multitenant');
        render(<QueriesPage model={model} onChange={vi.fn()} />);
        const groups = screen.getAllByRole('group', { name: /^Read query \d+$/ });
        expect(groups).toHaveLength(model.containers[0].reads.length);
        for (const [index, group] of groups.entries()) {
            expect(group.tagName).toBe('FIELDSET');
            expect(group).toHaveAccessibleName(`Read query ${index + 1}`);
            const describe = within(group).getByRole('group', { name: 'Describe the read (at least one)' });
            expect(describe.tagName).toBe('FIELDSET');
            expect(within(describe).getByText('Describe the read (at least one)')).toBeVisible();
            expect(within(group).getByText(`Read query ${index + 1}`)).toBeVisible();
            expect(group).toHaveStyle({ borderTopStyle: 'solid', borderTopWidth: '1px' });
            for (const label of ['Description', 'Query', 'Peak QPS']) {
                expect(within(group).getByLabelText(`${label} for read ${index + 1}`)).toBeVisible();
            }
            expect(within(group).getByRole('button', { name: 'Remove read query' })).toBeVisible();
        }
    });

    it('edits the active container without adding filter metadata and retains all fields through project restore', () => {
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
        fireEvent.change(query, { target: { value: 'SELECT * FROM c' } });
        expect(restore(onChange.mock.lastCall![0]).containers[0].reads[0].query).toBe('SELECT * FROM c');
    });

    it('accepts in-progress SQL without filter validation or automatic selections', () => {
        const onChange = vi.fn();
        const model = buildDataModel('multitenant');
        render(<Editor initialModel={model} onChange={onChange} />);
        const query = screen.getByRole('textbox', { name: 'Query for read 1' });
        fireEvent.change(query, { target: { value: 'SELECT c.id FROM c WHERE' } });
        expect(query).toHaveAccessibleDescription('Full NoSQL SELECT query.');
        expect(onChange.mock.lastCall![0].containers[0].reads[0]).toEqual({
            ...model.containers[0].reads[0],
            query: 'SELECT c.id FROM c WHERE',
        });
        expect(onChange.mock.lastCall![0].containers[0].reads[0]).not.toHaveProperty('filters');
    });
});

describe('workload rate limits', () => {
    function singleRead(qps: number, avgSizeKb = 1): DataModel {
        const container = createBlankContainer('Orders');
        container.document.avgSizeKb = avgSizeKb;
        container.reads = [{ id: 'read', pattern: 'Get an order', query: '', qps }];
        return { containers: [container], activeContainerId: container.id };
    }

    it.each([
        { value: '1000001', message: 'Value cannot exceed 1,000,000.' },
        { value: '-1', message: 'Value cannot be negative.' },
        { value: '2.5', message: 'Enter a whole number.' },
    ])('rejects a peak QPS of $value', ({ value, message }) => {
        const onChange = vi.fn<(model: DataModel) => void>();
        render(<Editor initialModel={singleRead(10)} onChange={onChange} />);
        const input = screen.getByRole('spinbutton', { name: 'Peak QPS for read 1' });
        fireEvent.change(input, { target: { value } });
        expect(onChange).not.toHaveBeenCalled();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent(message.replace('1,000,000', (1_000_000).toLocaleString()));

        fireEvent.change(input, { target: { value: '1000000' } });
        expect(onChange.mock.lastCall![0].containers[0].reads[0].qps).toBe(1_000_000);
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
    });

    it.each(['Inserts / sec', 'Updates / sec', 'Deletes / sec'])('rejects an unrealistic %s rate', (label) => {
        const onChange = vi.fn<(model: DataModel) => void>();
        render(<Editor initialModel={singleRead(10)} onChange={onChange} />);
        const input = screen.getByRole('spinbutton', { name: label });
        fireEvent.change(input, { target: { value: '2000000' } });
        expect(onChange).not.toHaveBeenCalled();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        fireEvent.change(input, { target: { value: '' } });
        expect(onChange).toHaveBeenCalledOnce();
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('warns above the per-container limit and errors beyond the unrealistic ceiling', () => {
        const { rerender } = render(<QueriesPage model={singleRead(1_000_000)} onChange={vi.fn()} />);
        expect(screen.queryByText(/default limit of/)).not.toBeInTheDocument();

        rerender(<QueriesPage model={singleRead(1_000_000, 2)} onChange={vi.fn()} />);
        expect(screen.getByRole('status')).toHaveTextContent(/exceeds the default limit of .* RU\/s per container/);

        rerender(<QueriesPage model={singleRead(1_000_000, 11)} onChange={vi.fn()} />);
        expect(screen.getByRole('alert')).toHaveTextContent(/is not realistic for one container/);
    });

    it('warns about a hot partition only for concentrated writes', () => {
        const model = singleRead(0);
        model.containers[0].writes.insertsPerSec = 4_000;
        const { rerender } = render(<QueriesPage model={model} onChange={vi.fn()} />);
        expect(screen.queryByText(/throttling risk if more than/)).not.toBeInTheDocument();

        model.containers[0].scale.writes = 'time';
        rerender(<QueriesPage model={structuredClone(model)} onChange={vi.fn()} />);
        expect(screen.getByRole('status')).toHaveTextContent(
            /throttling risk if more than .* reaches one physical partition/,
        );
    });
});
