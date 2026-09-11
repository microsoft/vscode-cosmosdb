/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createBlankContainer } from '../dataModel';
import { ReviewPage } from './ReviewPage';

describe('ReviewPage', () => {
    it('shows the review summary and evaluation rules without scoring priorities', () => {
        render(<ReviewPage workloadLabel="Chat" containers={[]} onEditContainer={vi.fn()} onEditWorkload={vi.fn()} />);
        expect(screen.getByText('Workload: Chat')).toBeVisible();
        expect(screen.getByText('High cardinality')).toBeVisible();
        expect(screen.getByText('Review your selections before requesting analysis.')).toBeVisible();
        expect(screen.queryByText(/priorities/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit' })).toHaveAccessibleName('Edit');
    });

    it('keeps workload and container edit shortcuts', async () => {
        const user = userEvent.setup();
        const container = createBlankContainer('Messages');
        const onEditWorkload = vi.fn();
        const onEditContainer = vi.fn();
        render(
            <ReviewPage
                workloadLabel="Chat"
                containers={[container]}
                onEditContainer={onEditContainer}
                onEditWorkload={onEditWorkload}
            />,
        );
        expect(screen.getByText('Messages')).toBeVisible();
        const [editWorkload, editContainer] = screen.getAllByRole('button', { name: 'Edit' });
        await user.click(editWorkload);
        expect(onEditWorkload).toHaveBeenCalledOnce();
        await user.click(editContainer);
        expect(onEditContainer).toHaveBeenCalledWith(container.id);
    });
});
