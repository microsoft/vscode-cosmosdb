/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Link, makeStyles, Text, tokens, Tooltip } from '@fluentui/react-components';
import { Dismiss16Regular, Sparkle16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
    type DerivedAdvisory,
    type DerivedAdvisorySeverity,
    type DerivedAdvisoriesResult,
    type UnavailableReason,
} from '../../api/types';
import {
    DIAGNOSTIC_SETTINGS_URL,
    EmptyState,
    Pill,
    type PillTone,
    RBAC_LEARN_MORE_URL,
    useDashboardActions,
} from './DashboardChrome';

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
        // Fill the height the card hands down (the card grows to match the main column) and clip, so the list below
        // owns the scroll. When the card is not height-constrained (e.g. the rail wraps under the main column on a
        // narrow viewport), this simply grows to the content height and nothing scrolls.
        flexGrow: 1,
        minHeight: 0,
        overflow: 'hidden',
    },
    provenanceRow: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
        flexShrink: 0,
    },
    provenance: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        alignSelf: 'flex-start',
        flexShrink: 0,
    },
    coveragePill: {
        // A focusable badge so keyboard/screen-reader users can reach the "why" tooltip (focusableBadge pattern).
        cursor: 'default',
    },
    notice: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: tokens.spacingHorizontalM,
        marginBottom: tokens.spacingVerticalS,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-widget-border))',
        backgroundColor: 'var(--vscode-inputValidation-warningBackground, var(--vscode-editor-background))',
        color: 'var(--vscode-foreground)',
    },
    noticeTitle: {
        fontWeight: tokens.fontWeightSemibold,
        fontSize: tokens.fontSizeBase200,
    },
    noticeBody: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-descriptionForeground)',
    },
    scrollBody: {
        flexGrow: 1,
        minHeight: 0,
        overflowY: 'auto',
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
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
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

/**
 * Reason-specific copy for the partial-coverage notice shown when the Log Analytics ("Tier-2") analyzers were
 * skipped. Each reason has a different fix, so the notice names it and, where actionable, links to guidance. The
 * Tier-1 advisories still render above/below — this notice explains that some log-based checks did not run.
 */
function logCoverageNotice(reason: UnavailableReason | undefined): {
    body: string;
    linkLabel?: string;
    linkUrl?: string;
} {
    switch (reason) {
        case 'logAnalyticsDisabled':
            return {
                body: l10n.t(
                    'Log-based checks (cross-partition queries, ingestion, shared-throughput) didn’t run because diagnostic settings aren’t exporting logs to a Log Analytics workspace.',
                ),
                linkLabel: l10n.t('Learn how to enable diagnostic settings'),
                linkUrl: DIAGNOSTIC_SETTINGS_URL,
            };
        case 'rbac':
            return {
                body: l10n.t('Log-based checks didn’t run — your role is missing Log Analytics Reader.'),
                linkLabel: l10n.t('Learn more about Azure roles'),
                linkUrl: RBAC_LEARN_MORE_URL,
            };
        case 'noData':
        default:
            return {
                body: l10n.t(
                    'Log-based checks didn’t run — there’s no log telemetry in the window yet, or logs were enabled recently.',
                ),
            };
    }
}

const AdvisoryRow = ({
    advisory,
    onDismiss,
    buttonRef,
}: {
    advisory: DerivedAdvisory;
    onDismiss: (id: string) => void;
    buttonRef: (el: HTMLButtonElement | null) => void;
}) => {
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
                    ref={buttonRef}
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

    // Focus management for dismissal: keyboard/screen-reader users must not lose their place when a
    // card is removed from the DOM. We capture the focus target (next card, else previous) before the
    // dismiss re-render, then re-apply it once the list settles — falling back to the section container
    // when the last advisory goes away.
    const rootRef = useRef<HTMLDivElement>(null);
    const buttonRefs = useRef(new Map<string, HTMLButtonElement | null>());
    const pendingFocusRef = useRef<{ id: string | null } | null>(null);
    const [announcement, setAnnouncement] = useState('');

    const visible = (result?.advisories ?? []).filter((advisory) => !dismissedIds.has(advisory.id));

    // Partial coverage: the section itself is available (Tier-1 ran) but the Log Analytics (Tier-2) analyzers were
    // skipped. We keep rendering the Tier-1 advisories and surface Tier-2's degradation explicitly, rather than
    // blanking the card with an all-or-nothing empty-state.
    const logSource = result?.logSource;
    const partialCoverage = !!result?.available && !!logSource && logSource.available === false;
    const coverageReason = logSource?.reason;

    useEffect(() => {
        if (partialCoverage) {
            reportEvent('analyzerSkipped', { tier: 'logAnalytics', reason: coverageReason ?? 'noData' });
        }
    }, [partialCoverage, coverageReason, reportEvent]);

    useEffect(() => {
        const pending = pendingFocusRef.current;
        if (!pending) {
            return;
        }
        pendingFocusRef.current = null;
        if (pending.id) {
            buttonRefs.current.get(pending.id)?.focus();
        } else {
            rootRef.current?.focus();
        }
    }, [dismissedIds]);

    const handleDismiss = (id: string) => {
        reportEvent('recommendationClicked', { source: 'derived', action: 'dismiss' });
        const idx = visible.findIndex((advisory) => advisory.id === id);
        const nextFocus = visible[idx + 1] ?? visible[idx - 1];
        pendingFocusRef.current = { id: nextFocus ? nextFocus.id : null };
        const remaining = visible.length - 1;
        setAnnouncement(l10n.t('Advisory dismissed. {count} remaining.', { count: remaining }));
        onDismiss(id);
    };

    const provenance = (
        <Badge className={styles.provenance} appearance="tint" color="informative" icon={<Sparkle16Regular />}>
            {l10n.t('Derived from your telemetry')}
        </Badge>
    );

    const coverageBadge = partialCoverage ? (
        <Tooltip
            content={l10n.t('Some log-based analyzers were unavailable, so coverage is partial.')}
            relationship="description"
        >
            <Badge
                className={styles.coveragePill}
                tabIndex={0}
                appearance="tint"
                color="warning"
                aria-label={l10n.t(
                    'Partial coverage. Some log-based analyzers were unavailable, so coverage is partial.',
                )}
            >
                <span aria-hidden="true">{l10n.t('Partial coverage')}</span>
            </Badge>
        </Tooltip>
    ) : null;

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
                    <AdvisoryRow
                        key={advisory.id}
                        advisory={advisory}
                        onDismiss={handleDismiss}
                        buttonRef={(el) => {
                            if (el) {
                                buttonRefs.current.set(advisory.id, el);
                            } else {
                                buttonRefs.current.delete(advisory.id);
                            }
                        }}
                    />
                ))}
            </div>
        );
    }

    return (
        <div ref={rootRef} className={styles.root} tabIndex={-1} aria-label={l10n.t('Recommendations')}>
            <output className={styles.srOnly} aria-live="polite">
                {announcement}
            </output>
            <div className={styles.provenanceRow}>
                {provenance}
                {coverageBadge}
            </div>
            <div className={styles.scrollBody}>
                {partialCoverage && <PartialCoverageNotice reason={coverageReason} />}
                {body}
            </div>
        </div>
    );
};

/**
 * Inline, reason-specific notice explaining that the Log Analytics ("Tier-2") analyzers were skipped, shown inside
 * the card above the Tier-1 advisories (which still render). Names the fix and links to guidance where actionable.
 */
const PartialCoverageNotice = ({ reason }: { reason?: UnavailableReason }) => {
    const styles = useStyles();
    const { openUrl } = useDashboardActions();
    const { body, linkLabel, linkUrl } = logCoverageNotice(reason);
    return (
        <output className={styles.notice}>
            <Text className={styles.noticeTitle}>{l10n.t('Partial coverage')}</Text>
            <Text className={styles.noticeBody}>{body}</Text>
            {linkLabel && linkUrl && (
                <Link as="button" onClick={() => openUrl(linkUrl)}>
                    {linkLabel}
                </Link>
            )}
        </output>
    );
};
