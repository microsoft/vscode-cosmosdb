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
