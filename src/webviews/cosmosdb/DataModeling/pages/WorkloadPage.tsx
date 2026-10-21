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
    Text,
    tokens,
} from '@fluentui/react-components';
import { CheckmarkRegular, SearchRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { Fragment, type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import { SelectableCard } from '../components/SelectableCard';
import { type ScenarioId } from '../models';
import { getScenarioList, type ScenarioBadge, type ScenarioTag } from '../scenarios';

/** The fallback scenario is not a workload trait, so it has no chip and stays visible while traits are selected. */
const FALLBACK_SCENARIO: ScenarioId = 'other';
/** Chips are grouped by color so related traits sit together: access patterns, write pressure, read scaling. */
const TONE_ORDER: ScenarioBadge['tone'][] = ['info', 'warn', 'success'];

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
    empty: {
        color: tokens.colorNeutralForeground3,
        padding: tokens.spacingVerticalL,
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
    const [filter, setFilter] = useState('');
    const [tags, setTags] = useState<ScenarioTag[]>([]);
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

    const visible = useMemo(() => {
        const q = filter.trim().toLowerCase();
        return scenarios.filter(
            (s) =>
                (tags.length === 0 || s.id === FALLBACK_SCENARIO || tags.includes(s.badge.tag)) &&
                (!q ||
                    s.title.toLowerCase().includes(q) ||
                    s.description.toLowerCase().includes(q) ||
                    s.searchTerms.includes(q)),
        );
    }, [filter, tags, scenarios]);

    const toggleTag = (tag: ScenarioTag) =>
        setTags((previous) => (previous.includes(tag) ? previous.filter((t) => t !== tag) : [...previous, tag]));

    // The button unmounts once nothing is filtered, so hand focus to the search box instead of losing it.
    const clearFilters = () => {
        setFilter('');
        setTags([]);
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
                    aria-label={l10n.t('Filter scenarios…')}
                    value={filter}
                    onChange={(_, data) => setFilter(data.value)}
                />
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
                    style={{ visibility: hasFilters ? 'visible' : 'hidden' }}
                    aria-description={l10n.t('Clear the search text and selected traits')}
                    onClick={clearFilters}
                >
                    {l10n.t('Clear all')}
                </Link>
            </div>
            {visible.length === 0 ? (
                <Text className={styles.empty}>{l10n.t('No scenarios match your filter.')}</Text>
            ) : (
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
            )}
        </div>
    );
}
