/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    createFocusOutlineStyle,
    Input,
    Link,
    makeStyles,
    shorthands,
    tokens,
    useAnnounce,
} from '@fluentui/react-components';
import { CheckmarkRegular, SearchRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { Fragment, type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { SelectableCard } from '../components/SelectableCard';
import { type ScenarioId } from '../models';
import { getScenarioList, type ScenarioBadge, type ScenarioListItem, type ScenarioTag } from '../scenarios';

/** The fallback scenario has no trait chip and stays visible regardless of the text or trait filters. */
const FALLBACK_SCENARIO: ScenarioId = 'other';
/** Chips are grouped by color so related traits sit together: access patterns, write pressure, read scaling. */
const TONE_ORDER: ScenarioBadge['tone'][] = ['info', 'warn', 'success'];
/** Shared batch so a newer result summary replaces one still queued from a previous keystroke or click. */
const RESULTS_ANNOUNCEMENT = 'workload-results';

function filterScenarios(scenarios: ScenarioListItem[], filter: string, tags: ScenarioTag[]): ScenarioListItem[] {
    const q = filter.trim().toLowerCase();
    return scenarios.filter(
        (s) =>
            s.id === FALLBACK_SCENARIO ||
            ((tags.length === 0 || tags.includes(s.badge.tag)) &&
                (!q ||
                    s.title.toLowerCase().includes(q) ||
                    s.description.toLowerCase().includes(q) ||
                    s.searchTerms.includes(q))),
    );
}

function summarizeResults(visible: ScenarioListItem[]): string {
    // The custom workload is always shown, so it never counts as a match. Naming predefined scenarios keeps the count
    // accurate next to that extra card, including when it is the only card a search leaves visible.
    const matchCount = visible.filter((s) => s.id !== FALLBACK_SCENARIO).length;
    return matchCount === 0
        ? l10n.t('No predefined scenarios match your filter. You can still choose a custom workload.')
        : matchCount === 1
          ? l10n.t('1 matching predefined scenario')
          : l10n.t('{count} matching predefined scenarios', { count: matchCount });
}

/**
 * Step 1 — Workload. Self-contained: it only needs the currently selected
 * scenario and a callback to change it. No wizard-navigation logic lives here.
 */

const useStyles = makeStyles({
    list: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: tokens.spacingHorizontalM,
        '@media (max-width: 520px)': {
            gridTemplateColumns: '1fr',
        },
    },
    // Search and trait chips share one panel so they read as a single filter control.
    filterBar: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: tokens.spacingHorizontalM,
        rowGap: tokens.spacingVerticalS,
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        marginBottom: tokens.spacingVerticalL,
        borderRadius: tokens.borderRadiusLarge,
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    },
    // Fixed so the box never resizes as chips are toggled or Clear all appears.
    search: {
        flex: '0 0 260px',
        width: '260px',
    },
    traits: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        flex: '1 1 0',
        minWidth: 0,
        rowGap: tokens.spacingVerticalXS,
        columnGap: tokens.spacingHorizontalS,
    },
    group: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalXS,
        // Native <fieldset> grouping without its default frame.
        minWidth: 0,
        margin: 0,
        padding: 0,
        ...shorthands.borderStyle('none'),
    },
    divider: {
        alignSelf: 'stretch',
        width: '1px',
        minHeight: '16px',
        marginBlock: tokens.spacingVerticalXXS,
        backgroundColor: tokens.colorNeutralStroke2,
    },
    clear: {
        marginInlineStart: 'auto',
        fontSize: tokens.fontSizeBase200,
        whiteSpace: 'nowrap',
    },
    // An unstyled button around the same Badge the cards use, so an unselected chip looks exactly like a card badge.
    chip: {
        position: 'relative',
        display: 'inline-flex',
        margin: 0,
        padding: 0,
        cursor: 'pointer',
        backgroundColor: 'transparent',
        borderRadius: tokens.borderRadiusCircular,
        ...shorthands.borderStyle('none'),
        ':hover': { filter: 'brightness(1.15)' },
        ...createFocusOutlineStyle({ style: { outlineRadius: tokens.borderRadiusCircular } }),
    },
    meta: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        marginTop: tokens.spacingVerticalXS,
        flexWrap: 'wrap',
    },
    hint: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    resultStatus: {
        color: tokens.colorNeutralForeground3,
        marginBottom: tokens.spacingVerticalS,
    },
});

// Fluent's "informative" badge is grey, so info traits use the brand (blue) color.
const BADGE_COLOR: Record<ScenarioBadge['tone'], 'brand' | 'warning' | 'success'> = {
    info: 'brand',
    warn: 'warning',
    success: 'success',
};

export interface WorkloadPageProps {
    scenario?: ScenarioId;
    onPickScenario: (scenario: ScenarioId) => void;
}

export function WorkloadPage({ scenario, onPickScenario }: WorkloadPageProps) {
    const styles = useStyles();
    const groupName = useId();
    const { announce } = useAnnounce();
    const resultSummaryId = useId();
    const searchHintId = useId();
    const [filter, setFilter] = useState('');
    const [tags, setTags] = useState<ScenarioTag[]>([]);
    // Clear all stays visible while focused, so clearing never hides the element that has focus.
    const [clearFocused, setClearFocused] = useState(false);
    // Roving tabindex: the chip row is one Tab stop; arrow keys move between chips.
    const [activeChip, setActiveChip] = useState(0);
    const chipRefs = useRef<(HTMLElement | null)[]>([]);
    const searchRef = useRef<HTMLInputElement>(null);
    const hasFilters = filter !== '' || tags.length > 0;
    const scenarios = useMemo(() => getScenarioList(), []);
    // One chip per distinct trait, grouped by color and kept in catalog order within each group.
    const traitGroups = useMemo(() => {
        const seen = new Map<ScenarioTag, ScenarioBadge>();
        for (const s of scenarios) {
            if (s.id !== FALLBACK_SCENARIO && !seen.has(s.badge.tag)) seen.set(s.badge.tag, s.badge);
        }
        const groupLabels: Record<ScenarioBadge['tone'], string> = {
            info: l10n.t('Access patterns'),
            warn: l10n.t('Write and storage pressure'),
            success: l10n.t('Read scaling'),
        };
        let index = 0;
        return TONE_ORDER.map((tone) => ({
            tone,
            label: groupLabels[tone],
            options: [...seen.values()]
                .filter((option) => option.tone === tone)
                .map((option) => ({ ...option, index: index++ })),
        })).filter((group) => group.options.length > 0);
    }, [scenarios]);
    const chipCount = traitGroups.reduce((count, group) => count + group.options.length, 0);

    const visible = useMemo(() => filterScenarios(scenarios, filter, tags), [filter, tags, scenarios]);
    const resultSummary = summarizeResults(visible);

    // Typing and trait chips share this path.
    // A search edit is always announced, even when the count text is unchanged (e.g. "iot" -> "clickstream").
    // Chips already report their pressed state, so they only add a changed count.
    const applyFilters = (nextFilter: string, nextTags: ScenarioTag[]) => {
        const nextSummary = summarizeResults(filterScenarios(scenarios, nextFilter, nextTags));
        setFilter(nextFilter);
        setTags(nextTags);
        if (nextFilter !== filter || nextSummary !== resultSummary) {
            announce(nextSummary, { polite: true, batchId: RESULTS_ANNOUNCEMENT });
        }
    };

    const toggleTag = (tag: ScenarioTag) =>
        applyFilters(filter, tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]);

    // Clear all hides itself, so focus returns to the search box. A separate announcement would be cut off by that
    // focus move, so the search box is described by the result summary, which is read as part of the focus change.
    const clearFilters = () => {
        // Supersede any filter feedback Fluent still has queued, so a stale count is not read after the restored one.
        // Fluent replaces the queued message of the same batch and skips empty messages when speaking.
        announce('', { polite: true, batchId: RESULTS_ANNOUNCEMENT });
        // Commit the cleared value and summary first, so the search box is already current when focus lands on it.
        flushSync(() => {
            setFilter('');
            setTags([]);
        });
        searchRef.current?.focus();
    };

    const onChipKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        let next: number;
        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowDown':
                next = (activeChip + 1) % chipCount;
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                next = (activeChip - 1 + chipCount) % chipCount;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = chipCount - 1;
                break;
            default:
                return;
        }
        event.preventDefault();
        setActiveChip(next);
        chipRefs.current[next]?.focus();
    };

    return (
        <div>
            <div className={styles.filterBar}>
                <Input
                    ref={searchRef}
                    className={styles.search}
                    contentBefore={<SearchRegular />}
                    placeholder={l10n.t('Filter scenarios…')}
                    aria-describedby={`${resultSummaryId} ${searchHintId}`}
                    value={filter}
                    onChange={(_, data) => applyFilters(data.value, tags)}
                />
                {/* `hidden` keeps the hint out of layout, so it cannot pull a screen reader's cursor off-screen. */}
                <span id={searchHintId} hidden>
                    {l10n.t('Scenarios filter as you type.')}
                </span>
                <div
                    className={styles.traits}
                    role="toolbar"
                    aria-label={l10n.t('Filter by workload trait')}
                    onKeyDown={onChipKeyDown}
                >
                    {traitGroups.map((group, groupIndex) => (
                        <Fragment key={group.tone}>
                            {groupIndex > 0 ? <span className={styles.divider} aria-hidden={true} /> : null}
                            <fieldset className={styles.group} aria-label={group.label}>
                                {group.options.map(({ index, ...option }) => {
                                    const selected = tags.includes(option.tag);
                                    return (
                                        <button
                                            key={option.tag}
                                            ref={(element) => {
                                                chipRefs.current[index] = element;
                                            }}
                                            type="button"
                                            className={styles.chip}
                                            aria-pressed={selected}
                                            tabIndex={index === activeChip ? 0 : -1}
                                            onFocus={() => setActiveChip(index)}
                                            onClick={() => toggleTag(option.tag)}
                                        >
                                            {/* Selected traits switch from the card's tint badge to the filled one. */}
                                            <Badge
                                                appearance={selected ? 'filled' : 'tint'}
                                                color={BADGE_COLOR[option.tone]}
                                                icon={selected ? <CheckmarkRegular /> : undefined}
                                            >
                                                {option.text}
                                            </Badge>
                                        </button>
                                    );
                                })}
                            </fieldset>
                        </Fragment>
                    ))}
                </div>
                {/* Always laid out so the chips never reflow; hidden (and so unfocusable) while nothing is filtered. */}
                <Link
                    as="button"
                    className={styles.clear}
                    style={{ visibility: hasFilters || clearFocused ? 'visible' : 'hidden' }}
                    aria-description={l10n.t('Clear the search text and selected filters')}
                    onFocus={() => setClearFocused(true)}
                    onBlur={() => setClearFocused(false)}
                    onClick={clearFilters}
                >
                    {l10n.t('Clear all')}
                </Link>
            </div>
            {/* Not a live region: edits announce it explicitly, and the search box reads it as its description. */}
            <div id={resultSummaryId} className={styles.resultStatus}>
                {resultSummary}
            </div>
            <div className={styles.list} role="radiogroup" aria-label={l10n.t('Workload scenarios')}>
                {visible.map((s) => (
                    <SelectableCard
                        key={s.id}
                        name={groupName}
                        value={s.id}
                        selected={scenario === s.id}
                        onSelect={() => onPickScenario(s.id)}
                        title={s.title}
                        description={s.description}
                        meta={
                            s.hint || s.badge ? (
                                <span className={styles.meta}>
                                    <Badge appearance="tint" color={BADGE_COLOR[s.badge.tone]}>
                                        {s.badge.text}
                                    </Badge>
                                    {s.hint ? <span className={styles.hint}>{s.hint}</span> : null}
                                </span>
                            ) : undefined
                        }
                    />
                ))}
            </div>
        </div>
    );
}
