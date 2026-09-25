/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createBlankContainer } from '../dataModel';
import { type ContainerModel } from '../models';
import { ReviewPage } from './ReviewPage';

function chatSession(): ContainerModel {
    const container = createBlankContainer('ChatSession');
    container.partitionKey = '/sessionId';
    container.document.avgSizeKb = 1;
    container.reads = [
        { id: 'r1', pattern: 'Get session by id', filters: 'id', qps: 20 },
        { id: 'r2', pattern: 'Get all messages in a session', filters: 'sessionId', qps: 250 },
    ];
    container.writes = { insertsPerSec: 50, updatesPerSec: 15, deletesPerSec: 5 };
    container.scale = { ...container.scale, items: 'medium', writes: 'even', growth: 'slow' };
    return container;
}

function renderReview(containers: ContainerModel[] = [chatSession()]) {
    const onEditWorkload = vi.fn();
    const onEditContainer = vi.fn();
    render(
        <ReviewPage
            workloadLabel="Chat & Sessions"
            containers={containers}
            onEditWorkload={onEditWorkload}
            onEditContainer={onEditContainer}
        />,
    );
    return { onEditWorkload, onEditContainer };
}

describe('ReviewPage', () => {
    it('orders the workload line, container cards, and rules without a sidebar or scoring priorities', () => {
        renderReview();
        const workload = screen.getByText('Chat & Sessions');
        const hint = screen.getByText('Click Edit to change any selection before analysis.');
        const cards = screen.getByRole('list', { name: 'Containers' });
        const rules = screen.getByRole('region', { name: "Rules we'll evaluate" });
        expect(workload.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(hint.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(cards.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
        expect(screen.queryByText(/priorities/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });

    it('changes the workload from a link named by its visible text and described by the workload', async () => {
        const user = userEvent.setup();
        const { onEditWorkload } = renderReview();
        const change = screen.getByRole('button', { name: 'Change' });
        expect(change).toHaveTextContent('Change');
        expect(change).toHaveAccessibleDescription('Workload: Chat & Sessions');
        await user.click(change);
        expect(onEditWorkload).toHaveBeenCalledOnce();
    });

    it('renders one card per container with a title, partition key, and workload summary', () => {
        renderReview([chatSession(), createBlankContainer('User')]);
        const cards = Array.from(screen.getByRole('list', { name: 'Containers' }).children) as HTMLElement[];
        expect(cards).toHaveLength(2);

        const session = cards[0];
        expect(within(session).getByRole('heading', { level: 3, name: 'ChatSession' })).toBeVisible();
        expect(within(session).getByRole('img', { name: 'Partition key' }).parentElement).toHaveTextContent(
            '/sessionId',
        );
        expect(within(session).getByRole('img', { name: 'Top read' }).parentElement).toHaveTextContent(
            'Get all messages in a session',
        );
        expect(within(session).getByText('270 read QPS · 70 write TPS')).toBeVisible();
        expect(within(session).getByText('~1 KB average document')).toBeVisible();
        expect(within(session).getByText('Items: Medium · Writes: Even · Growth: Slow')).toBeVisible();
    });

    it('edits each container from a keyboard-accessible button described by its title', async () => {
        const user = userEvent.setup();
        const containers = [chatSession(), createBlankContainer('User')];
        const { onEditContainer } = renderReview(containers);
        await user.tab();
        expect(screen.getByRole('button', { name: 'Change' })).toHaveFocus();

        const edits = screen.getAllByRole('button', { name: 'Edit' });
        expect(edits).toHaveLength(2);
        for (const [index, container] of containers.entries()) {
            expect(edits[index]).toHaveTextContent('Edit');
            expect(edits[index]).toHaveAccessibleDescription(container.entity);
            await user.tab();
            expect(edits[index]).toHaveFocus();
            await user.keyboard('{Enter}');
            expect(onEditContainer).toHaveBeenLastCalledWith(container.id);
        }
    });

    it('lists every evaluated rule with the decorative pass checkmark used for good result reasons', () => {
        renderReview();
        const rules = within(screen.getByRole('region', { name: "Rules we'll evaluate" })).getAllByRole('listitem');
        const heading = screen.getByRole('heading', { name: "Rules we'll evaluate" });
        expect(heading).toHaveAccessibleName("Rules we'll evaluate");
        const panel = screen.getByRole('region', { name: "Rules we'll evaluate" });
        expect(within(panel).getByText('✨')).toHaveAttribute('aria-hidden', 'true');
        expect(rules.map((rule) => rule.textContent)).toEqual([
            '✓High cardinality',
            '✓Query alignment',
            '✓Hot partition risk',
            '✓Immutability',
            '✓20 GB limit',
            '✓Key length',
            '✓Synthetic key need',
            '✓Hierarchical PK assessment',
        ]);
        for (const rule of rules) {
            expect(rule.firstElementChild).toHaveAttribute('aria-hidden', 'true');
            expect(rule.querySelector('svg')).not.toBeInTheDocument();
        }
        expect(screen.queryByRole('img', { name: 'Pass' })).not.toBeInTheDocument();
    });

    it('describes missing partition keys and read patterns without inventing values', () => {
        const container = createBlankContainer('Orders');
        container.partitionKey = '';
        container.reads = [];
        renderReview([container]);
        expect(screen.getByText('Not selected')).toBeVisible();
        expect(screen.getByText('No read pattern defined')).toBeVisible();
        expect(screen.getByText('0 read QPS · 0 write TPS')).toBeVisible();
    });

    it('falls back to the filtered attributes when the top read has no description', () => {
        renderReview([createBlankContainer('Orders')]);
        expect(screen.getByText('Read by id')).toBeVisible();
    });
});
