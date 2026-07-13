/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, makeStyles, Text, tokens } from '@fluentui/react-components';
import { Dismiss16Regular, Sparkle16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode } from 'react';
import { type DerivedAdvisory, type DerivedAdvisorySeverity, type DerivedAdvisoriesResult } from '../../api/types';
import { EmptyState, Pill, type PillTone, useDashboardActions } from './DashboardChrome';

const SEVERITY_TONE: Record<DerivedAdvisorySeverity, PillTone> = {
    High: 'danger',
    Medium: 'warning',
    Low: 'neutral',
};

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    provenance: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        alignSelf: 'flex-start',
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
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalS,
    },
    titleGroup: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        minWidth: 0,
    },
    title: {
        fontWeight: tokens.fontWeightSemibold,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    rationale: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-foreground)',
    },
    action: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-descriptionForeground)',
    },
    threshold: {
        fontSize: tokens.fontSizeBase100,
        color: 'var(--vscode-descriptionForeground)',
        fontStyle: 'italic',
    },
    emptyState: {
        padding: tokens.spacingVerticalL,
        textAlign: 'center',
        color: 'var(--vscode-descriptionForeground)',
    },
});

function severityLabel(severity: DerivedAdvisorySeverity): string {
    switch (severity) {
        case 'High':
            return l10n.t('High');
        case 'Medium':
            return l10n.t('Medium');
        case 'Low':
            return l10n.t('Low');
    }
}

const AdvisoryRow = ({ advisory, onDismiss }: { advisory: DerivedAdvisory; onDismiss: (id: string) => void }) => {
    const styles = useStyles();
    return (
        <div className={styles.item}>
            <div className={styles.titleRow}>
                <div className={styles.titleGroup}>
                    <Pill tone={SEVERITY_TONE[advisory.severity]}>{severityLabel(advisory.severity)}</Pill>
                    <Text className={styles.title} title={advisory.title}>
                        {advisory.title}
                    </Text>
                </div>
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<Dismiss16Regular />}
                    onClick={() => onDismiss(advisory.id)}
                    aria-label={l10n.t('Dismiss advisory: {title}', { title: advisory.title })}
                />
            </div>
            <Text className={styles.rationale}>{advisory.rationale}</Text>
            <Text className={styles.action}>{advisory.suggestedAction}</Text>
            <Text className={styles.threshold}>{advisory.thresholdReference}</Text>
        </div>
    );
};

export const DerivedAdvisories = ({
    result,
    loading,
    dismissedIds,
    onDismiss,
}: {
    result?: DerivedAdvisoriesResult;
    loading: boolean;
    dismissedIds: ReadonlySet<string>;
    onDismiss: (id: string) => void;
}) => {
    const styles = useStyles();
    const { reportEvent } = useDashboardActions();

    const handleDismiss = (id: string) => {
        reportEvent('recommendationClicked', { source: 'derived', action: 'dismiss' });
        onDismiss(id);
    };

    const provenance = (
        <Badge className={styles.provenance} appearance="tint" color="informative" icon={<Sparkle16Regular />}>
            {l10n.t('Derived from your telemetry')}
        </Badge>
    );

    const visible = (result?.advisories ?? []).filter((advisory) => !dismissedIds.has(advisory.id));

    let body: ReactNode;
    if (loading && !result) {
        body = <Text className={styles.emptyState}>{l10n.t('Analyzing your telemetry…')}</Text>;
    } else if (!result || !result.available) {
        body = <EmptyState reason={result?.reason ?? 'noData'} requiredRole={l10n.t('Monitoring Reader')} />;
    } else if (visible.length === 0) {
        body = <Text className={styles.emptyState}>{l10n.t('No advisories from your telemetry right now.')}</Text>;
    } else {
        body = (
            <div className={styles.list}>
                {visible.map((advisory) => (
                    <AdvisoryRow key={advisory.id} advisory={advisory} onDismiss={handleDismiss} />
                ))}
            </div>
        );
    }

    return (
        <div className={styles.root}>
            {provenance}
            {body}
        </div>
    );
};
