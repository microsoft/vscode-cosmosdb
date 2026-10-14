/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    type BadgeProps,
    Button,
    Card,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    Link,
    makeStyles,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    Text,
    tokens,
    Tooltip,
    typographyStyles,
    useRestoreFocusTarget,
} from '@fluentui/react-components';
import { ChevronRight16Regular, Dismiss16Regular, Sparkle16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    type DerivedAdvisory,
    type DerivedAdvisoryRule,
    type DerivedAdvisorySeverity,
    type DerivedAdvisoriesResult,
    type UnavailableReason,
} from '../../api/types';
import { AdvisoryText } from './AdvisoryText';
import { DIAGNOSTIC_SETTINGS_URL, EmptyState, useDashboardActions } from './DashboardChrome';

const SEVERITY_TONE: Record<DerivedAdvisorySeverity, BadgeProps['color']> = {
    High: 'danger',
    Medium: 'warning',
    Low: 'subtle',
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
        gap: tokens.spacingHorizontalXS,
        alignSelf: 'flex-start',
        flexShrink: 0,
    },
    coveragePill: {
        // A focusable badge so keyboard/screen-reader users can reach the "why" tooltip (focusableBadge pattern).
        cursor: 'default',
    },
    notice: {
        marginBottom: tokens.spacingVerticalS,
    },
    noticeActions: {
        alignItems: 'center',
        flexWrap: 'wrap',
        rowGap: tokens.spacingVerticalS,
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
        gap: tokens.spacingVerticalXS,
        width: '100%',
        textAlign: 'left',
    },
    groupDescription: {
        ...typographyStyles.body1,
        color: tokens.colorNeutralForeground2,
    },
    groupMeta: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        marginTop: tokens.spacingVerticalXXS,
    },
    groupCount: {
        ...typographyStyles.body1Strong,
        color: tokens.colorNeutralForeground1,
    },
    chevron: {
        marginLeft: 'auto',
        color: tokens.colorNeutralForeground2,
        flexShrink: 0,
    },
    dialogSurface: {
        maxWidth: '640px',
    },
    dialogList: {
        display: 'flex',
        flexDirection: 'column',
        listStyleType: 'none',
        padding: 0,
        marginBottom: 0,
        maxHeight: '60vh',
        overflowY: 'auto',
    },
    detailItem: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: tokens.spacingHorizontalS,
        paddingTop: tokens.spacingVerticalS,
        paddingBottom: tokens.spacingVerticalS,
        borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    },
    detailContent: {
        flexGrow: 1,
        minWidth: 0,
    },
    detailDescription: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXS,
        marginTop: tokens.spacingVerticalS,
    },
    detailScope: {
        ...typographyStyles.body1Strong,
        overflowWrap: 'anywhere',
    },
    item: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
        backgroundColor: tokens.colorNeutralBackground1,
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
        ...typographyStyles.body1Strong,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    rationale: {
        ...typographyStyles.body1,
        color: tokens.colorNeutralForeground1,
    },
    action: {
        ...typographyStyles.body1,
        color: tokens.colorNeutralForeground2,
    },
    threshold: {
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground2,
    },
    emptyState: {
        padding: tokens.spacingVerticalL,
        textAlign: 'center',
        color: tokens.colorNeutralForeground2,
    },
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clipPath: 'inset(50%)',
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
                    'One physical partition is saturated while its siblings sit idle. Traffic is skewed toward a single partition-key range.',
                ),
            };
        case 'SustainedThrottlingInRegion':
            return {
                name: l10n.t('Sustained throttling'),
                description: l10n.t(
                    'A physical partition is saturated and no sibling has sufficient headroom, indicating uniform capacity pressure while requests are throttled.',
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
                    'A physical partition has reached the 50 GiB split ceiling or is on track to reach it soon.',
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
                    'A strong or bounded-staleness consistency level multiplies read RU cost. Relax it where the workload allows.',
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
                    'Containers are provisioned but serve almost no traffic. Their entire reservation is round-the-clock waste.',
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
        case 'ServerlessThrottling':
            return {
                name: l10n.t('Serverless throttling'),
                description:
                    l10n.t('A serverless container is throttling requests.') +
                    ' ' +
                    l10n.t(
                        'There is no provisioned RU/s setting to raise; consider provisioned capacity for sustained demand.',
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
 * thousands of rows; grouping keeps the card to at most one row per detector and defers the container list to
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
                body:
                    l10n.t('Some required CDB log tables could not be queried.') +
                    ' ' +
                    l10n.t(
                        'Check that DataPlaneRequests and QueryRuntimeStatistics are exported to Log Analytics in resource-specific mode, not only AzureDiagnostics.',
                    ) +
                    ' ' +
                    l10n.t('Missing tables can also reflect access restrictions or delayed ingestion.'),
                linkLabel: l10n.t('Learn how to enable diagnostic settings'),
                linkUrl: DIAGNOSTIC_SETTINGS_URL,
            };
        case 'rbac':
            return {
                body:
                    l10n.t('Some log-based checks were denied access.') +
                    ' ' +
                    l10n.t(
                        'Check the signed-in identity, resource log permissions, and the workspace access-control mode and table permissions.',
                    ) +
                    ' ' +
                    l10n.t('Enabling diagnostic settings does not grant query access.'),
                linkLabel: l10n.t('Learn about Log Analytics access'),
                linkUrl: 'https://learn.microsoft.com/azure/azure-monitor/logs/manage-access',
            };
        case 'noData':
        default:
            return {
                body:
                    l10n.t('Some log-based queries failed or returned incomplete results.') +
                    ' ' +
                    l10n.t(
                        'Available checks still contribute recommendations; this does not mean Log Analytics is disabled.',
                    ),
            };
    }
}

/** Card summary line: how many containers a scoped detector hit, or that the finding is account-wide. */
function groupCountLabel(group: AdvisoryGroup): string {
    if (group.scopeCount === 0) {
        return l10n.t('Account-wide');
    }
    return group.scopeCount === 1 ? l10n.t('1 container affected') : l10n.t('Some containers affected');
}

/**
 * One summary card per detector. Shows the detector's name, description, headline severity, and how many containers
 * matched — but not the containers themselves. Activating it opens the drill-in dialog with the full per-container
 * list, so the section stays at one row per detector no matter how many findings the account has.
 */
const AdvisoryGroupCard = ({
    group,
    onOpen,
    buttonRef,
}: {
    group: AdvisoryGroup;
    onOpen: (rule: DerivedAdvisoryRule) => void;
    buttonRef: (el: HTMLDivElement | null) => void;
}) => {
    const styles = useStyles();
    const restoreFocusTargetAttributes = useRestoreFocusTarget();
    const count = groupCountLabel(group);
    return (
        <Card
            ref={buttonRef}
            className={styles.groupCard}
            appearance="outline"
            focusMode="off"
            // Card only supports a div root.
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="button"
            tabIndex={0}
            onClick={() => onOpen(group.rule)}
            // Card renders a div; activate this single action instead of entering a card focus group.
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (event.key === 'Enter') {
                        event.currentTarget.click();
                    }
                }
            }}
            onKeyUp={(event) => {
                if (event.key === ' ') {
                    event.preventDefault();
                    event.currentTarget.click();
                }
            }}
            aria-label={l10n.t('{name}. {count}. Show affected containers.', { name: group.name, count })}
            aria-haspopup="dialog"
            {...restoreFocusTargetAttributes}
        >
            <div className={styles.titleRow}>
                <div className={styles.titleGroup}>
                    <Badge appearance="outline" shape="circular" color={SEVERITY_TONE[group.severity]}>
                        {severityLabel(group.severity)}
                    </Badge>
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
        </Card>
    );
};

/**
 * Shared guidance appears once above a compact resource list. Resource-specific evidence stays in disclosures,
 * so different measurements and recommendations remain available without repeating the common description.
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
    const id = useId();
    if (!group) {
        return null;
    }
    const rows = group.advisories.filter((advisory) => !dismissedIds.has(advisory.id));
    const detailFields = [
        { key: 'rationale', className: styles.rationale },
        { key: 'suggestedAction', className: styles.action },
        { key: 'thresholdReference', className: styles.threshold },
    ] as const;
    const first = rows[0];
    const sharedFields = detailFields.filter(
        ({ key }) => first && rows.every((advisory) => advisory[key] === first[key]),
    );
    const resourceFields = detailFields.filter((field) => !sharedFields.includes(field));
    return (
        <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
            <DialogSurface className={styles.dialogSurface}>
                <DialogBody>
                    <DialogTitle>{group.name}</DialogTitle>
                    <DialogContent>
                        <Text className={styles.groupDescription} block>
                            {group.description}
                        </Text>
                        <div className={styles.detailDescription}>
                            {first &&
                                sharedFields.map(({ key, className }) => (
                                    <Text key={key} className={className}>
                                        <AdvisoryText text={first[key]} />
                                    </Text>
                                ))}
                        </div>
                        {/* Safari needs the explicit role when list-style is none. */}
                        {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles */}
                        <ul className={styles.dialogList} aria-label={group.name} role="list">
                            {rows.map((advisory, index) => {
                                const scopeLabel = advisory.scope ?? l10n.t('Account-wide');
                                const headerId = `${id}-${index}-toggle`;
                                const panelId = `${id}-${index}-evidence`;
                                return (
                                    <li key={advisory.id} className={styles.detailItem}>
                                        {resourceFields.length > 0 ? (
                                            <Accordion className={styles.detailContent} collapsible>
                                                <AccordionItem value={advisory.id}>
                                                    <AccordionHeader
                                                        as="h3"
                                                        size="small"
                                                        button={{ id: headerId, 'aria-controls': panelId }}
                                                    >
                                                        <span className={styles.detailScope}>{scopeLabel}</span>
                                                    </AccordionHeader>
                                                    <AccordionPanel
                                                        className={styles.detailDescription}
                                                        // AccordionPanel only supports a div root.
                                                        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                                                        role="region"
                                                        id={panelId}
                                                        aria-labelledby={headerId}
                                                        collapseMotion={{
                                                            children: (Component, props) => (
                                                                <Component {...props} unmountOnExit={false} />
                                                            ),
                                                        }}
                                                    >
                                                        {resourceFields.map(({ key, className }) => (
                                                            <Text key={key} className={className}>
                                                                <AdvisoryText text={advisory[key]} />
                                                            </Text>
                                                        ))}
                                                    </AccordionPanel>
                                                </AccordionItem>
                                            </Accordion>
                                        ) : (
                                            <Text className={styles.detailContent}>
                                                <span className={styles.detailScope}>{scopeLabel}</span>
                                            </Text>
                                        )}
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            icon={<Dismiss16Regular />}
                                            onClick={() => onDismiss(advisory.id)}
                                            aria-label={l10n.t('Dismiss advisory for {scope}', {
                                                scope: scopeLabel,
                                            })}
                                        />
                                    </li>
                                );
                            })}
                        </ul>
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
    const cardRefs = useRef(new Map<string, HTMLDivElement | null>());
    const [announcement, setAnnouncement] = useState('');
    const [openRule, setOpenRule] = useState<DerivedAdvisoryRule | null>(null);

    // Collapse the flat advisory list (worst case: tens of thousands of container-scoped findings) into one group per
    // detector. Memoized on the raw list + dismissals so a card re-render never re-buckets the whole account.
    const groups = useMemo(() => {
        const visible = (result?.advisories ?? []).filter(
            (advisory) => !advisory.supersededBy && !dismissedIds.has(advisory.id),
        );
        return groupAdvisories(visible);
    }, [result?.advisories, dismissedIds]);
    const visibleCount = groups.reduce((total, group) => total + group.advisories.length, 0);
    const openGroup = groups.find((group) => group.rule === openRule) ?? null;

    // Partial coverage: the section itself is available (Tier-1 ran) but some Log Analytics (Tier-2) checks failed.
    // We keep rendering all available advisories and surface Tier-2's degradation explicitly, rather than
    // blanking the card with an all-or-nothing empty-state.
    const logSource = result?.logSource;
    const partialCoverage = !!result?.available && !!logSource && logSource.available === false;
    const coverageReason = logSource?.reason;
    const metricPartialCoverage = !!result?.available && result.metricSource?.available === false;

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

    const coverageLabel = l10n.t('Partial coverage');
    const coverageDescription = l10n.t('Some analyzers could not run, so coverage is partial.');
    const coverageBadge =
        partialCoverage || metricPartialCoverage ? (
            <Tooltip content={coverageDescription} relationship="description">
                <Badge
                    className={styles.coveragePill}
                    tabIndex={0}
                    appearance="tint"
                    color="warning"
                    aria-label={`${coverageLabel}. ${coverageDescription}`}
                >
                    <span aria-hidden="true">{coverageLabel}</span>
                </Badge>
            </Tooltip>
        ) : null;

    let body: ReactNode;
    if (loading && !result) {
        body = <Text className={styles.emptyState}>{l10n.t('Analyzing your telemetry…')}</Text>;
    } else if (!result || !result.available) {
        body = <EmptyState reason={result?.reason ?? 'noData'} requiredRole={l10n.t('Monitoring Reader')} />;
    } else if (groups.length === 0) {
        body = (
            <Text className={styles.emptyState}>
                {partialCoverage || metricPartialCoverage
                    ? l10n.t('No advisories from the checks that completed.')
                    : l10n.t('No advisories from your telemetry right now.')}
            </Text>
        );
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
                {partialCoverage && <PartialCoverageNotice source={logSource} />}
                {metricPartialCoverage && <MetricCoverageNotice source={result?.metricSource} />}
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

const MetricCoverageNotice = ({ source }: { source: DerivedAdvisoriesResult['metricSource'] }) => {
    const styles = useStyles();
    const reasons: Record<UnavailableReason, string> = {
        noData: l10n.t('Metric data unavailable or incomplete'),
        rbac: l10n.t('Access denied'),
        unsupported: l10n.t('Not supported for this account'),
        logAnalyticsDisabled: l10n.t('Required table unavailable'),
    };
    const failures = new Map((source?.failures ?? []).map((failure) => [`${failure.rule}:${failure.reason}`, failure]));
    return (
        <MessageBar
            className={styles.notice}
            intent="warning"
            layout="multiline"
            politeness="polite"
            icon={{ 'aria-hidden': true }}
        >
            <MessageBarBody>
                <MessageBarTitle>{l10n.t('Incomplete workload analysis')}</MessageBarTitle>
                <div>
                    {l10n.t(
                        'Some workload checks could not run. Missing or failed metric queries are not treated as zero usage.',
                    ) +
                        ' ' +
                        l10n.t('Configuration checks and successful analyses still contribute recommendations.')}
                </div>
                <ul>
                    {[...failures].map(([key, failure]) => (
                        <li key={key}>{`${ruleMeta(failure.rule).name}: ${reasons[failure.reason]}`}</li>
                    ))}
                </ul>
            </MessageBarBody>
        </MessageBar>
    );
};

/**
 * Inline notice explaining which Log Analytics ("Tier-2") checks failed, above findings from successful checks.
 * Names the failure category and links to guidance where actionable.
 */
const PartialCoverageNotice = ({ source }: { source: DerivedAdvisoriesResult['logSource'] }) => {
    const styles = useStyles();
    const { openUrl, showOutput } = useDashboardActions();
    const { body, linkLabel, linkUrl } = logCoverageNotice(source?.reason);
    const operations = {
        probeDataPlane: l10n.t('DataPlaneRequests availability'),
        probeQueryRuntime: l10n.t('QueryRuntimeStatistics availability'),
        crossPartition: l10n.t('Query fan-out'),
        ingestionSummary: l10n.t('Ingestion totals'),
        ingestionBurst: l10n.t('Ingestion bursts'),
        ingestionUserAgent: l10n.t('Ingestion clients'),
        sharedThroughput: l10n.t('Shared throughput'),
        client: l10n.t('Log Analytics client'),
    };
    const kinds = {
        accessDenied: l10n.t('Access denied'),
        missingTable: l10n.t('Required table unavailable'),
        queryError: l10n.t('Query error'),
        partialFailure: l10n.t('Incomplete query result'),
        transient: l10n.t('Temporary service failure'),
        unknown: l10n.t('Unknown query failure'),
        clientUnavailable: l10n.t('Client unavailable'),
    };
    return (
        <MessageBar
            className={styles.notice}
            intent="warning"
            layout="multiline"
            politeness="polite"
            icon={{ 'aria-hidden': true }}
        >
            <MessageBarBody>
                <MessageBarTitle>{l10n.t('Partial coverage')}</MessageBarTitle>
                <div>{body}</div>
                {!!source?.failures?.length && (
                    <ul>
                        {source.failures.map((failure) => (
                            <li key={`${failure.operation}-${failure.kind}`}>
                                {`${operations[failure.operation]}: ${kinds[failure.kind]}`}
                            </li>
                        ))}
                    </ul>
                )}
                <div>
                    {l10n.t(
                        'See the extension Output channel for the HTTP status, service error details, and request ID.',
                    )}
                </div>
            </MessageBarBody>
            <MessageBarActions className={styles.noticeActions}>
                <Button size="small" onClick={showOutput}>
                    {l10n.t('Show Output')}
                </Button>
                {linkLabel && linkUrl && (
                    <Link as="button" onClick={() => openUrl(linkUrl)}>
                        {linkLabel}
                    </Link>
                )}
            </MessageBarActions>
        </MessageBar>
    );
};
