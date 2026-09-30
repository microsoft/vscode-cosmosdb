/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DashboardFooter } from './DashboardFooter';

it('labels the Data Modeler preview accessibly and opens it on activation', async () => {
    const onOpenDataModeler = vi.fn();
    render(
        <DashboardFooter
            isAIFeaturesEnabled
            onAddDatabase={vi.fn()}
            onAddContainer={vi.fn()}
            onDeleteAccount={vi.fn()}
            onOpenDataModeler={onOpenDataModeler}
        />,
    );

    const button = screen.getByRole('button', { name: 'Try Data Modeler (preview)' });
    expect(button).toHaveTextContent('Try Data Modeler (preview)');
    expect(button).toHaveAccessibleName('Try Data Modeler (preview)');
    expect(button).toHaveAccessibleDescription('Design containers, partition keys, and relationships visually.');
    await userEvent.click(button);
    expect(onOpenDataModeler).toHaveBeenCalledOnce();
});

it('hides the Data Modeler control and hint when AI is unavailable and responds to availability changes', () => {
    const props = {
        onAddDatabase: vi.fn(),
        onAddContainer: vi.fn(),
        onDeleteAccount: vi.fn(),
        onOpenDataModeler: vi.fn(),
    };
    const { rerender } = render(<DashboardFooter {...props} isAIFeaturesEnabled={false} />);
    expect(screen.queryByRole('button', { name: 'Try Data Modeler (preview)' })).not.toBeInTheDocument();
    expect(
        screen.queryByText('Design containers, partition keys, and relationships visually.'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add database' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add container' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeEnabled();

    rerender(<DashboardFooter {...props} isAIFeaturesEnabled />);
    expect(screen.getByRole('button', { name: 'Try Data Modeler (preview)' })).toBeEnabled();
    rerender(<DashboardFooter {...props} isAIFeaturesEnabled={false} />);
    expect(screen.queryByRole('button', { name: 'Try Data Modeler (preview)' })).not.toBeInTheDocument();
});
