/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Link, makeStyles, tokens } from '@fluentui/react-components';
import {
    DataBarVerticalRegular,
    DatabaseRegular,
    DocumentRegular,
    EditRegular,
    FlashRegular,
    KeyRegular,
    SearchRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId, type ReactNode } from 'react';
import { AssessmentIcon } from '../components/AssessmentIcon';
import { MythBox } from '../components/primitives';
import { type ContainerModel, type DataGrowth, type ItemsPerPartition, type WriteDistribution } from '../models';

/**
 * Review step. Shows the selected workload with a Change link, one summary card per container (laid out in a
 * horizontal row that wraps on narrow surfaces) with an Edit shortcut, and the rules the analysis evaluates.
 * Editing jumps back via the provided callbacks so the page stays decoupled from the wizard mechanism.
 */

const useStyles = makeStyles({
    page: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXL,
        minWidth: 0,
    },
    intro: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXS,
    },
    hint: {
        margin: 0,
        fontSize: tokens.fontSizeBase300,
        color: tokens.colorNeutralForeground2,
    },
    workload: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: tokens.spacingHorizontalS,
        margin: 0,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
    },
    workloadValue: {
        color: tokens.colorNeutralForeground1,
        fontWeight: tokens.fontWeightSemibold,
    },
    workloadLink: {
        fontSize: 'inherit',
    },
    cards: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
        gap: tokens.spacingHorizontalL,
        margin: 0,
        padding: 0,
        listStyleType: 'none',
    },
    card: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        minWidth: 0,
        padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
        borderRadius: tokens.borderRadiusLarge,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        boxShadow: tokens.shadow2,
    },
    cardHeader: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: tokens.spacingHorizontalM,
    },
    cardIcon: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: '36px',
        height: '36px',
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground2,
        fontSize: '20px',
    },
    cardTitleBlock: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        flex: 1,
        minWidth: 0,
    },
    cardTitle: {
        margin: 0,
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: tokens.lineHeightBase400,
        overflowWrap: 'anywhere',
    },
    partitionKey: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: tokens.spacingHorizontalXS,
        minWidth: 0,
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorBrandForeground1,
        overflowWrap: 'anywhere',
    },
    inlineIcon: {
        display: 'inline-flex',
        flexShrink: 0,
        fontSize: '16px',
        color: tokens.colorNeutralForeground3,
    },
    summary: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        margin: 0,
        paddingTop: tokens.spacingVerticalM,
        paddingLeft: 0,
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        listStyleType: 'none',
    },
    summaryItem: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: tokens.spacingHorizontalS,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground2,
        overflowWrap: 'anywhere',
    },
    rulesPanel: {
        alignSelf: 'flex-start',
        maxWidth: '100%',
    },
    rulesContent: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    rulesHeading: {
        margin: 0,
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
    },
    rules: {
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: tokens.spacingHorizontalXL,
        rowGap: tokens.spacingVerticalM,
        margin: 0,
        padding: 0,
        listStyleType: 'none',
    },
    rule: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        fontSize: tokens.fontSizeBase200,
    },
});

export interface ReviewPageProps {
    workloadLabel: string;
    containers: ContainerModel[];
    onEditWorkload: () => void;
    onEditContainer: (containerId: string) => void;
}

const formatNumber = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

function SummaryItem({ icon, iconLabel, children }: { icon: ReactNode; iconLabel?: string; children: ReactNode }) {
    const styles = useStyles();
    return (
        <li className={styles.summaryItem}>
            {iconLabel ? (
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Named wrapper for a font icon.
                <span className={styles.inlineIcon} role="img" aria-label={iconLabel}>
                    {icon}
                </span>
            ) : (
                <span className={styles.inlineIcon} aria-hidden="true">
                    {icon}
                </span>
            )}
            <span>{children}</span>
        </li>
    );
}

function ContainerCard({ container, onEdit }: { container: ContainerModel; onEdit: () => void }) {
    const styles = useStyles();
    const titleId = useId();

    const itemsLabel: Record<ItemsPerPartition, string> = {
        low: l10n.t('Low'),
        medium: l10n.t('Medium'),
        high: l10n.t('High'),
        'very-high': l10n.t('Very high'),
    };
    const writesLabel: Record<WriteDistribution, string> = {
        even: l10n.t('Even'),
        skewed: l10n.t('Skewed'),
        time: l10n.t('Time-correlated'),
    };
    const growthLabel: Record<DataGrowth, string> = {
        bounded: l10n.t('Bounded'),
        slow: l10n.t('Slow'),
        rapid: l10n.t('Rapid'),
    };

    const topRead = container.reads.toSorted((a, b) => b.qps - a.qps)[0];
    const topReadText = topRead?.pattern.trim()
        ? topRead.pattern.trim()
        : topRead?.filters.trim()
          ? l10n.t('Read by {filters}', { filters: topRead.filters.trim() })
          : l10n.t('No read pattern defined');
    const readQps = container.reads.reduce((sum, read) => sum + read.qps, 0);
    const { insertsPerSec, updatesPerSec, deletesPerSec } = container.writes;
    const writeTps = insertsPerSec + updatesPerSec + deletesPerSec;

    return (
        <li className={styles.card}>
            <div className={styles.cardHeader}>
                <span className={styles.cardIcon} aria-hidden="true">
                    <DatabaseRegular />
                </span>
                <div className={styles.cardTitleBlock}>
                    <h3 id={titleId} className={styles.cardTitle}>
                        {container.entity}
                    </h3>
                    <span className={styles.partitionKey}>
                        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Named wrapper for a font icon. */}
                        <span className={styles.inlineIcon} role="img" aria-label={l10n.t('Partition key')}>
                            <KeyRegular />
                        </span>
                        {container.partitionKey || l10n.t('Not selected')}
                    </span>
                </div>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<EditRegular />}
                    aria-describedby={titleId}
                    onClick={onEdit}
                >
                    {l10n.t('Edit')}
                </Button>
            </div>
            <ul className={styles.summary}>
                <SummaryItem icon={<SearchRegular />} iconLabel={l10n.t('Top read')}>
                    {topReadText}
                </SummaryItem>
                <SummaryItem icon={<FlashRegular />}>
                    {l10n.t('{reads} read QPS · {writes} write TPS', {
                        reads: formatNumber(readQps),
                        writes: formatNumber(writeTps),
                    })}
                </SummaryItem>
                <SummaryItem icon={<DocumentRegular />}>
                    {l10n.t('~{size} KB average document', { size: formatNumber(container.document.avgSizeKb) })}
                </SummaryItem>
                <SummaryItem icon={<DataBarVerticalRegular />}>
                    {l10n.t('Items: {items} · Writes: {writes} · Growth: {growth}', {
                        items: itemsLabel[container.scale.items],
                        writes: writesLabel[container.scale.writes],
                        growth: growthLabel[container.scale.growth],
                    })}
                </SummaryItem>
            </ul>
        </li>
    );
}

export function ReviewPage({ workloadLabel, containers, onEditWorkload, onEditContainer }: ReviewPageProps) {
    const styles = useStyles();
    const workloadId = useId();
    const rulesHeadingId = useId();

    const rules = [
        l10n.t('High cardinality'),
        l10n.t('Query alignment'),
        l10n.t('Hot partition risk'),
        l10n.t('Immutability'),
        l10n.t('20 GB limit'),
        l10n.t('Key length'),
        l10n.t('Synthetic key need'),
        l10n.t('Hierarchical PK assessment'),
    ];

    return (
        <div className={styles.page}>
            <div className={styles.intro}>
                <p className={styles.workload}>
                    <span id={workloadId}>
                        {l10n.t('Workload:')} <span className={styles.workloadValue}>{workloadLabel}</span>
                    </span>
                    <Link
                        as="button"
                        className={styles.workloadLink}
                        aria-describedby={workloadId}
                        onClick={onEditWorkload}
                    >
                        {l10n.t('Change')}
                    </Link>
                </p>
                <p className={styles.hint}>{l10n.t('Click Edit to change any selection before analysis.')}</p>
            </div>

            <ul className={styles.cards} aria-label={l10n.t('Containers')}>
                {containers.map((container) => (
                    <ContainerCard
                        key={container.id}
                        container={container}
                        onEdit={() => onEditContainer(container.id)}
                    />
                ))}
            </ul>

            <section className={styles.rulesPanel} aria-labelledby={rulesHeadingId}>
                <MythBox icon="✨">
                    <div className={styles.rulesContent}>
                        <h3 id={rulesHeadingId} className={styles.rulesHeading}>
                            {l10n.t("Rules we'll evaluate")}
                        </h3>
                        <ul className={styles.rules}>
                            {rules.map((rule) => (
                                <li key={rule} className={styles.rule}>
                                    <AssessmentIcon status="pass" decorative />
                                    {rule}
                                </li>
                            ))}
                        </ul>
                    </div>
                </MythBox>
            </section>
        </div>
    );
}
