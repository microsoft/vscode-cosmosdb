/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Text, tokens } from '@fluentui/react-components';
import { ArrowRightRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { FieldGroup, InfoBox, TwoColumn } from '../components/primitives';
import { WeightSliders } from '../components/WeightSliders';
import { type ContainerModel, type ScoringWeights } from '../models';

/**
 * Review step. Read-only summary with Edit shortcuts: one for the workload, and one
 * per container that jumps back to that container's step. Also hosts the scoring-weight
 * sliders. Editing jumps back via the provided callbacks so the page stays decoupled
 * from the wizard mechanism.
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
    ruleIcon: {
        color: tokens.colorBrandForeground1,
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

export interface ReviewPageProps {
    workloadLabel: string;
    containers: ContainerModel[];
    weights: ScoringWeights;
    onEditWorkload: () => void;
    onEditContainer: (containerId: string) => void;
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
                {detail ? <Text className={styles.reviewDetail}>{detail}</Text> : null}
            </div>
            <Button appearance="secondary" size="small" onClick={onEdit}>
                {l10n.t('Edit')}
            </Button>
        </div>
    );
}

export function ReviewPage({
    workloadLabel,
    containers,
    weights,
    onEditWorkload,
    onEditContainer,
    onChangeWeights,
}: ReviewPageProps) {
    const styles = useStyles();

    return (
        <div>
            <TwoColumn reverseOnNarrow>
                <div className={styles.stack}>
                    <ReviewRow
                        icon="📋"
                        label={l10n.t('Workload: {value}', { value: workloadLabel })}
                        detail={l10n.t('{count} containers', { count: containers.length })}
                        onEdit={onEditWorkload}
                    />

                    <FieldGroup label={l10n.t('Containers')}>
                        <div className={styles.stack}>
                            {containers.map((c) => (
                                <ReviewRow
                                    key={c.id}
                                    icon="🗄️"
                                    label={c.entity}
                                    detail={l10n.t('Partition key {pk} · {items} items · {writes} writes', {
                                        pk: c.partitionKey,
                                        items: c.scale.items,
                                        writes: c.scale.writes,
                                    })}
                                    onEdit={() => onEditContainer(c.id)}
                                />
                            ))}
                        </div>
                    </FieldGroup>
                </div>

                <div className={styles.stack}>
                    <FieldGroup label={l10n.t("Rules we'll evaluate")}>
                        <div className={styles.checklist}>
                            {RULES.map((rule) => (
                                <div key={rule} className={styles.checkItem}>
                                    <ArrowRightRegular className={styles.ruleIcon} aria-hidden />
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
