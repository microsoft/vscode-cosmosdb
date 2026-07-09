/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, Spinner, Text, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type ReactNode } from 'react';
import { type RecommendationImpact, type RecommendationItem, type RecommendationsResult } from '../../api/types';
import { EmptyState, Pill, type PillTone, useDashboardActions } from './DashboardChrome';

const IMPACT_TONE: Record<RecommendationImpact, PillTone> = {
    High: 'warning',
    Medium: 'info',
    Low: 'neutral',
};

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
    },
    item: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        backgroundColor: 'var(--vscode-editor-background)',
    },
    titleRow: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    category: {
        fontSize: tokens.fontSizeBase100,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--vscode-descriptionForeground)',
    },
    problem: {
        fontWeight: tokens.fontWeightSemibold,
    },
    solution: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-foreground)',
    },
    benefit: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-descriptionForeground)',
    },
    link: {
        fontSize: tokens.fontSizeBase200,
    },
    emptyState: {
        padding: tokens.spacingVerticalL,
        textAlign: 'center',
        color: 'var(--vscode-descriptionForeground)',
    },
    loading: {
        display: 'flex',
        justifyContent: 'center',
        padding: tokens.spacingVerticalL,
    },
});

function impactLabel(impact: RecommendationImpact): string {
    switch (impact) {
        case 'High':
            return l10n.t('High impact');
        case 'Medium':
            return l10n.t('Medium impact');
        case 'Low':
            return l10n.t('Low impact');
    }
}

const RecommendationRow = ({
    recommendation,
    onLearnMore,
}: {
    recommendation: RecommendationItem;
    onLearnMore: (recommendation: RecommendationItem) => void;
}) => {
    const styles = useStyles();
    return (
        <div className={styles.item}>
            <div className={styles.titleRow}>
                <Pill tone={IMPACT_TONE[recommendation.impact]}>{impactLabel(recommendation.impact)}</Pill>
                <Text className={styles.category}>{recommendation.category}</Text>
            </div>
            <Text className={styles.problem}>{recommendation.problem}</Text>
            {recommendation.solution && <Text className={styles.solution}>{recommendation.solution}</Text>}
            {recommendation.potentialBenefit && (
                <Text className={styles.benefit}>
                    {l10n.t('Potential benefit: {benefit}', { benefit: recommendation.potentialBenefit })}
                </Text>
            )}
            {recommendation.learnMoreLink && (
                <Link
                    className={styles.link}
                    as="button"
                    onClick={() => {
                        onLearnMore(recommendation);
                    }}
                >
                    {l10n.t('Learn more')}
                </Link>
            )}
        </div>
    );
};

export const Recommendations = ({
    result,
    loading,
    onOpenUrl,
}: {
    result?: RecommendationsResult;
    loading: boolean;
    onOpenUrl: (url: string) => void;
}) => {
    const styles = useStyles();
    const { reportEvent } = useDashboardActions();

    const handleLearnMore = (recommendation: RecommendationItem) => {
        reportEvent('recommendationClicked', { source: 'advisor', impact: recommendation.impact });
        if (recommendation.learnMoreLink) {
            onOpenUrl(recommendation.learnMoreLink);
        }
    };

    let body: ReactNode;
    if (loading && !result) {
        body = (
            <div className={styles.loading}>
                <Spinner size="small" label={l10n.t('Loading recommendations…')} />
            </div>
        );
    } else if (!result || !result.available) {
        body = <EmptyState reason={result?.reason ?? 'noData'} requiredRole={l10n.t('Reader on the subscription')} />;
    } else if (result.recommendations.length === 0) {
        body = <Text className={styles.emptyState}>{l10n.t('No recommendations from Azure Advisor.')}</Text>;
    } else {
        body = (
            <div className={styles.list}>
                {result.recommendations.map((rec) => (
                    <RecommendationRow key={rec.id} recommendation={rec} onLearnMore={handleLearnMore} />
                ))}
            </div>
        );
    }

    return <div className={styles.root}>{body}</div>;
};
