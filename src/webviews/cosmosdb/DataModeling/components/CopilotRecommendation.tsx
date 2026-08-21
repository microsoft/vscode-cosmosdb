/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, makeStyles, Spinner, Text, tokens } from '@fluentui/react-components';
import { SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type PartitionKeyRecommendation } from '../../../api/types';

/** Lifecycle of the Copilot partition-key recommendation request. */
export type RecommendationStatus = 'idle' | 'waiting' | 'received' | 'error';

const useStyles = makeStyles({
    panel: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        padding: tokens.spacingHorizontalL,
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorBrandStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
    },
    headerIcon: {
        color: tokens.colorBrandForeground1,
        fontSize: tokens.fontSizeBase500,
    },
    title: {
        fontWeight: tokens.fontWeightSemibold,
    },
    waiting: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalM,
    },
    error: {
        color: tokens.colorPaletteRedForeground1,
    },
    cards: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: tokens.spacingHorizontalM,
    },
    card: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
    },
    entity: {
        fontWeight: tokens.fontWeightSemibold,
    },
    pk: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorBrandForeground1,
    },
    rationale: {
        color: tokens.colorNeutralForeground2,
    },
    noteList: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        margin: 0,
        paddingLeft: 0,
        listStyle: 'none',
    },
    note: {
        display: 'flex',
        gap: tokens.spacingHorizontalXS,
        alignItems: 'baseline',
        fontSize: tokens.fontSizeBase200,
    },
    noteKey: {
        fontFamily: tokens.fontFamilyMonospace,
        whiteSpace: 'nowrap',
    },
    noteReason: {
        color: tokens.colorNeutralForeground3,
    },
    sectionLabel: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground3,
        marginTop: tokens.spacingVerticalXS,
    },
});

export interface CopilotRecommendationProps {
    status: RecommendationStatus;
    recommendation?: PartitionKeyRecommendation;
    error?: string;
    onRetry: () => void;
}

export function CopilotRecommendation({ status, recommendation, error, onRetry }: CopilotRecommendationProps) {
    const styles = useStyles();

    return (
        <section className={styles.panel} aria-live="polite">
            <div className={styles.header}>
                <SparkleRegular className={styles.headerIcon} aria-hidden="true" />
                <Text className={styles.title}>{l10n.t("Copilot's recommendation")}</Text>
            </div>

            {status === 'idle' ? (
                <div className={styles.waiting}>
                    <Text>{l10n.t('Ask Copilot to recommend the best partition key for this model.')}</Text>
                    <Button appearance="primary" onClick={onRetry}>
                        {l10n.t('Get Recommendation')}
                    </Button>
                </div>
            ) : null}

            {status === 'waiting' ? (
                <div className={styles.waiting}>
                    <Spinner size="tiny" />
                    <Text>
                        {l10n.t(
                            'Waiting for Copilot… We opened Copilot Chat with your data model. The recommendation will appear here.',
                        )}
                    </Text>
                </div>
            ) : null}

            {status === 'error' ? (
                <div className={styles.waiting}>
                    <Text className={styles.error}>
                        {error ?? l10n.t('Copilot could not produce a recommendation.')}
                    </Text>
                    <Button appearance="secondary" onClick={onRetry}>
                        {l10n.t('Try again')}
                    </Button>
                </div>
            ) : null}

            {status === 'received' && recommendation ? (
                <>
                    <Text>{recommendation.summary}</Text>
                    <div className={styles.cards}>
                        {recommendation.containers.map((c) => (
                            <div key={c.entity} className={styles.card}>
                                <Text className={styles.entity}>{c.entity}</Text>
                                <Text className={styles.pk}>{c.partitionKey}</Text>
                                <Text className={styles.rationale}>{c.rationale}</Text>
                                {c.alternatives && c.alternatives.length > 0 ? (
                                    <>
                                        <Text className={styles.sectionLabel}>{l10n.t('Alternatives')}</Text>
                                        <ul className={styles.noteList}>
                                            {c.alternatives.map((a, i) => (
                                                <li key={i} className={styles.note}>
                                                    <Badge appearance="tint" color="informative">
                                                        {a.partitionKey}
                                                    </Badge>
                                                    <span className={styles.noteReason}>{a.reason}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                ) : null}
                                {c.avoid && c.avoid.length > 0 ? (
                                    <>
                                        <Text className={styles.sectionLabel}>{l10n.t('Avoid')}</Text>
                                        <ul className={styles.noteList}>
                                            {c.avoid.map((a, i) => (
                                                <li key={i} className={styles.note}>
                                                    <Badge appearance="tint" color="danger">
                                                        {a.partitionKey}
                                                    </Badge>
                                                    <span className={styles.noteReason}>{a.reason}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                ) : null}
                            </div>
                        ))}
                    </div>
                    <Button appearance="subtle" size="small" onClick={onRetry}>
                        {l10n.t('Ask again')}
                    </Button>
                </>
            ) : null}
        </section>
    );
}
