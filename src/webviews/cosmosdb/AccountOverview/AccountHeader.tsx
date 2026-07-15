/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Caption1, Link, makeStyles, Switch, Text, Title2, tokens, Tooltip } from '@fluentui/react-components';
import { ArrowClockwise16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useRef, useState } from 'react';
import { type HealthState, type ProvisioningState } from '../../api/types';
import { Pill, type PillTone } from './DashboardChrome';

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
        gap: tokens.spacingVerticalM,
    },
    topRow: {
        display: 'flex',
        alignItems: 'flex-start',
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
    title: {
        margin: 0,
    },
    titleRow: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    subtitle: {
        margin: 0,
        color: 'var(--vscode-descriptionForeground)',
    },
    controls: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalM,
        flexWrap: 'wrap',
    },
    refreshText: {
        color: 'var(--vscode-descriptionForeground)',
        fontSize: tokens.fontSizeBase200,
        whiteSpace: 'nowrap',
    },
    chips: {
        display: 'flex',
        gap: tokens.spacingHorizontalXS,
        flexWrap: 'wrap',
    },
    essentialsToggleRow: {
        display: 'flex',
        justifyContent: 'flex-end',
    },
    essentialsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        columnGap: tokens.spacingHorizontalXL,
        rowGap: tokens.spacingVerticalM,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        backgroundColor: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
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
}: {
    summary: AccountSummary;
    accountHealth?: HealthState;
    lastRefreshedAt: number;
    paused: boolean;
    onTogglePause: (paused: boolean) => void;
    onRefresh: () => void;
    /** Auto-refresh cadences (in seconds), surfaced in the pause toggle's tooltip. */
    autoRefreshIntervalsSeconds: { metrics: number; inventory: number; alerts: number };
}) => {
    const styles = useStyles();
    const [essentialsOpen, setEssentialsOpen] = useState(false);
    const lastRefreshedLabel = formatRefreshTime(lastRefreshedAt);
    const health = accountHealth ? healthFromState(accountHealth) : healthFromProvisioning(summary.provisioningState);

    const essentials: { label: string; value: string }[] = [
        { label: l10n.t('Status'), value: health.label },
        { label: l10n.t('Resource group'), value: summary.resourceGroup },
        { label: l10n.t('Subscription'), value: summary.subscriptionName },
        { label: l10n.t('Subscription ID'), value: summary.subscriptionId },
        { label: l10n.t('API'), value: summary.apiType },
        { label: l10n.t('URI'), value: summary.documentEndpoint },
        { label: l10n.t('Consistency'), value: summary.consistencyLevel ?? l10n.t('Unknown') },
        {
            label: l10n.t('Capacity mode'),
            value: summary.isServerless ? l10n.t('Serverless') : l10n.t('Provisioned throughput'),
        },
        {
            label: l10n.t('Total throughput limit'),
            value:
                summary.totalThroughputLimit !== undefined
                    ? `${summary.totalThroughputLimit} RU/s`
                    : l10n.t('No total throughput limit'),
        },
        { label: l10n.t('Backup policy'), value: summary.backupPolicyType ?? l10n.t('Unknown') },
        { label: l10n.t('Free tier'), value: summary.freeTierEnabled ? l10n.t('Enabled') : l10n.t('Opted out') },
        {
            label: l10n.t('Write locations'),
            value: summary.writeRegions.length ? summary.writeRegions.join(', ') : '—',
        },
        { label: l10n.t('Read locations'), value: summary.readRegions.length ? summary.readRegions.join(', ') : '—' },
    ];

    const regionsLabel = l10n.t('{write} write / {read} read', {
        write: summary.writeRegionCount,
        read: summary.readRegionCount,
    });

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
        <div className={styles.root}>
            <output className={styles.srOnly} aria-live="polite">
                {l10n.t('Account health: {status}', { status: health.label })}
            </output>
            <div className={styles.topRow}>
                <div className={styles.titleBlock}>
                    <div className={styles.titleRow}>
                        <Title2 as="h1" className={styles.title}>
                            {l10n.t('Account Overview')}
                        </Title2>
                        <Pill tone={health.tone}>{health.label}</Pill>
                    </div>
                    <Caption1 as="p" block className={styles.subtitle}>
                        {l10n.t('Capacity, throughput, and indexing posture for this Cosmos DB account.')}
                    </Caption1>
                </div>
                <div className={styles.controls}>
                    <Tooltip content={autoRefreshTooltip} relationship="description">
                        <Switch
                            checked={paused}
                            onChange={(_, data) => onTogglePause(data.checked)}
                            label={l10n.t('Pause auto-refresh')}
                        />
                    </Tooltip>
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<ArrowClockwise16Regular />}
                        onClick={onRefresh}
                        aria-label={l10n.t('Refresh')}
                    >
                        {l10n.t('Refresh')}
                    </Button>
                    <Text className={styles.refreshText}>
                        {l10n.t('Last refreshed at {time}', { time: lastRefreshedLabel })}
                    </Text>
                </div>
            </div>

            <div className={styles.chips}>
                <Pill tone="info">{summary.accountName}</Pill>
                <Pill>{l10n.t('API: {api}', { api: summary.apiType })}</Pill>
                {summary.isServerless && <Pill>{l10n.t('Serverless')}</Pill>}
                {summary.freeTierEnabled && <Pill>{l10n.t('Free tier')}</Pill>}
                <Pill>{l10n.t('Consistency: {level}', { level: summary.consistencyLevel ?? l10n.t('Unknown') })}</Pill>
                <Pill>{l10n.t('Regions: {regions}', { regions: regionsLabel })}</Pill>
                <Pill>{l10n.t('Resource group: {group}', { group: summary.resourceGroup })}</Pill>
            </div>

            <div className={styles.essentialsToggleRow}>
                <Link as="button" onClick={() => setEssentialsOpen((open) => !open)} aria-expanded={essentialsOpen}>
                    {essentialsOpen ? l10n.t('Show less') : l10n.t('More details')}
                </Link>
            </div>
            {essentialsOpen && (
                <div className={styles.essentialsGrid}>
                    {essentials.map((field) => (
                        <EssentialField key={field.label} label={field.label} value={field.value} />
                    ))}
                </div>
            )}
        </div>
    );
};
