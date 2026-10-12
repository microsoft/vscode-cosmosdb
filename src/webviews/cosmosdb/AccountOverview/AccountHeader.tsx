/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    makeStyles,
    mergeClasses,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Switch,
    Text,
    tokens,
    Tooltip,
} from '@fluentui/react-components';
import {
    ArrowClockwise16Regular,
    ChevronDown16Regular,
    ChevronRight16Regular,
    ChevronUp16Regular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId, useMemo, useRef, useState } from 'react';
import { type AccountActionInput, type HealthState, type ProvisioningState, type TimeRange } from '../../api/types';
import { Pill, type PillTone } from './DashboardChrome';
import { type ContainerRef, type MetricScope } from './metrics/descriptors';

const cosmosIcon = new URL('../../../../resources/azurecosmosdb.png', import.meta.url).href;
const timeRanges: { value: TimeRange; label: string }[] = [
    { value: '1H', label: l10n.t('Last hour') },
    { value: '24H', label: l10n.t('Last 24 hours') },
    { value: '7D', label: l10n.t('Last 7 days') },
];

export type AccountSummary = {
    accountName: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    apiType: string;
    documentEndpoint: string;
    isServerless: boolean;
    provisioningState?: ProvisioningState;
    consistencyLevel?: string;
    freeTierEnabled: boolean;
    backupPolicyType?: string;
    backupIntervalMinutes?: number;
    backupRetentionHours?: number;
    continuousBackupTier?: string;
    automaticFailoverEnabled?: boolean;
    totalThroughputLimit?: number;
    writeRegions: string[];
    readRegions: string[];
    writeRegionCount: number;
    readRegionCount: number;
    lastRefreshedAt: number;
};

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        minWidth: 0,
    },
    topRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalM,
        flexWrap: 'wrap',
    },
    titleBlock: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minWidth: 0,
    },
    identity: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minWidth: 0,
    },
    icon: {
        width: '32px',
        height: '32px',
        flexShrink: 0,
    },
    title: {
        margin: 0,
        fontSize: '20px',
        lineHeight: '28px',
        fontWeight: 600,
        overflowWrap: 'anywhere',
    },
    subtitle: {
        margin: 0,
        color: 'var(--vscode-descriptionForeground)',
        fontSize: tokens.fontSizeBase200,
    },
    controls: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
        minWidth: 0,
        maxWidth: '100%',
        fontSize: tokens.fontSizeBase200,
    },
    select: {
        color: 'var(--vscode-descriptionForeground)',
        backgroundColor: 'var(--vscode-editor-background)',
        border: '1px solid transparent',
        borderRadius: tokens.borderRadiusMedium,
        padding: tokens.spacingHorizontalS,
        maxWidth: '100%',
        font: 'inherit',
        ':focus-visible': { outline: '2px solid var(--vscode-focusBorder)' },
    },
    link: {
        color: 'var(--vscode-textLink-foreground)',
    },
    refreshOptions: {
        fontSize: tokens.fontSizeBase100,
        color: 'var(--vscode-descriptionForeground)',
    },
    refreshPanel: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        width: 'min(300px, calc(100vw - 40px))',
        boxSizing: 'border-box',
    },
    refreshText: {
        color: 'var(--vscode-descriptionForeground)',
        fontSize: tokens.fontSizeBase200,
        whiteSpace: 'nowrap',
    },
    status: {
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        borderRadius: tokens.borderRadiusLarge,
        padding: '8px 12px',
        fontSize: tokens.fontSizeBase200,
        backgroundColor: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
    },
    statusItems: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px 16px',
        flexWrap: 'wrap',
        flex: 1,
        minWidth: 0,
        overflowWrap: 'anywhere',
        '& > span + span': {
            borderLeft: '1px solid var(--vscode-panel-border)',
            paddingLeft: '16px',
        },
        '@media (max-width: 700px)': {
            flexBasis: '100%',
        },
    },
    statusValue: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
    },
    statusDot: {
        width: '6px',
        height: '6px',
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: 'currentColor',
    },
    statusPill: {
        backgroundColor: 'color-mix(in srgb, currentColor 15%, transparent)',
        border: '1px solid var(--vscode-contrastBorder, transparent)',
        fontWeight: 600,
    },
    detailsToggle: {
        marginLeft: 'auto',
    },
    detailBody: {
        borderTop: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        margin: '8px -12px -8px',
        padding: '16px 12px',
    },
    essentialsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
        columnGap: tokens.spacingHorizontalXL,
        rowGap: tokens.spacingVerticalM,
    },
    detailFooter: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalS,
        marginTop: tokens.spacingVerticalM,
    },
    additionalProperties: {
        marginLeft: 'auto',
        minWidth: 0,
        fontSize: tokens.fontSizeBase100,
        '& > summary': {
            cursor: 'pointer',
            color: 'var(--vscode-descriptionForeground)',
        },
        '&[open]': { flexBasis: '100%', marginLeft: 0 },
        '& > div': { marginTop: tokens.spacingVerticalM },
    },
    essentialItem: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minWidth: 0,
    },
    essentialLabel: {
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontSize: tokens.fontSizeBase100,
        color: 'var(--vscode-descriptionForeground)',
    },
    essentialValue: {
        display: 'block',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: tokens.fontSizeBase200,
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

function formatRefreshTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function healthFromProvisioning(state: ProvisioningState | undefined): { tone: PillTone; label: string } {
    switch (state) {
        case 'Succeeded':
            return { tone: 'success', label: l10n.t('Healthy') };
        case 'Creating':
        case 'Updating':
        case 'Deleting':
            return { tone: 'warning', label: l10n.t('Needs Attention') };
        case 'Failed':
        case 'Canceled':
            return { tone: 'danger', label: l10n.t('Critical') };
        case undefined:
        default:
            return { tone: 'neutral', label: l10n.t('Unknown') };
    }
}

/** Maps a derived {@link HealthState} (provisioning + throttling) to a pill tone and localized label. */
function healthFromState(state: HealthState): { tone: PillTone; label: string } {
    switch (state) {
        case 'Healthy':
            return { tone: 'success', label: l10n.t('Healthy') };
        case 'Needs Attention':
            return { tone: 'warning', label: l10n.t('Needs Attention') };
        case 'Critical':
            return { tone: 'danger', label: l10n.t('Critical') };
    }
}

/**
 * A single label/value row in the expandable Essentials panel. The value is truncated with an
 * ellipsis when it exceeds the available width; the full text is then revealed in a tooltip on
 * hover/focus. When the value is not truncated the tooltip is suppressed so it never repeats text
 * the user can already read.
 */
const EssentialField = ({ label, value }: { label: string; value: string }) => {
    const styles = useStyles();
    const valueRef = useRef<HTMLSpanElement>(null);
    const [tooltipVisible, setTooltipVisible] = useState(false);

    const handleVisibleChange = (_ev: unknown, data: { visible: boolean }) => {
        const el = valueRef.current;
        const overflowing = !!el && el.scrollWidth > el.clientWidth;
        setTooltipVisible(data.visible && overflowing);
    };

    return (
        <div className={styles.essentialItem}>
            <Text className={styles.essentialLabel}>{label}</Text>
            <Tooltip
                content={value}
                relationship="label"
                visible={tooltipVisible}
                onVisibleChange={handleVisibleChange}
            >
                <Text ref={valueRef} className={styles.essentialValue}>
                    {value}
                </Text>
            </Tooltip>
        </div>
    );
};

export const AccountHeader = ({
    summary,
    accountHealth,
    lastRefreshedAt,
    paused,
    onTogglePause,
    onRefresh,
    autoRefreshIntervalsSeconds,
    defaultEssentialsOpen = false,
    timeRange,
    onTimeRangeChange,
    containers,
    selectedContainer,
    onSelectContainer,
    databaseIds,
    accountActionBusy,
    onAccountAction,
}: {
    summary: AccountSummary;
    accountHealth?: HealthState;
    lastRefreshedAt: number;
    paused: boolean;
    onTogglePause: (paused: boolean) => void;
    onRefresh: () => void;
    /** Auto-refresh cadences (in seconds), surfaced in the pause toggle's tooltip. */
    autoRefreshIntervalsSeconds: { metrics: number; inventory: number; alerts: number };
    defaultEssentialsOpen?: boolean;
    timeRange: TimeRange;
    onTimeRangeChange: (range: TimeRange) => void;
    containers: ContainerRef[];
    selectedContainer?: MetricScope;
    onSelectContainer: (scope?: MetricScope) => void;
    databaseIds?: string[];
    accountActionBusy: boolean;
    onAccountAction: (input: AccountActionInput) => void;
}) => {
    const styles = useStyles();
    const id = useId();
    const [essentialsOpen, setEssentialsOpen] = useState(defaultEssentialsOpen);
    const [refreshOptionsOpen, setRefreshOptionsOpen] = useState(false);
    const lastRefreshedLabel = formatRefreshTime(lastRefreshedAt);
    const health = accountHealth ? healthFromState(accountHealth) : healthFromProvisioning(summary.provisioningState);
    const databases = useMemo(
        () => [...new Set(databaseIds ?? containers.map((container) => container.databaseId))].sort(),
        [containers, databaseIds],
    );
    const selectedDatabaseIndex = selectedContainer ? databases.indexOf(selectedContainer.databaseId) : -1;
    const selectedScopeLabel = selectedContainer?.databaseId ?? l10n.t('All databases');
    const timeRangeLabel = timeRanges.find((range) => range.value === timeRange)?.label;
    const throughputLimit =
        summary.totalThroughputLimit === undefined
            ? l10n.t('Unknown')
            : summary.totalThroughputLimit === -1
              ? l10n.t('No total throughput limit')
              : l10n.t('{ru} RU/s', { ru: summary.totalThroughputLimit.toLocaleString() });
    const capacityMode = summary.isServerless ? l10n.t('Serverless') : l10n.t('Provisioned throughput');
    const retention =
        summary.backupRetentionHours === undefined
            ? summary.continuousBackupTier
            : summary.backupRetentionHours % 24 === 0
              ? l10n.t('{days} days retention', { days: summary.backupRetentionHours / 24 })
              : l10n.t('{hours} hours retention', { hours: summary.backupRetentionHours });
    const backupPolicy = retention
        ? `${summary.backupPolicyType ?? l10n.t('Unknown')} (${retention})`
        : (summary.backupPolicyType ?? l10n.t('Unknown'));

    const essentials: { label: string; value: string }[] = [
        { label: l10n.t('Status'), value: health.label },
        { label: l10n.t('Resource group'), value: summary.resourceGroup },
        { label: l10n.t('Subscription'), value: summary.subscriptionName },
        { label: l10n.t('Subscription ID'), value: summary.subscriptionId },
        { label: l10n.t('URI'), value: summary.documentEndpoint },
        {
            label: l10n.t('Capacity mode'),
            value: capacityMode,
        },
        {
            label: l10n.t('Total throughput limit'),
            value: throughputLimit,
        },
        {
            label: l10n.t('Backup policy'),
            value:
                summary.backupPolicyType === 'Periodic' && summary.backupIntervalMinutes !== undefined
                    ? l10n.t('{policy}; backup every {minutes} minutes', {
                          policy: backupPolicy,
                          minutes: summary.backupIntervalMinutes,
                      })
                    : backupPolicy,
        },
        { label: l10n.t('Free tier'), value: summary.freeTierEnabled ? l10n.t('Enabled') : l10n.t('Opted out') },
        {
            label: l10n.t('Write locations'),
            value: summary.writeRegions.length ? summary.writeRegions.join(', ') : '—',
        },
        { label: l10n.t('Read locations'), value: summary.readRegions.length ? summary.readRegions.join(', ') : '—' },
    ];
    const additionalProperties = [
        { label: l10n.t('API type'), value: summary.apiType },
        { label: l10n.t('Consistency'), value: summary.consistencyLevel ?? l10n.t('Unknown') },
        {
            label: l10n.t('Automatic failover'),
            value:
                summary.automaticFailoverEnabled === undefined
                    ? l10n.t('Unknown')
                    : summary.automaticFailoverEnabled
                      ? l10n.t('Enabled')
                      : l10n.t('Disabled'),
        },
    ];

    const regionsLabel =
        [...new Set([...summary.writeRegions, ...summary.readRegions])].join(', ') || l10n.t('Unknown');

    const autoRefreshTooltip = (
        <>
            <div>{l10n.t('Auto-refresh cadence while this tab is active:')}</div>
            <div>
                {l10n.t('• Charts & partitions: every {seconds}s', {
                    seconds: autoRefreshIntervalsSeconds.metrics,
                })}
            </div>
            <div>
                {l10n.t('• Inventory metrics: every {seconds}s', {
                    seconds: autoRefreshIntervalsSeconds.inventory,
                })}
            </div>
            <div>
                {l10n.t('• Alerts & recommendations: every {seconds}s', {
                    seconds: autoRefreshIntervalsSeconds.alerts,
                })}
            </div>
        </>
    );

    return (
        <header className={styles.root}>
            <output className={styles.srOnly} aria-live="polite">
                {l10n.t('Account health: {status}', { status: health.label })}
            </output>
            <div className={styles.topRow}>
                <div className={styles.identity}>
                    <img className={styles.icon} src={cosmosIcon} alt="" />
                    <div className={styles.titleBlock}>
                        <h1 className={styles.title}>{summary.accountName}</h1>
                        <p className={styles.subtitle}>{l10n.t('Azure Cosmos DB account')}</p>
                    </div>
                </div>
                <div className={styles.controls}>
                    <select
                        className={styles.select}
                        aria-label={l10n.t('Metric time range: {range}', { range: timeRangeLabel ?? timeRange })}
                        value={timeRange}
                        onChange={(event) => onTimeRangeChange(timeRanges[event.currentTarget.selectedIndex].value)}
                    >
                        {timeRanges.map((range) => (
                            <option key={range.value} value={range.value}>
                                {range.label}
                            </option>
                        ))}
                    </select>
                    <select
                        className={styles.select}
                        aria-label={l10n.t('Database scope for metrics: {scope}', { scope: selectedScopeLabel })}
                        value={selectedDatabaseIndex}
                        onChange={(event) => {
                            const index = event.currentTarget.selectedIndex - 1;
                            onSelectContainer(index < 0 ? undefined : { databaseId: databases[index] });
                        }}
                    >
                        <option value={-1}>{l10n.t('All databases')}</option>
                        {databases.map((database, index) => (
                            <option key={database} value={index}>
                                {database}
                            </option>
                        ))}
                    </select>
                    <Button
                        appearance="subtle"
                        size="small"
                        className={styles.link}
                        icon={<ArrowClockwise16Regular aria-hidden />}
                        onClick={onRefresh}
                    >
                        {l10n.t('Refresh')}
                    </Button>
                    <Popover
                        open={refreshOptionsOpen}
                        onOpenChange={(_, data) => setRefreshOptionsOpen(data.open)}
                        positioning="below-end"
                    >
                        <PopoverTrigger disableButtonEnhancement>
                            <Button
                                appearance="subtle"
                                size="small"
                                className={styles.refreshOptions}
                                icon={
                                    refreshOptionsOpen ? (
                                        <ChevronDown16Regular aria-hidden />
                                    ) : (
                                        <ChevronRight16Regular aria-hidden />
                                    )
                                }
                            >
                                {paused ? l10n.t('Auto-refresh paused') : l10n.t('Refresh options')}
                            </Button>
                        </PopoverTrigger>
                        <PopoverSurface className={styles.refreshPanel} aria-label={l10n.t('Refresh options')}>
                            <Text className={styles.refreshText}>
                                {l10n.t('Last refreshed at {time}', { time: lastRefreshedLabel })}
                            </Text>
                            <Tooltip content={autoRefreshTooltip} relationship="description">
                                <Switch
                                    checked={paused}
                                    onChange={(_, data) => onTogglePause(data.checked)}
                                    label={l10n.t('Pause auto-refresh')}
                                />
                            </Tooltip>
                            <p className={styles.subtitle}>
                                {l10n.t(
                                    'Time and database scope apply to metric trends. Inventory is account-wide; alerts and advisories use their own time windows.',
                                )}
                            </p>
                        </PopoverSurface>
                    </Popover>
                </div>
            </div>

            <div className={styles.status}>
                <div className={styles.topRow}>
                    <div className={styles.statusItems}>
                        <span className={styles.statusValue}>
                            <span>{l10n.t('Status:')}</span>
                            <Pill tone={health.tone} className={styles.statusPill}>
                                <span className={styles.statusDot} aria-hidden />
                                {health.label}
                            </Pill>
                        </span>
                        <span>{l10n.t('Regions: {regions}', { regions: regionsLabel })}</span>
                        <span>{l10n.t('Capacity mode: {mode}', { mode: capacityMode })}</span>
                        <span>{l10n.t('Total throughput limit: {limit}', { limit: throughputLimit })}</span>
                    </div>
                    <Button
                        appearance="subtle"
                        size="small"
                        className={mergeClasses(styles.link, styles.detailsToggle)}
                        icon={
                            essentialsOpen ? <ChevronUp16Regular aria-hidden /> : <ChevronDown16Regular aria-hidden />
                        }
                        iconPosition="after"
                        id={`${id}-toggle`}
                        aria-expanded={essentialsOpen}
                        aria-controls={`${id}-details`}
                        onClick={() => setEssentialsOpen((open) => !open)}
                    >
                        {l10n.t('Account details')}
                    </Button>
                </div>
                <section
                    className={styles.detailBody}
                    id={`${id}-details`}
                    aria-labelledby={`${id}-toggle`}
                    hidden={!essentialsOpen}
                >
                    <div className={styles.essentialsGrid}>
                        {essentials.map((field) => (
                            <EssentialField key={field.label} label={field.label} value={field.value} />
                        ))}
                    </div>
                    <div className={styles.detailFooter}>
                        <Button
                            appearance="subtle"
                            size="small"
                            className={styles.link}
                            disabled={accountActionBusy}
                            onClick={() => onAccountAction({ action: 'openCosts' })}
                        >
                            {l10n.t('View cost')}
                        </Button>
                        <Button
                            appearance="subtle"
                            size="small"
                            className={styles.link}
                            disabled={accountActionBusy}
                            onClick={() => onAccountAction({ action: 'openJson' })}
                        >
                            {l10n.t('JSON view')}
                        </Button>
                        <details className={styles.additionalProperties}>
                            <summary>{l10n.t('Additional account properties')}</summary>
                            <div className={styles.essentialsGrid}>
                                {additionalProperties.map((field) => (
                                    <EssentialField key={field.label} label={field.label} value={field.value} />
                                ))}
                            </div>
                        </details>
                    </div>
                </section>
            </div>
        </header>
    );
};
