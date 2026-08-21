/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Text, tokens } from '@fluentui/react-components';
import { CheckmarkCircleFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { FieldGroup, InfoBox, TwoColumn } from '../components/primitives';
import { WeightSliders } from '../components/WeightSliders';
import { type ContainerModel, type ScoringWeights } from '../models';

/**
 * Step 5 — Review. Read-only summary with per-section Edit shortcuts plus the
 * scoring-weight sliders. Editing jumps back via the provided callback so the
 * page stays decoupled from the wizard mechanism.
 */

const useStyles = makeStyles({
    stack: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    reviewItem: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalM,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
    },
    reviewIcon: {
        fontSize: tokens.fontSizeBase500,
    },
    reviewInfo: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        flex: 1,
    },
    reviewLabel: {
        fontWeight: tokens.fontWeightSemibold,
    },
    reviewDetail: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    checklist: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: tokens.spacingVerticalXS,
    },
    checkItem: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
    },
    checkIcon: {
        color: tokens.colorPaletteGreenForeground1,
    },
    containerRow: {
        display: 'flex',
        justifyContent: 'space-between',
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
});

const RULES = [
    'High cardinality',
    'Query alignment',
    'Hot partition risk',
    'Immutability',
    '20 GB limit',
    'Key length',
    'Synthetic key need',
    'Hierarchical PK assessment',
];

export interface ReviewSummary {
    workload: string;
    entity: string;
    query: string;
    scale: string;
}

export interface ReviewPageProps {
    summary: ReviewSummary;
    containers: ContainerModel[];
    weights: ScoringWeights;
    onEditStep: (step: number) => void;
    onChangeWeights: (weights: ScoringWeights) => void;
}

function ReviewRow({
    icon,
    label,
    detail,
    onEdit,
}: {
    icon: string;
    label: string;
    detail: string;
    onEdit: () => void;
}) {
    const styles = useStyles();
    return (
        <div className={styles.reviewItem}>
            <span className={styles.reviewIcon} aria-hidden="true">
                {icon}
            </span>
            <div className={styles.reviewInfo}>
                <Text className={styles.reviewLabel}>{label}</Text>
                <Text className={styles.reviewDetail}>{detail}</Text>
            </div>
            <Button appearance="secondary" size="small" onClick={onEdit}>
                {l10n.t('Edit')}
            </Button>
        </div>
    );
}

export function ReviewPage({ summary, containers, weights, onEditStep, onChangeWeights }: ReviewPageProps) {
    const styles = useStyles();

    return (
        <div>
            <TwoColumn reverseOnNarrow>
                <div className={styles.stack}>
                    <ReviewRow
                        icon="📋"
                        label={l10n.t('Workload: {value}', { value: summary.workload })}
                        detail=""
                        onEdit={() => onEditStep(1)}
                    />
                    <ReviewRow
                        icon="🗄️"
                        label={l10n.t('Entity: {value}', { value: summary.entity })}
                        detail=""
                        onEdit={() => onEditStep(2)}
                    />
                    <ReviewRow
                        icon="🔍"
                        label={l10n.t('Query: {value}', { value: summary.query })}
                        detail=""
                        onEdit={() => onEditStep(3)}
                    />
                    <ReviewRow
                        icon="📈"
                        label={l10n.t('Scale: {value}', { value: summary.scale })}
                        detail=""
                        onEdit={() => onEditStep(4)}
                    />

                    <FieldGroup label={l10n.t('Per-container summary')}>
                        <div>
                            {containers.map((c) => (
                                <div key={c.id} className={styles.containerRow}>
                                    <Text weight="semibold">{c.entity}</Text>
                                    <Text>{c.partitionKey}</Text>
                                </div>
                            ))}
                        </div>
                    </FieldGroup>
                </div>

                <div className={styles.stack}>
                    <FieldGroup label={l10n.t("Rules we'll evaluate")}>
                        <div className={styles.checklist}>
                            {RULES.map((rule) => (
                                <div key={rule} className={styles.checkItem}>
                                    <CheckmarkCircleFilled className={styles.checkIcon} />
                                    <Text>{rule}</Text>
                                </div>
                            ))}
                        </div>
                    </FieldGroup>

                    <InfoBox>{l10n.t('ℹ️ You can adjust any selection from the results page.')}</InfoBox>

                    <FieldGroup
                        label={l10n.t('Scoring priorities')}
                        hint={l10n.t(
                            'Reads and writes are weighted equally by default. Slide toward what matters most — the ranking recalculates instantly.',
                        )}
                    >
                        <WeightSliders weights={weights} onChange={onChangeWeights} />
                    </FieldGroup>
                </div>
            </TwoColumn>
        </div>
    );
}
