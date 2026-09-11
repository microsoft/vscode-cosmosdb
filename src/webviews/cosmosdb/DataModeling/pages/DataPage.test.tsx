/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createBlankContainer, type DataModel } from '../dataModel';
import { DataPage } from './DataPage';

describe('DataPage property types', () => {
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
