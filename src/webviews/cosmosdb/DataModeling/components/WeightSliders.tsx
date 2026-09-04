/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Slider, Text, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type ScoringWeights } from '../models';

/**
 * Scoring-priority sliders (read / write / storage). Shared by the Review and
 * Result pages so both drive the same normalized weighting. The three values are
 * percentages that always total 100%: moving one slider redistributes the
 * remainder across the other two in proportion to their current values.
 */

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    row: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
    },
    head: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    hint: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
});

export interface WeightSlidersProps {
    weights: ScoringWeights;
    onChange: (weights: ScoringWeights) => void;
}

const WEIGHT_KEYS = ['read', 'write', 'storage'] as const;

/**
 * Set one weight to `rawValue` (clamped to 0–100) and spread the rest across the other two so the
 * three always sum to 100. The remainder is split in proportion to the other two current values;
 * when both are zero it is split as evenly as possible.
 */
function redistribute(weights: ScoringWeights, changed: keyof ScoringWeights, rawValue: number): ScoringWeights {
    const value = Math.min(100, Math.max(0, Math.round(rawValue)));
    const [otherA, otherB] = WEIGHT_KEYS.filter((k) => k !== changed);
    const remaining = 100 - value;
    const otherTotal = weights[otherA] + weights[otherB];

    const next: ScoringWeights = { ...weights, [changed]: value };
    if (otherTotal === 0) {
        next[otherA] = Math.round(remaining / 2);
    } else {
        next[otherA] = Math.round((weights[otherA] / otherTotal) * remaining);
    }
    // Give the last slider whatever is left, so the three always sum to exactly 100.
    next[otherB] = remaining - next[otherA];
    return next;
}

export function WeightSliders({ weights, onChange }: WeightSlidersProps) {
    const styles = useStyles();

    const row = (label: string, key: keyof ScoringWeights, value: number, hint: string) => (
        <div className={styles.row}>
            <div className={styles.head}>
                <Text weight="semibold">{label}</Text>
                <Text>{`${value}%`}</Text>
            </div>
            <Slider
                min={0}
                max={100}
                value={value}
                onChange={(_, data) => onChange(redistribute(weights, key, data.value))}
            />
            <Text className={styles.hint}>{hint}</Text>
        </div>
    );

    return (
        <div className={styles.root}>
            {row(
                l10n.t('Read / query alignment'),
                'read',
                weights.read,
                l10n.t('Favor single-partition reads for your dominant query.'),
            )}
            {row(
                l10n.t('Write distribution'),
                'write',
                weights.write,
                l10n.t('Avoid hot partitions on the write path (key for IoT / ingestion).'),
            )}
            {row(
                l10n.t('Storage & growth'),
                'storage',
                weights.storage,
                l10n.t('Stay under the 20 GB per-logical-partition limit.'),
            )}
            <Text className={styles.hint}>{l10n.t('Priorities always total 100%')}</Text>
        </div>
    );
}
