/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCORING_WEIGHTS } from '../../../../dataModeling/scoring';
import { redistribute, WeightSliders } from './WeightSliders';

describe('WeightSliders redistribution', () => {
    it('preserves the closest equal defaults without precision loss', () => {
        expect(DEFAULT_SCORING_WEIGHTS).toEqual({ read: 33.34, write: 33.33, storage: 33.33 });
        for (const key of ['read', 'write', 'storage'] as const) {
            expect(redistribute(DEFAULT_SCORING_WEIGHTS, key, DEFAULT_SCORING_WEIGHTS[key])).toEqual(
                DEFAULT_SCORING_WEIGHTS,
            );
        }
    });

    it('clamps the changed value and splits an empty remainder evenly at the extremes', () => {
        expect(redistribute(DEFAULT_SCORING_WEIGHTS, 'read', 110)).toEqual({ read: 100, write: 0, storage: 0 });
        expect(redistribute({ read: 100, write: 0, storage: 0 }, 'read', -10)).toEqual({
            read: 0,
            write: 50,
            storage: 50,
        });
        expect(redistribute({ read: 100, write: 0, storage: 0 }, 'read', 99.99)).toEqual({
            read: 99.99,
            write: 0.01,
            storage: 0,
        });
        expect(redistribute({ read: 60, write: 30, storage: 10 }, 'read', 20)).toEqual({
            read: 20,
            write: 60,
            storage: 20,
        });
    });

    it('maintains exactly 10000 basis points through repeated changes across the full range', () => {
        let weights = { ...DEFAULT_SCORING_WEIGHTS };
        for (const key of ['read', 'write', 'storage'] as const) {
            for (let value = 0; value <= 10000; value++) {
                weights = redistribute(weights, key, value / 100);
                expect(weights[key]).toBe(value / 100);
                expect(Object.values(weights).reduce((sum, weight) => sum + Math.round(weight * 100), 0)).toBe(10000);
                expect(Object.values(weights).every((weight) => weight >= 0 && weight <= 100)).toBe(true);
            }
        }
    });

    it('provides localized accessible names, keyboard focus, and hundredth-percent input changes', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<WeightSliders weights={DEFAULT_SCORING_WEIGHTS} onChange={onChange} />);
        for (const label of ['Read / query alignment', 'Write distribution', 'Storage & growth']) {
            const slider = screen.getByRole('slider', { name: label });
            expect(screen.getByText(label)).toBeVisible();
            expect(slider).toHaveAccessibleName(label);
            expect(slider).toHaveAttribute('step', '0.01');
        }
        const read = screen.getByRole('slider', { name: 'Read / query alignment' });
        expect(read).toHaveValue('33.34');
        expect(read).toHaveAttribute('aria-valuetext', '33.34%');
        await user.tab();
        expect(read).toHaveFocus();
        // jsdom does not implement native range keyboard increments; dispatch the resulting input change.
        fireEvent.change(read, { target: { value: '33.35' } });
        expect(onChange).toHaveBeenLastCalledWith({ read: 33.35, write: 33.33, storage: 33.32 });
    });
});
