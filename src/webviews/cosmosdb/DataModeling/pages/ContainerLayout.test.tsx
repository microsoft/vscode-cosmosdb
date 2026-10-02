/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createBlankContainer, type DataModel } from '../dataModel';
import { DataPage } from './DataPage';
import { QueriesPage } from './QueriesPage';
import { ScalePage } from './ScalePage';

vi.mock('@microsoft/vscode-ext-webview/react', () => ({
    useTrpcClient: () => ({ dataModeling: { confirm: { mutate: vi.fn() } } }),
}));

const pages = { Data: DataPage, Queries: QueriesPage, Scale: ScalePage };

function Tab({ name, initialModel }: { name: keyof typeof pages; initialModel: DataModel }) {
    const [model, setModel] = useState(initialModel);
    const Page = pages[name];
    return <Page model={model} onChange={setModel} />;
}

function model(): DataModel {
    const container = createBlankContainer('Messages');
    return { containers: [container], activeContainerId: container.id };
}

describe('single-column container tabs', () => {
    it.each(['Data', 'Queries', 'Scale'] as const)('%s uses one vertical content stack without a sidebar', (name) => {
        const page = render(<Tab name={name} initialModel={model()} />);
        expect(page.container.firstElementChild).toHaveStyle({ display: 'flex', flexDirection: 'column' });
        expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    });

    it('groups properties and upload with optional guidance, without duplicating the step template notice', async () => {
        const user = userEvent.setup();
        render(<Tab name="Data" initialModel={model()} />);
        expect(screen.queryByText(/Pre-filled/)).not.toBeInTheDocument();
        const upload = screen.getByRole('button', { name: 'Upload JSON' });
        const card = screen.getByText('Key & filter properties').closest('section')!;
        const input = within(card).getByRole('textbox', { name: 'Add property…' });
        expect(card).toContainElement(upload);
        expect(card).toContainElement(screen.getByRole('table', { name: 'Schema properties' }));
        expect(input.parentElement?.nextElementSibling).toBe(upload);
        expect(upload).toHaveAccessibleName('Upload JSON');
        expect(upload).toHaveAccessibleDescription('Upload your JSON documents to infer the schema for this container');
        expect(
            screen.queryByText('Upload your JSON documents to infer the schema for this container'),
        ).not.toBeInTheDocument();
        await user.type(input, 'customerId{Enter}');
        expect(within(card).getByRole('combobox', { name: 'Type for customerId' })).toBeVisible();
        const summary = screen.getByText('Partition-key guidance');
        const details = summary.closest('details');
        expect(details).not.toHaveAttribute('open');
        expect(screen.getByRole('table', { name: 'Schema properties' })).toBeVisible();
        await user.click(summary);
        expect(details).toHaveAttribute('open');
        expect(screen.getByText('Avoid mutable fields like status')).toBeVisible();
        await user.click(summary);
        expect(details).not.toHaveAttribute('open');
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Average document size' }), {
            target: { value: '8' },
        });
        expect(screen.getByRole('spinbutton', { name: 'Average document size' })).toHaveValue(8);
    });

    it('keeps query editing and request estimates working with guidance collapsed', async () => {
        const user = userEvent.setup();
        render(<Tab name="Queries" initialModel={model()} />);
        const summary = screen.getByText('Query alignment is critical');
        expect(summary.closest('details')).not.toHaveAttribute('open');
        await user.click(summary);
        expect(screen.getByText('Optimize for the 80% case')).toBeVisible();
        await user.click(summary);
        const pattern = screen.getByRole('textbox', { name: 'Description for read 1' });
        const readsCard = screen.getByText('📖 Reads').closest('section')!;
        const writesCard = screen.getByText('✍️ Writes').closest('section')!;
        expect(readsCard).toContainElement(pattern);
        expect(readsCard).toContainElement(summary);
        expect(writesCard).toContainElement(screen.getByRole('spinbutton', { name: 'Inserts / sec' }));
        expect(readsCard.nextElementSibling).toBe(writesCard);
        expect(writesCard.nextElementSibling).toContainElement(screen.getByText('Estimated request cost'));
        await user.type(pattern, 'Find messages');
        expect(pattern).toHaveValue('Find messages');
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Inserts / sec' }), { target: { value: '42' } });
        expect(screen.getByText('42 TPS')).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Add read query' }));
        expect(screen.getByRole('textbox', { name: 'Description for read 2' })).toBeVisible();
        await user.click(screen.getAllByRole('button', { name: 'Remove read query' })[1]);
        expect(screen.queryByRole('textbox', { name: 'Description for read 2' })).not.toBeInTheDocument();
        expect(screen.getByText('Estimated request cost')).toBeVisible();
    });

    it('keeps limits visible with the size estimate and recalculates the warning when scale changes', async () => {
        const user = userEvent.setup();
        const initialModel = model();
        initialModel.containers[0].document.avgSizeKb = 100;
        render(<Tab name="Scale" initialModel={initialModel} />);
        const estimate = screen.getByText('📦 Projected logical-partition size').closest('section')!;
        const limits = screen.getByText('Partition limits').closest('section')!;
        expect(limits).toHaveAccessibleName('Partition limits');
        expect(within(limits).getByText('✨')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.queryByText(/1M partition key values will be expensive/)).not.toBeInTheDocument();
        expect(
            within(limits)
                .getAllByRole('listitem')
                .map((item) => item.textContent),
        ).toEqual(['20 GB per logical partition', '10K RU/s per physical partition', '50 GB per physical partition']);
        expect(within(limits).getByText('20 GB').tagName).toBe('STRONG');
        expect(within(limits).getByText('10K RU/s').tagName).toBe('STRONG');
        expect(within(limits).getByText('50 GB').tagName).toBe('STRONG');
        expect(within(limits).getByText(/Even with 100K RU\/s provisioned/)).toBeVisible();
        expect(within(limits).getByText('⚠️')).toHaveAttribute('aria-hidden', 'true');
        expect(estimate.nextElementSibling).toBe(limits);
        for (const title of ['Items per partition key value', 'Write distribution', 'Data growth per PK value']) {
            expect(screen.getByText(title).closest('section')).toContainElement(
                screen.getByRole('radiogroup', { name: title }),
            );
        }
        expect(
            screen.getByText('Partition-key candidates — estimated distinct values').closest('section'),
        ).toContainElement(screen.getByRole('table', { name: 'Partition-key candidates' }));
        expect(screen.queryByText(/Projected size exceeds/)).not.toBeInTheDocument();
        expect(screen.getByRole('radiogroup', { name: 'Data growth per PK value' }).contains(estimate)).toBe(false);
        await user.click(screen.getByRole('radio', { name: '100K – 1M items' }));
        expect(within(estimate).getByText(/Projected size exceeds the 20 GB limit/)).toBeVisible();
        await user.click(screen.getByRole('radio', { name: 'Grows slowly' }));
        expect(screen.getByRole('radio', { name: 'Grows slowly' })).toHaveAttribute('aria-checked', 'true');
        const distinctValues = screen.getByRole('combobox', { name: 'Estimated distinct values for id' });
        expect(within(distinctValues).getByRole('option', { name: '< 100 — low ⚠️' })).toHaveValue('50');
        expect(within(distinctValues).getByRole('option', { name: 'Hundreds – thousands' })).toHaveValue('1000');
        expect(within(distinctValues).getByRole('option', { name: 'Millions+ — excellent' })).toHaveValue('1000000');
        expect(distinctValues).toHaveValue('1000');
        await user.selectOptions(distinctValues, '1000000');
        expect(distinctValues).toHaveValue('1000000');
    });
});
