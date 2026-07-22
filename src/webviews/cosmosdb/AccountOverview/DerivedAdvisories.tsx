/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    Link,
    makeStyles,
    Text,
    tokens,
    Tooltip,
} from '@fluentui/react-components';
import { ChevronRight16Regular, Dismiss16Regular, Sparkle16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
    type DerivedAdvisory,
    type DerivedAdvisoryRule,
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

/** Higher wins when picking a group's headline severity and when ordering the cards. */
const SEVERITY_RANK: Record<DerivedAdvisorySeverity, number> = {
    High: 3,
    Medium: 2,
    Low: 1,
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
    groupCard: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        width: '100%',
        textAlign: 'left',
        appearance: 'none',
        fontFamily: 'inherit',
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        backgroundColor: 'var(--vscode-editor-background)',
        color: 'var(--vscode-foreground)',
        cursor: 'pointer',
        ':hover': {
            backgroundColor: 'var(--vscode-list-hoverBackground, var(--vscode-editor-background))',
        },
    },
    groupDescription: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-descriptionForeground)',
    },
    groupMeta: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        marginTop: '2px',
    },
    groupCount: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        color: 'var(--vscode-foreground)',
    },
    chevron: {
        marginLeft: 'auto',
        color: 'var(--vscode-descriptionForeground)',
        flexShrink: 0,
    },
    dialogSurface: {
        maxWidth: '640px',
    },
    dialogList: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        maxHeight: '60vh',
        overflowY: 'auto',
    },
    detailItem: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        backgroundColor: 'var(--vscode-editor-background)',
    },
    detailHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalS,
    },
    detailScope: {
        fontWeight: tokens.fontWeightSemibold,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
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
 * Detector-level display copy for a rule: the group card shows this name + description once per detector, no matter
 * how many containers fired it. The per-container specifics (which container, the exact numbers, the suggested fix)
 * stay on each {@link DerivedAdvisory} and are shown in the drill-in dialog. Keeping this map in the webview avoids a
 * server round-trip for static presentation strings while the detectors keep owning the per-container rationale.
 */
function ruleMeta(rule: DerivedAdvisoryRule): { name: string; description: string } {
    switch (rule) {
        case 'HotPartitionRisk':
            return {
                name: l10n.t('Hot partitions'),
                description: l10n.t(
                    'One physical partition is saturated while its siblings sit idle — traffic is skewed toward a single partition-key range.',
                ),
            };
        case 'SustainedThrottlingInRegion':
            return {
                name: l10n.t('Sustained throttling'),
                description: l10n.t(
                    'Every physical partition is at capacity, so the container is uniformly under-provisioned and throttling requests.',
                ),
            };
        case 'OverProvisioning':
            return {
                name: l10n.t('Over-provisioned throughput'),
                description: l10n.t(
                    'Provisioned RU/s stays well above observed demand, so you are paying for capacity the workload never uses.',
                ),
            };
        case 'AutoscaleCandidate':
            return {
                name: l10n.t('Autoscale candidates'),
                description: l10n.t(
                    'Bursty workloads that sit idle between spikes would usually cost less on autoscale than on fixed manual throughput.',
                ),
            };
        case 'StorageGrowthRisk':
            return {
                name: l10n.t('Storage growth risk'),
                description: l10n.t(
                    'A physical partition is on track to reach the 50 GiB split ceiling soon at its current storage growth rate.',
                ),
            };
        case 'StorageSkewRisk':
            return {
                name: l10n.t('Storage skew'),
                description: l10n.t(
                    'One physical partition holds far more data than its siblings and will hit the split ceiling long before them.',
                ),
            };
        case 'IndexingCostRisk':
            return {
                name: l10n.t('Indexing cost risk'),
                description: l10n.t(
                    'Index storage is large relative to data, suggesting the indexing policy covers more than the workload actually queries.',
                ),
            };
        case 'ExpensiveConsistency':
            return {
                name: l10n.t('Expensive consistency'),
                description: l10n.t(
                    'A strong or bounded-staleness consistency level multiplies read RU cost — relax it where the workload allows.',
                ),
            };
        case 'MultiRegionWriteAntipattern':
            return {
                name: l10n.t('Multi-region write antipattern'),
                description: l10n.t(
                    'Multi-region writes are enabled without a conflict-resolution setup that fits the workload, risking write conflicts.',
                ),
            };
        case 'IdleContainer':
            return {
                name: l10n.t('Idle containers'),
                description: l10n.t(
                    'Containers are provisioned but serve almost no traffic — their entire reservation is round-the-clock waste.',
                ),
            };
        case 'PartitionMergeCandidate':
            return {
                name: l10n.t('Partition merge candidates'),
                description: l10n.t(
                    'Containers have more physical partitions than their RU/s and storage need, adding avoidable per-partition overhead.',
                ),
            };
        case 'AutoscaleMaxOverProvisioned':
            return {
                name: l10n.t('Autoscale max set too high'),
                description: l10n.t(
                    'Autoscale containers rarely approach their configured maximum, so the max can be lowered to cap cost safely.',
                ),
            };
        case 'AutoscaleToManualCandidate':
            return {
                name: l10n.t('Autoscale to manual candidates'),
                description: l10n.t(
                    'Autoscale containers running at a steady load would usually be cheaper on fixed manual throughput.',
                ),
            };
        case 'ServerlessCandidate':
            return {
                name: l10n.t('Serverless candidates'),
                description: l10n.t(
                    'The account consumption pattern is intermittent enough that serverless may cost less than provisioned throughput.',
                ),
            };
        case 'CrossPartitionQuery':
            return {
                name: l10n.t('Cross-partition queries'),
                description: l10n.t(
                    'A large share of queries fan out across every physical partition, multiplying their RU cost.',
                ),
            };
        case 'ShardKeyMisalignment':
            return {
                name: l10n.t('Partition key misalignment'),
                description: l10n.t(
                    'Queries filter on a field other than the partition key, so they cannot target a single partition.',
                ),
            };
        case 'UncontrolledIngestion':
            return {
                name: l10n.t('Uncontrolled ingestion'),
                description: l10n.t(
                    'Write-dominant bursts drive throttling, indicating ingestion is not paced against provisioned throughput.',
                ),
            };
        case 'SharedThroughputStarvation':
            return {
                name: l10n.t('Shared-throughput starvation'),
                description: l10n.t(
                    'Containers in a shared-throughput database compete for one RU pool and starve each other under load.',
                ),
            };
    }
}

/** A detector's advisories grouped for the summary card + drill-in dialog. */
interface AdvisoryGroup {
    rule: DerivedAdvisoryRule;
    name: string;
    description: string;
    /** The most severe advisory in the group drives the card's badge and sort order. */
    severity: DerivedAdvisorySeverity;
    advisories: DerivedAdvisory[];
    /** Distinct container scopes that fired this rule; empty for account-wide rules. */
    scopeCount: number;
}

/**
 * Collapses the flat advisory list into one entry per detector. At scale a per-container list can run to tens of
 * thousands of rows; grouping keeps the card to at most one row per detector (18) and defers the container list to
 * an on-demand dialog, so the DOM never holds every finding at once.
 */
function groupAdvisories(advisories: readonly DerivedAdvisory[]): AdvisoryGroup[] {
    const byRule = new Map<DerivedAdvisoryRule, DerivedAdvisory[]>();
    for (const advisory of advisories) {
        const bucket = byRule.get(advisory.rule);
        if (bucket) {
            bucket.push(advisory);
        } else {
            byRule.set(advisory.rule, [advisory]);
        }
    }
    const groups: AdvisoryGroup[] = [];
    for (const [rule, ruleAdvisories] of byRule) {
        const meta = ruleMeta(rule);
        const severity = ruleAdvisories.reduce<DerivedAdvisorySeverity>(
            (worst, a) => (SEVERITY_RANK[a.severity] > SEVERITY_RANK[worst] ? a.severity : worst),
            'Low',
        );
        const scopeCount = new Set(ruleAdvisories.map((a) => a.scope).filter((s): s is string => !!s)).size;
        groups.push({
            rule,
            name: meta.name,
            description: meta.description,
            severity,
            advisories: ruleAdvisories,
            scopeCount,
        });
    }
    groups.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.name.localeCompare(b.name));
    return groups;
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

/** Card summary line: how many containers a scoped detector hit, or that the finding is account-wide. */
function groupCountLabel(group: AdvisoryGroup): string {
    if (group.scopeCount === 0) {
        return l10n.t('Account-wide');
    }
    return group.scopeCount === 1
        ? l10n.t('1 container affected')
        : l10n.t('{count} containers affected', { count: group.scopeCount });
}

/**
 * One summary card per detector. Shows the detector's name, description, headline severity, and how many containers
 * matched — but not the containers themselves. Activating it opens the drill-in dialog with the full per-container
 * list, so the section stays at ≤ 18 rows no matter how many findings the account has.
 */
const AdvisoryGroupCard = ({
    group,
    onOpen,
    buttonRef,
}: {
    group: AdvisoryGroup;
    onOpen: (rule: DerivedAdvisoryRule) => void;
    buttonRef: (el: HTMLButtonElement | null) => void;
}) => {
    const styles = useStyles();
    const count = groupCountLabel(group);
    return (
        <button
            type="button"
            ref={buttonRef}
            className={styles.groupCard}
            onClick={() => onOpen(group.rule)}
            aria-label={l10n.t('{name}. {count}. Show affected containers.', { name: group.name, count })}
        >
            <div className={styles.titleRow}>
                <div className={styles.titleGroup}>
                    <Pill tone={SEVERITY_TONE[group.severity]}>{severityLabel(group.severity)}</Pill>
                    <Text className={styles.title} title={group.name}>
                        {group.name}
                    </Text>
                </div>
            </div>
            <Text className={styles.groupDescription}>{group.description}</Text>
            <div className={styles.groupMeta}>
                <Text className={styles.groupCount}>{count}</Text>
                <ChevronRight16Regular className={styles.chevron} aria-hidden="true" />
            </div>
        </button>
    );
};

/**
 * Drill-in dialog for a single detector: the per-container advisories the card summarized. Each row keeps the
 * detector's original per-container rationale, suggested action, threshold, and its own dismiss button. Rendered
 * on demand (only for the open group), so the tens-of-thousands-of-findings worst case never all hit the DOM.
 */
const AdvisoryDetailDialog = ({
    group,
    open,
    onOpenChange,
    dismissedIds,
    onDismiss,
}: {
    group: AdvisoryGroup | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    dismissedIds: ReadonlySet<string>;
    onDismiss: (id: string) => void;
}) => {
    const styles = useStyles();
    if (!group) {
        return null;
    }
    const rows = group.advisories.filter((advisory) => !dismissedIds.has(advisory.id));
    return (
        <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
            <DialogSurface className={styles.dialogSurface}>
                <DialogBody>
                    <DialogTitle>{group.name}</DialogTitle>
                    <DialogContent>
                        <Text className={styles.groupDescription} block>
                            {group.description}
                        </Text>
                        <div className={styles.dialogList}>
                            {rows.map((advisory) => {
                                const scopeLabel = advisory.scope ?? l10n.t('Account-wide');
                                return (
                                    <div key={advisory.id} className={styles.detailItem}>
                                        <div className={styles.detailHeader}>
                                            <Text className={styles.detailScope} title={scopeLabel}>
                                                {scopeLabel}
                                            </Text>
                                            <Button
                                                size="small"
                                                appearance="subtle"
                                                icon={<Dismiss16Regular />}
                                                onClick={() => onDismiss(advisory.id)}
                                                aria-label={l10n.t('Dismiss advisory for {scope}', {
                                                    scope: scopeLabel,
                                                })}
                                            />
                                        </div>
                                        <Text className={styles.rationale}>{advisory.rationale}</Text>
                                        <Text className={styles.action}>{advisory.suggestedAction}</Text>
                                        <Text className={styles.threshold}>{advisory.thresholdReference}</Text>
                                    </div>
                                );
                            })}
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <DialogTrigger disableButtonEnhancement>
                            <Button appearance="secondary">{l10n.t('Close')}</Button>
                        </DialogTrigger>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
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

    const rootRef = useRef<HTMLDivElement>(null);
    // Card buttons keyed by rule, so focus can return to the section when the open group's last advisory is dismissed.
    const cardRefs = useRef(new Map<string, HTMLButtonElement | null>());
    const [announcement, setAnnouncement] = useState('');
    const [openRule, setOpenRule] = useState<DerivedAdvisoryRule | null>(null);

    // Collapse the flat advisory list (worst case: tens of thousands of container-scoped findings) into one group per
    // detector. Memoized on the raw list + dismissals so a card re-render never re-buckets the whole account.
    const groups = useMemo(() => {
        const visible = (result?.advisories ?? []).filter((advisory) => !dismissedIds.has(advisory.id));
        return groupAdvisories(visible);
    }, [result?.advisories, dismissedIds]);
    const visibleCount = groups.reduce((total, group) => total + group.advisories.length, 0);
    const openGroup = groups.find((group) => group.rule === openRule) ?? null;

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
        // The open group emptied out (its last advisory was dismissed): close the dialog and move focus to the
        // section container, since the card that opened it is now gone.
        if (openRule && !openGroup) {
            setOpenRule(null);
            rootRef.current?.focus();
        }
    }, [openRule, openGroup]);

    const handleOpen = (rule: DerivedAdvisoryRule) => {
        reportEvent('recommendationClicked', { source: 'derived', action: 'expand' });
        setOpenRule(rule);
    };

    const handleDismiss = (id: string) => {
        reportEvent('recommendationClicked', { source: 'derived', action: 'dismiss' });
        setAnnouncement(l10n.t('Advisory dismissed. {count} remaining.', { count: visibleCount - 1 }));
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
    } else if (groups.length === 0) {
        body = <Text className={styles.emptyState}>{l10n.t('No advisories from your telemetry right now.')}</Text>;
    } else {
        body = (
            <div className={styles.list}>
                {groups.map((group) => (
                    <AdvisoryGroupCard
                        key={group.rule}
                        group={group}
                        onOpen={handleOpen}
                        buttonRef={(el) => {
                            if (el) {
                                cardRefs.current.set(group.rule, el);
                            } else {
                                cardRefs.current.delete(group.rule);
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
            <AdvisoryDetailDialog
                group={openGroup}
                open={!!openGroup}
                onOpenChange={(open) => {
                    if (!open) {
                        setOpenRule(null);
                    }
                }}
                dismissedIds={dismissedIds}
                onDismiss={handleDismiss}
            />
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
