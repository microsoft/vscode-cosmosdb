/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import type * as FluentUI from '@fluentui/react-components';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ScenarioId } from '../models';
import { getScenarioList, TRAIT_TONE } from '../scenarios';
import { WorkloadPage } from './WorkloadPage';

const announce = vi.hoisted(() => vi.fn());
vi.mock('@fluentui/react-components', async (importOriginal) => ({
    ...(await importOriginal<typeof FluentUI>()),
    useAnnounce: () => ({ announce }),
}));

beforeEach(() => announce.mockReset());

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

const toolbar = () => within(screen.getByRole('toolbar', { name: 'Filter by workload trait' }));
const firstChip = () => toolbar().getAllByRole('button')[0];
const clearButton = () => screen.getByRole('button', { name: 'Clear all' });
const searchBox = () => screen.getByPlaceholderText('Filter scenarios…');

describe('WorkloadPage result status', () => {
    const allMatching = () => `${getScenarioList().length - 1} matching scenarios`;
    // The visible count and the announcement come from the same edit, with no delay in between.
    const expectResult = (message: string) => {
        expect(screen.getByText(message)).toBeVisible();
        expect(announce).toHaveBeenLastCalledWith(message, expect.objectContaining({ polite: true }));
    };

    it('shows the matching count without a live region and announces every search edit', async () => {
        const user = userEvent.setup();
        const { container } = render(<Workload />);
        const search = searchBox();
        // Named by its placeholder alone (jsdom cannot compute that name), so screen readers read the label once.
        expect(search).not.toHaveAttribute('aria-label');
        expect(search).not.toHaveAttribute('aria-labelledby');
        // The current result is part of the description, so focusing the box reads it.
        expect(search).toHaveAccessibleDescription(`${allMatching()} Scenarios filter as you type.`);
        // The visible summary is not a live region, so only the explicit announcement is spoken.
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(container.querySelector('[aria-live]')).toBeNull();
        expect(screen.getByText(allMatching())).toBeVisible();
        await user.click(search);
        expect(announce).not.toHaveBeenCalled();

        fireEvent.change(search, { target: { value: 'transactions' } });
        expectResult('2 matching scenarios');
        fireEvent.change(search, { target: { value: 'iot' } });
        expectResult('1 matching scenario');
        announce.mockClear();
        // Same count, different card: the new search still gets feedback.
        fireEvent.change(search, { target: { value: 'clickstream' } });
        expect(announce).toHaveBeenCalledExactlyOnceWith('1 matching scenario', expect.anything());
        expectResult('1 matching scenario');

        fireEvent.change(search, { target: { value: 'no matching workload' } });
        expectResult('No scenarios match your filter. You can still choose a custom workload.');
        expect(screen.getAllByRole('radio')).toHaveLength(1);
        expect(search).toHaveFocus();
    });

    it('announces trait chips only when the count changes and Clear all through the focused search box', async () => {
        const user = userEvent.setup();
        render(<Workload />);
        const trait = toolbar().getByRole('button', { name: 'Write-heavy' });
        await user.click(trait);
        expectResult('2 matching scenarios');
        expect(trait).toHaveFocus();

        const search = searchBox();
        await user.type(search, 'clickstream');
        expectResult('1 matching scenario');
        // Toggling the chip off and on keeps the count, so the pressed state alone is the feedback.
        const announced = announce.mock.calls.length;
        await user.click(trait);
        expect(trait).toHaveAttribute('aria-pressed', 'false');
        await user.click(trait);
        expect(trait).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('1 matching scenario')).toBeVisible();
        // A separate announcement would be cut off by the focus move, so the search box's description carries the
        // result instead. Focus must leave Clear all while it is still visible: hiding a focused button makes screen
        // readers read it again.
        const clear = clearButton();
        let clearVisibilityOnFocus = '';
        search.addEventListener('focus', () => {
            clearVisibilityOnFocus = clear.style.visibility;
        });
        await user.click(clear);
        expect(clearVisibilityOnFocus).toBe('visible');
        expect(search).toHaveFocus();
        expect(search).toHaveAccessibleDescription(`${allMatching()} Scenarios filter as you type.`);
        expect(screen.getByText(allMatching())).toBeVisible();
        expect(announce).toHaveBeenCalledTimes(announced);
        // One batch for every source, so a newer summary replaces a stale one still waiting to be read.
        const batches = new Set(announce.mock.calls.map(([, options]) => (options as { batchId?: string }).batchId));
        expect([...batches]).toEqual([expect.any(String)]);
    });
});

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
        expect(searchBox()).toHaveFocus();
        await user.tab();
        expect(firstChip()).toHaveFocus();
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
        expect(firstChip()).toHaveFocus();
        await user.tab({ shift: true });
        expect(searchBox()).toHaveFocus();
    });

    it('enters at the selected option and exposes titles, descriptions, badges, and hints', async () => {
        const user = userEvent.setup();
        const scenario = getScenarioList().find((item) => item.id === 'iot')!;
        const onPick = vi.fn();
        render(<Workload initialScenario="iot" onPick={onPick} />);
        const radio = screen.getByRole('radio', { name: scenario.title });
        expect(screen.getByText(scenario.title)).toBeVisible();
        // The radio alone speaks the card; the visible text it references is hidden so it is not read twice.
        expect(screen.getByText(scenario.title).closest('[aria-hidden="true"]')).toContainElement(
            screen.getByText(scenario.hint),
        );
        expect(radio).toHaveAccessibleName(scenario.title);
        expect(radio).toHaveAccessibleDescription(`${scenario.description} ${scenario.badge.text} ${scenario.hint}`);
        await user.tab();
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
        const filter = searchBox();
        await user.type(filter, 'transactions');
        const group = within(screen.getByRole('radiogroup', { name: 'Workload scenarios' }));
        const radios = group.getAllByRole('radio');
        expect(radios).toHaveLength(3);
        expect(onPick).not.toHaveBeenCalled();
        await user.tab();
        expect(firstChip()).toHaveFocus();
        await user.tab();
        expect(clearButton()).toHaveFocus();
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
        expect(firstChip()).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('radio', { name: 'Financial Ledger' })).toHaveFocus();
    });

    it('keeps the custom workload keyboard-accessible and restores the selection when the filter is cleared', async () => {
        const user = userEvent.setup();
        const onPick = vi.fn();
        render(<Workload initialScenario="chat" onPick={onPick} />);
        const filter = searchBox();
        await user.type(filter, 'no matching workload');
        const custom = getScenarioList().find((item) => item.id === 'other')!;
        const customRadio = screen.getByRole('radio', { name: custom.title });
        expect(screen.getByText(custom.title)).toBeVisible();
        expect(customRadio).toHaveAccessibleName(custom.title);
        expect(screen.getAllByRole('radio')).toEqual([customRadio]);
        await user.tab();
        expect(firstChip()).toHaveFocus();
        await user.tab();
        expect(clearButton()).toHaveFocus();
        await user.tab();
        expect(customRadio).toHaveFocus();
        expect(customRadio).not.toBeChecked();
        await user.tab();
        expect(screen.getByRole('button', { name: 'After workloads' })).toHaveFocus();
        await user.clear(filter);
        const selected = screen.getByRole('radio', { name: 'Chat & Sessions' });
        expect(selected).toBeChecked();
        await user.tab();
        expect(firstChip()).toHaveFocus();
        await user.tab();
        expect(selected).toHaveFocus();
        expect(onPick).not.toHaveBeenCalled();
    });
});

describe('WorkloadPage trait filter', () => {
    const shownIds = () => {
        const ids = new Set(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value')));
        return getScenarioList()
            .filter((s) => ids.has(s.id))
            .map((s) => s.id);
    };
    const chip = (name: string) => toolbar().getByRole('button', { name });

    it('sits beside the search box and groups one chip per trait by color, excluding the fallback', () => {
        render(<Workload />);
        const search = searchBox();
        expect(search.closest('div')).toContainElement(firstChip());
        const groups = toolbar().getAllByRole('group');
        expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
            'Access patterns',
            'Write and storage pressure',
            'Read scaling',
        ]);
        const names = (group: HTMLElement) =>
            within(group)
                .getAllByRole('button')
                .map((button) => button.textContent);
        expect(groups.map(names)).toEqual([
            ['Low latency', 'Transactional', 'Tenant isolation', 'Point reads', 'Read-heavy', 'Balanced'],
            ['Write-heavy', 'Large docs', 'Append-only'],
            ['Fan-out reads', 'Cacheable'],
        ]);
        const chips = toolbar().getAllByRole('button');
        expect(chips.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
        // Hidden rather than removed, so the chips do not reflow when it appears.
        expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
        expect(screen.getByText('Clear all')).toHaveStyle({ visibility: 'hidden' });
    });

    it('renders an unselected chip exactly like the card badge, and a selected one as the filled badge', async () => {
        const user = userEvent.setup();
        render(<Workload />);
        const badgeClass = () =>
            screen.getAllByText('Write-heavy').map((element) => element.closest('.fui-Badge')!.className);
        const [chipBadge, ...cardBadges] = badgeClass();
        expect(cardBadges).toHaveLength(2);
        expect(cardBadges.every((cardBadge) => cardBadge === chipBadge)).toBe(true);
        await user.click(chip('Write-heavy'));
        expect(chip('Write-heavy')).toHaveAccessibleName('Write-heavy');
        const [selectedBadge, ...unchangedCards] = badgeClass();
        expect(selectedBadge).not.toBe(chipBadge);
        expect(unchangedCards.every((cardBadge) => cardBadge === chipBadge)).toBe(true);
        expect(clearButton()).toHaveAccessibleDescription('Clear the search text and selected filters');
    });

    it('narrows scenarios by the chosen traits with OR and keeps the fallback visible', async () => {
        const user = userEvent.setup();
        const onPick = vi.fn();
        render(<Workload onPick={onPick} />);
        await user.click(chip('Write-heavy'));
        expect(chip('Write-heavy')).toHaveAttribute('aria-pressed', 'true');
        expect(shownIds()).toEqual(['iot', 'analytics', 'other']);
        await user.click(chip('Read-heavy'));
        expect(shownIds()).toEqual(['iot', 'analytics', 'cms', 'other']);
        await user.click(chip('Write-heavy'));
        expect(chip('Write-heavy')).toHaveAttribute('aria-pressed', 'false');
        expect(shownIds()).toEqual(['cms', 'other']);
        expect(onPick).not.toHaveBeenCalled();
    });

    it('combines traits with the text filter while keeping the custom workload visible and selectable', async () => {
        const user = userEvent.setup();
        const onPick = vi.fn();
        render(<Workload onPick={onPick} />);
        await user.click(chip('Write-heavy'));
        const search = searchBox();
        await user.type(search, 'clickstream');
        expect(shownIds()).toEqual(['analytics', 'other']);
        await user.clear(search);
        await user.type(search, 'no matching workload');
        expect(shownIds()).toEqual(['other']);
        expect(onPick).not.toHaveBeenCalled();
        const customRadio = screen.getByRole('radio');
        await user.click(customRadio);
        expect(customRadio).toBeChecked();
        expect(onPick).toHaveBeenCalledExactlyOnceWith('other');
    });

    it('is a single Tab stop with arrow, Home and End navigation across groups, and Space/Enter toggling', async () => {
        const user = userEvent.setup();
        render(<Workload />);
        const chips = toolbar().getAllByRole('button');
        await user.tab();
        await user.tab();
        expect(chips[0]).toHaveFocus();
        await user.keyboard('{ArrowRight}');
        expect(chips[1]).toHaveFocus();
        await user.keyboard(' ');
        expect(chips[1]).toHaveAttribute('aria-pressed', 'true');
        await user.keyboard('{Enter}');
        expect(chips[1]).toHaveAttribute('aria-pressed', 'false');
        await user.keyboard('{ArrowLeft}{ArrowLeft}');
        expect(chips.at(-1)).toHaveFocus();
        await user.keyboard('{Home}');
        expect(chips[0]).toHaveFocus();
        await user.keyboard('{End}');
        expect(chips.at(-1)).toHaveFocus();
        expect(chips.filter((button) => button.tabIndex === 0)).toEqual([chips.at(-1)]);
        await user.tab();
        expect(screen.getAllByRole('radio')[0]).toHaveFocus();
        await user.tab({ shift: true });
        expect(chips.at(-1)).toHaveFocus();
    });

    it('gives each trait one color in the shared scheme', () => {
        const byTone = (tone: string) =>
            Object.entries(TRAIT_TONE)
                .filter(([, value]) => value === tone)
                .map(([tag]) => tag)
                .sort();
        expect(byTone('warn')).toEqual(['appendOnly', 'largeDocs', 'writeHeavy']);
        expect(byTone('success')).toEqual(['cacheable', 'fanOutReads']);
        for (const scenario of getScenarioList()) expect(scenario.badge.tone).toBe(TRAIT_TONE[scenario.badge.tag]);
    });

    it('shows Clear all only while filtering, and resets text and traits without changing the selection', async () => {
        const user = userEvent.setup();
        const onPick = vi.fn();
        render(<Workload initialScenario="iot" onPick={onPick} />);
        const search = searchBox();
        await user.click(chip('Read-heavy'));
        await user.type(search, 'articles');
        expect(shownIds()).toEqual(['cms', 'other']);
        await user.click(clearButton());
        expect(search).toHaveValue('');
        expect(
            toolbar()
                .getAllByRole('button')
                .every((button) => button.getAttribute('aria-pressed') === 'false'),
        ).toBe(true);
        expect(shownIds()).toEqual(getScenarioList().map((s) => s.id));
        expect(screen.getByRole('radio', { name: 'IoT Device Telemetry' })).toBeChecked();
        expect(onPick).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
        // The link hides after clearing, so focus moves to the search box rather than the page body.
        expect(search).toHaveFocus();
    });

    it('clears from the keyboard and restores the catalog when only the custom workload matches', async () => {
        const user = userEvent.setup();
        render(<Workload />);
        const search = searchBox();
        await user.type(search, 'no matching workload');
        expect(shownIds()).toEqual(['other']);
        await user.tab();
        await user.tab();
        expect(clearButton()).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(search).toHaveFocus();
        expect(search).toHaveValue('');
        expect(screen.getAllByRole('radio')).toHaveLength(getScenarioList().length);
    });
});
