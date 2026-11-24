/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { AriaLiveAnnouncer } from '@fluentui/react-components';
import type * as FluentUI from '@fluentui/react-components';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ScenarioId } from '../models';
import { getScenarioList, TRAIT_TONE } from '../scenarios';
import { WorkloadPage } from './WorkloadPage';

const announce = vi.hoisted(() => vi.fn());
// Most tests observe announcements through a spy; `announcer.real` switches to Fluent's own announcer.
const announcer = vi.hoisted(() => ({ real: false }));
vi.mock('@fluentui/react-components', async (importOriginal) => {
    const actual = await importOriginal<typeof FluentUI>();
    return {
        ...actual,
        useAnnounce: () => (announcer.real ? actual.useAnnounce() : { announce }),
    };
});

beforeEach(() => {
    announce.mockReset();
    announcer.real = false;
});

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
/**
 * Records what a screen reader would read from the search box at the instant it gains focus, and whether Clear all
 * is still visible then. Clear all relies on that focus change, so the box must already reflect the cleared state.
 */
function snapshotSearchOnFocus() {
    const search = searchBox() as HTMLInputElement;
    const clear = clearButton();
    const snapshot = { value: '', description: '', clearVisibility: '' };
    search.addEventListener(
        'focus',
        () => {
            snapshot.value = search.value;
            snapshot.description = (search.getAttribute('aria-describedby') ?? '')
                .split(' ')
                .map((id) => document.getElementById(id)?.textContent)
                .join(' ');
            snapshot.clearVisibility = clear.style.visibility;
        },
        { once: true },
    );
    return snapshot;
}

describe('WorkloadPage result status', () => {
    const allMatching = () => `${getScenarioList().length - 1} matching predefined scenarios`;
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
        // The always-shown custom card is not counted, and the wording says the count covers predefined scenarios.
        expect(screen.getAllByRole('radio')).toHaveLength(getScenarioList().length);
        await user.click(search);
        expect(announce).not.toHaveBeenCalled();

        fireEvent.change(search, { target: { value: 'transactions' } });
        expectResult('2 matching predefined scenarios');
        fireEvent.change(search, { target: { value: 'iot' } });
        expectResult('1 matching predefined scenario');
        announce.mockClear();
        // Same count, different card: the new search still gets feedback.
        fireEvent.change(search, { target: { value: 'clickstream' } });
        expect(announce).toHaveBeenCalledExactlyOnceWith('1 matching predefined scenario', expect.anything());
        expectResult('1 matching predefined scenario');

        fireEvent.change(search, { target: { value: 'no matching workload' } });
        expectResult('No predefined scenarios match your filter. You can still choose a custom workload.');
        expect(screen.getAllByRole('radio')).toHaveLength(1);
        // Searching for the custom card itself leaves it visible without claiming that it does not match.
        fireEvent.change(search, { target: { value: 'None of these fit' } });
        expectResult('No predefined scenarios match your filter. You can still choose a custom workload.');
        expect(screen.getAllByRole('radio')).toEqual([screen.getByRole('radio', { name: 'None of these fit' })]);
        expect(search).toHaveFocus();
    });

    it('announces filter chips only when the count changes and Clear all through the focused search box', async () => {
        const user = userEvent.setup();
        render(<Workload />);
        const filterChip = toolbar().getByRole('button', { name: 'Write-heavy' });
        await user.click(filterChip);
        expectResult('2 matching predefined scenarios');
        expect(filterChip).toHaveFocus();

        const search = searchBox();
        await user.type(search, 'clickstream');
        expectResult('1 matching predefined scenario');
        // Toggling the chip off and on keeps the count, so the pressed state alone is the feedback.
        const announced = announce.mock.calls.length;
        await user.click(filterChip);
        expect(filterChip).toHaveAttribute('aria-pressed', 'false');
        await user.click(filterChip);
        expect(filterChip).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('1 matching predefined scenario')).toBeVisible();
        // A separate announcement would be cut off by the focus move, so the search box's description carries the
        // result instead. It must already be current when focus lands, and Clear all must not hide while focused.
        const onFocus = snapshotSearchOnFocus();
        await user.click(clearButton());
        expect(onFocus).toEqual({
            value: '',
            description: `${allMatching()} Scenarios filter as you type.`,
            clearVisibility: 'visible',
        });
        expect(search).toHaveFocus();
        expect(clearButton).toThrow();
        expect(screen.getByText('Clear all')).toHaveStyle({ visibility: 'hidden' });
        expect(screen.getByText(allMatching())).toBeVisible();
        // Clear all speaks no count of its own; it only blanks the shared batch to drop stale queued feedback.
        expect(announce).toHaveBeenCalledTimes(announced + 1);
        expect(announce).toHaveBeenLastCalledWith('', expect.objectContaining({ polite: true }));
        // One batch for every source, so a newer summary replaces a stale one still waiting to be read.
        const batches = new Set(announce.mock.calls.map(([, options]) => (options as { batchId?: string }).batchId));
        expect([...batches]).toEqual([expect.any(String)]);
    });

    it('drops filter feedback still queued in the real announcer when Clear all is activated', async () => {
        // Without ariaNotify, Fluent queues messages that arrive while one is being read and delivers them later.
        expect('ariaNotify' in document).toBe(false);
        announcer.real = true;
        render(
            <AriaLiveAnnouncer>
                <Workload />
            </AriaLiveAnnouncer>,
        );
        const liveRegion = document.querySelector<HTMLElement>('[aria-live]')!;
        const delivered: string[] = [];
        new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    const text = (node as HTMLElement).innerText;
                    if (text) delivered.push(text);
                }
            }
        }).observe(liveRegion, { childList: true });
        const flush = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

        const search = searchBox();
        fireEvent.change(search, { target: { value: 'iot' } });
        await flush(50);
        expect(delivered).toEqual(['1 matching predefined scenario. ']);
        // Arrives while the first message is still being read, so Fluent holds it for the next cycle.
        fireEvent.change(search, { target: { value: 'transactions' } });
        fireEvent.click(clearButton());
        expect(search).toHaveFocus();
        await flush(700);
        // The restored count is read from the focused search box; the stale filtered count must never follow it.
        expect(delivered).toEqual(['1 matching predefined scenario. ']);
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

describe('WorkloadPage filter chips', () => {
    const shownIds = () => {
        const ids = new Set(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value')));
        return getScenarioList()
            .filter((s) => ids.has(s.id))
            .map((s) => s.id);
    };
    const chip = (name: string) => toolbar().getByRole('button', { name });

    it('sits beside the search box and groups one chip per filter by color, excluding the fallback', () => {
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

    it('narrows scenarios by the chosen filters with OR and keeps the fallback visible', async () => {
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

    it('combines filter chips with the text filter while keeping the custom workload visible and selectable', async () => {
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

    it('gives each filter one color in the shared scheme', () => {
        const byTone = (tone: string) =>
            Object.entries(TRAIT_TONE)
                .filter(([, value]) => value === tone)
                .map(([tag]) => tag)
                .sort();
        expect(byTone('warn')).toEqual(['appendOnly', 'largeDocs', 'writeHeavy']);
        expect(byTone('success')).toEqual(['cacheable', 'fanOutReads']);
        for (const scenario of getScenarioList()) expect(scenario.badge.tone).toBe(TRAIT_TONE[scenario.badge.tag]);
    });

    it('shows Clear all only while filtering, and resets text and filters without changing the selection', async () => {
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
        // Clearing a no-match search: the box must not still read "No predefined scenarios match…" when focus lands.
        const onFocus = snapshotSearchOnFocus();
        await user.keyboard('{Enter}');
        expect(onFocus).toEqual({
            value: '',
            description: `${getScenarioList().length - 1} matching predefined scenarios Scenarios filter as you type.`,
            clearVisibility: 'visible',
        });
        expect(search).toHaveFocus();
        expect(search).toHaveValue('');
        expect(screen.getAllByRole('radio')).toHaveLength(getScenarioList().length);
    });
});
