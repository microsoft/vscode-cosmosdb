/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { type ScenarioId } from '../models';
import { getScenarioList } from '../scenarios';
import { WorkloadPage } from './WorkloadPage';

function Workload({
    initialScenario,
    onPick = () => {},
}: {
    initialScenario?: ScenarioId;
    onPick?: (scenario: ScenarioId) => void;
}) {
    const [scenario, setScenario] = useState(initialScenario);
    return (
        <>
            <WorkloadPage
                scenario={scenario}
                onPickScenario={(next) => {
                    setScenario(next);
                    onPick(next);
                }}
            />
            <button type="button">After workloads</button>
        </>
    );
}

describe('WorkloadPage native radio cards', () => {
    it('provides a single Tab entry with arrow navigation, wrapping, and Space selection', async () => {
        const user = userEvent.setup();
        render(<Workload />);
        const group = within(screen.getByRole('radiogroup', { name: 'Workload scenarios' }));
        const radios = group.getAllByRole('radio');
        expect(radios.every((radio) => radio.tagName === 'INPUT' && radio.getAttribute('type') === 'radio')).toBe(true);
        expect(new Set(radios.map((radio) => radio.getAttribute('name'))).size).toBe(1);
        expect(radios.every((radio) => !radio.hasAttribute('tabindex'))).toBe(true);
        expect(group.queryAllByRole('radio', { checked: true })).toHaveLength(0);
        await user.tab();
        expect(screen.getByRole('textbox', { name: 'Filter scenarios…' })).toHaveFocus();
        await user.tab();
        expect(radios[0]).toHaveFocus();
        await user.keyboard(' ');
        expect(radios[0]).toBeChecked();
        await user.keyboard('{ArrowRight}');
        expect(radios[1]).toHaveFocus();
        expect(radios[1]).toBeChecked();
        await user.keyboard('{ArrowDown}');
        expect(radios[2]).toHaveFocus();
        expect(radios[2]).toBeChecked();
        await user.keyboard('{ArrowLeft}{ArrowUp}');
        expect(radios[0]).toHaveFocus();
        expect(radios[0]).toBeChecked();
        await user.keyboard('{ArrowLeft}');
        expect(radios.at(-1)).toHaveFocus();
        expect(radios.at(-1)).toBeChecked();
        await user.keyboard('{ArrowRight}');
        expect(radios[0]).toBeChecked();
        await user.tab();
        expect(screen.getByRole('button', { name: 'After workloads' })).toHaveFocus();
        await user.tab({ shift: true });
        expect(radios[0]).toHaveFocus();
        await user.tab({ shift: true });
        expect(screen.getByRole('textbox', { name: 'Filter scenarios…' })).toHaveFocus();
    });

    it('enters at the selected option and exposes titles, descriptions, badges, and hints', async () => {
        const user = userEvent.setup();
        const scenario = getScenarioList().find((item) => item.id === 'iot')!;
        const onPick = vi.fn();
        render(<Workload initialScenario="iot" onPick={onPick} />);
        const radio = screen.getByRole('radio', { name: scenario.title });
        expect(screen.getByText(scenario.title)).toBeVisible();
        expect(radio).toHaveAccessibleName(scenario.title);
        expect(radio).toHaveAccessibleDescription(`${scenario.description} ${scenario.badge.text} ${scenario.hint}`);
        await user.tab();
        await user.tab();
        expect(radio).toHaveFocus();
        await user.click(screen.getByText(scenario.title));
        expect(radio).toBeChecked();
        expect(onPick).not.toHaveBeenCalled();
        const first = getScenarioList()[0];
        await user.click(screen.getByText(first.description));
        expect(screen.getByRole('radio', { name: first.title })).toBeChecked();
        expect(onPick).toHaveBeenCalledExactlyOnceWith(first.id);
    });

    it('keeps a keyboard entry when filtering hides the selection without choosing a scenario automatically', async () => {
        const user = userEvent.setup();
        const onPick = vi.fn();
        render(<Workload initialScenario="chat" onPick={onPick} />);
        const filter = screen.getByRole('textbox', { name: 'Filter scenarios…' });
        await user.type(filter, 'transactions');
        const group = within(screen.getByRole('radiogroup', { name: 'Workload scenarios' }));
        const radios = group.getAllByRole('radio');
        expect(radios).toHaveLength(2);
        expect(onPick).not.toHaveBeenCalled();
        await user.tab();
        expect(radios[0]).toHaveFocus();
        expect(radios[0]).not.toBeChecked();
        await user.keyboard('{ArrowRight}');
        expect(radios[1]).toHaveFocus();
        expect(radios[1]).toBeChecked();
        expect(onPick).toHaveBeenCalledExactlyOnceWith('ledger');
        await user.tab();
        expect(screen.getByRole('button', { name: 'After workloads' })).toHaveFocus();
        await user.clear(filter);
        expect(screen.getByRole('radio', { name: 'Financial Ledger' })).toBeChecked();
        await user.tab();
        expect(screen.getByRole('radio', { name: 'Financial Ledger' })).toHaveFocus();
    });

    it('skips an empty filtered group and restores the saved selection when the filter is cleared', async () => {
        const user = userEvent.setup();
        const onPick = vi.fn();
        render(<Workload initialScenario="chat" onPick={onPick} />);
        const filter = screen.getByRole('textbox', { name: 'Filter scenarios…' });
        await user.type(filter, 'no matching workload');
        expect(screen.getByText('No scenarios match your filter.')).toBeVisible();
        expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
        await user.tab();
        expect(screen.getByRole('button', { name: 'After workloads' })).toHaveFocus();
        await user.clear(filter);
        const selected = screen.getByRole('radio', { name: 'Chat & Sessions' });
        expect(selected).toBeChecked();
        await user.tab();
        expect(selected).toHaveFocus();
        expect(onPick).not.toHaveBeenCalled();
    });
});
