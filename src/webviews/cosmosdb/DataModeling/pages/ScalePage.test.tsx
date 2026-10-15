/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { createBlankContainer, type DataModel } from '../dataModel';
import { ScalePage } from './ScalePage';

function Scale() {
    const [model, setModel] = useState<DataModel>(() => {
        const container = createBlankContainer();
        container.scale.candidates = [];
        return { containers: [container], activeContainerId: container.id };
    });
    return (
        <>
            <button type="button">Before scale</button>
            <ScalePage model={model} onChange={setModel} />
            <button type="button">After scale</button>
        </>
    );
}

describe('ScalePage native radio cards', () => {
    it('keeps three independent groups with one Tab stop each and arrow-key selection', async () => {
        const user = userEvent.setup();
        render(<Scale />);
        const groups = screen.getAllByRole('radiogroup');
        const groupNames = groups.map((group) => {
            const radios = within(group).getAllByRole('radio');
            expect(radios.every((radio) => radio.tagName === 'INPUT')).toBe(true);
            expect(new Set(radios.map((radio) => radio.getAttribute('name'))).size).toBe(1);
            return radios[0].getAttribute('name');
        });
        expect(new Set(groupNames).size).toBe(3);
        await user.tab();
        expect(screen.getByRole('button', { name: 'Before scale' })).toHaveFocus();
        await user.tab();
        const items = within(screen.getByRole('radiogroup', { name: 'Items per partition key value' }));
        expect(items.getByRole('radio', { name: '1K – 100K items' })).toHaveFocus();
        await user.keyboard('{ArrowRight}');
        expect(items.getByRole('radio', { name: '100K – 1M items' })).toHaveFocus();
        expect(items.getByRole('radio', { name: '100K – 1M items' })).toBeChecked();
        await user.tab();
        const writes = within(screen.getByRole('radiogroup', { name: 'Write distribution' }));
        expect(writes.getByRole('radio', { name: 'Even' })).toHaveFocus();
        await user.keyboard('{ArrowUp}');
        expect(writes.getByRole('radio', { name: 'Time-correlated' })).toHaveFocus();
        expect(writes.getByRole('radio', { name: 'Time-correlated' })).toBeChecked();
        await user.tab();
        const growth = within(screen.getByRole('radiogroup', { name: 'Data growth per PK value' }));
        expect(growth.getByRole('radio', { name: 'Grows slowly' })).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        const rapid = growth.getByRole('radio', { name: /^Grows rapidly/ });
        expect(rapid).toHaveFocus();
        expect(rapid).toBeChecked();
        const rapidTitle = growth.getByText(/^Grows rapidly/);
        expect(rapidTitle).toBeVisible();
        expect(rapid).toHaveAccessibleName(rapidTitle.textContent);
        expect(rapid).toHaveAccessibleDescription('1000+/day — needs HPK or bucketing');
        await user.tab();
        expect(screen.getByRole('button', { name: 'After scale' })).toHaveFocus();
        await user.tab({ shift: true });
        expect(rapid).toHaveFocus();
        await user.tab({ shift: true });
        expect(writes.getByRole('radio', { name: 'Time-correlated' })).toHaveFocus();
        await user.tab({ shift: true });
        expect(items.getByRole('radio', { name: '100K – 1M items' })).toHaveFocus();
    });

    it('does not join groups across separate Scale page instances', () => {
        render(
            <>
                <Scale />
                <Scale />
            </>,
        );
        const names = screen
            .getAllByRole('radiogroup')
            .map((group) => within(group).getAllByRole('radio')[0].getAttribute('name'));
        expect(new Set(names).size).toBe(6);
        for (const group of screen.getAllByRole('radiogroup')) {
            expect(within(group).getAllByRole('radio', { checked: true })).toHaveLength(1);
        }
    });
});
