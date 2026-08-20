/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Slider, Text, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type ScoringWeights } from '../models';

/**
 * Scoring-priority sliders (read / write / storage). Shared by the Review and
 * Result pages so both drive the same normalized weighting. Percentages are
 * derived by normalizing the three raw values, matching how the ranking scores.
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

export function WeightSliders({ weights, onChange }: WeightSlidersProps) {
    const styles = useStyles();
    const total = weights.read + weights.write + weights.storage;
    const pct = (v: number): string => (total === 0 ? '0%' : `${Math.round((v / total) * 100)}%`);

    const row = (label: string, value: number, hint: string, apply: (v: number) => ScoringWeights) => (
        <div className={styles.row}>
            <div className={styles.head}>
                <Text weight="semibold">{label}</Text>
                <Text>{pct(value)}</Text>
            </div>
            <Slider min={0} max={100} value={value} onChange={(_, data) => onChange(apply(data.value))} />
            <Text className={styles.hint}>{hint}</Text>
        </div>
    );

    return (
        <div className={styles.root}>
            {row(
                l10n.t('Read / query alignment'),
                weights.read,
                l10n.t('Favor single-partition reads for your dominant query.'),
                (v) => ({ ...weights, read: v }),
            )}
            {row(
                l10n.t('Write distribution'),
                weights.write,
                l10n.t('Avoid hot partitions on the write path (key for IoT / ingestion).'),
                (v) => ({ ...weights, write: v }),
            )}
            {row(
                l10n.t('Storage & growth'),
                weights.storage,
                l10n.t('Stay under the 20 GB per-logical-partition limit.'),
                (v) => ({ ...weights, storage: v }),
            )}
            <Text className={styles.hint}>{l10n.t('Total normalized automatically')}</Text>
        </div>
    );
}
