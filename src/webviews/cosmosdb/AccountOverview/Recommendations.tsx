/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    type BadgeProps,
    Card,
    Link,
    makeStyles,
    Spinner,
    Text,
    tokens,
    typographyStyles,
} from '@fluentui/react-components';
import { Open16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode, useId } from 'react';
import { type RecommendationImpact, type RecommendationItem, type RecommendationsResult } from '../../api/types';
import { EmptyState, useDashboardActions } from './DashboardChrome';

const IMPACT_TONE: Record<RecommendationImpact, BadgeProps['color']> = {
    High: 'warning',
    Medium: 'informative',
    Low: 'subtle',
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
        gap: tokens.spacingVerticalXXS,
        minWidth: 0,
        overflow: 'visible',
    },
    titleRow: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    category: {
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground2,
    },
    problem: {
        ...typographyStyles.body1Strong,
    },
    solution: {
        ...typographyStyles.body1,
        color: tokens.colorNeutralForeground1,
    },
    benefit: {
        ...typographyStyles.body1,
        color: tokens.colorNeutralForeground2,
    },
    link: {
        ...typographyStyles.body1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
    },
    actions: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalM,
    },
    emptyState: {
        padding: tokens.spacingVerticalL,
        textAlign: 'center',
        color: tokens.colorNeutralForeground2,
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
    onOpenUrl,
}: {
    recommendation: RecommendationItem;
    onOpenUrl: (url: string) => void;
}) => {
    const styles = useStyles();
    const problemId = useId();
    const { reportEvent } = useDashboardActions();
    const { portalUrl, learnMoreLink } = recommendation;
    const handleLinkClick = () => {
        reportEvent('recommendationClicked', { source: 'advisor', impact: recommendation.impact });
    };

    return (
        <Card className={styles.item} appearance="outline" focusMode="off">
            <div className={styles.titleRow}>
                <Badge appearance="outline" shape="circular" color={IMPACT_TONE[recommendation.impact]}>
                    {impactLabel(recommendation.impact)}
                </Badge>
                <Text className={styles.category}>{recommendation.category}</Text>
            </div>
            <Text id={problemId} className={styles.problem}>
                {recommendation.problem}
            </Text>
            {recommendation.solution && <Text className={styles.solution}>{recommendation.solution}</Text>}
            {recommendation.potentialBenefit && (
                <Text className={styles.benefit}>
                    {l10n.t('Potential benefit: {benefit}', { benefit: recommendation.potentialBenefit })}
                </Text>
            )}
            {(portalUrl || learnMoreLink) && (
                <div className={styles.actions}>
                    {portalUrl && (
                        <Link
                            className={styles.link}
                            href={portalUrl}
                            aria-describedby={problemId}
                            onClick={handleLinkClick}
                        >
                            <Open16Regular aria-hidden />
                            {l10n.t('View in Azure portal')}
                        </Link>
                    )}
                    {learnMoreLink && (
                        <Link
                            className={styles.link}
                            as="button"
                            aria-describedby={problemId}
                            onClick={() => {
                                handleLinkClick();
                                onOpenUrl(learnMoreLink);
                            }}
                        >
                            {l10n.t('Learn more')}
                        </Link>
                    )}
                </div>
            )}
        </Card>
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
                    <RecommendationRow key={rec.id} recommendation={rec} onOpenUrl={onOpenUrl} />
                ))}
            </div>
        );
    }

    return <div className={styles.root}>{body}</div>;
};
