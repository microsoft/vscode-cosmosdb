/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Input, makeStyles, Text, tokens } from '@fluentui/react-components';
import { SearchRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useMemo, useState } from 'react';
import { SelectableCard } from '../components/SelectableCard';
import { type ScenarioId } from '../models';
import { getScenarioList, type ScenarioBadge } from '../scenarios';

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
    search: {
        marginBottom: tokens.spacingVerticalL,
        maxWidth: '420px',
        width: '100%',
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

const BADGE_COLOR: Record<ScenarioBadge['tone'], 'informative' | 'warning' | 'success'> = {
    info: 'informative',
    warn: 'warning',
    success: 'success',
};

export interface WorkloadPageProps {
    scenario?: ScenarioId;
    onPickScenario: (scenario: ScenarioId) => void;
}

export function WorkloadPage({ scenario, onPickScenario }: WorkloadPageProps) {
    const styles = useStyles();
    const [filter, setFilter] = useState('');
    const scenarios = useMemo(() => getScenarioList(), []);

    const visible = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) {
            return scenarios;
        }
        return scenarios.filter(
            (s) =>
                s.title.toLowerCase().includes(q) ||
                s.description.toLowerCase().includes(q) ||
                s.searchTerms.includes(q),
        );
    }, [filter, scenarios]);

    return (
        <div>
            <Input
                className={styles.search}
                contentBefore={<SearchRegular />}
                placeholder={l10n.t('Filter scenarios…')}
                value={filter}
                onChange={(_, data) => setFilter(data.value)}
            />

            {visible.length === 0 ? (
                <Text className={styles.empty}>{l10n.t('No scenarios match your filter.')}</Text>
            ) : (
                <div className={styles.list} role="radiogroup" aria-label={l10n.t('Workload scenarios')}>
                    {visible.map((s) => (
                        <SelectableCard
                            key={s.id}
                            selected={scenario === s.id}
                            onSelect={() => onPickScenario(s.id)}
                            title={s.title}
                            description={s.description}
                            ariaLabel={s.title}
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
