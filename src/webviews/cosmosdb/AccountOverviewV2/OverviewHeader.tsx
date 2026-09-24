/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Switch, tokens, useAnnounce } from '@fluentui/react-components';
import { ArrowClockwise16Regular, ChevronDown16Regular, ChevronUp16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId, useState } from 'react';
import { type ProvisioningState, type TimeRange } from '../../api/types';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';

const useStyles = makeStyles({
    root: { display: 'flex', flexDirection: 'column', gap: '20px' },
    row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalM,
    },
    controls: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', fontSize: '12px' },
    identity: { display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 },
    icon: { width: '32px', height: '32px', flexShrink: 0 },
    title: { margin: 0, fontSize: '20px', lineHeight: '28px', fontWeight: 600 },
    description: { margin: 0, color: 'var(--vscode-descriptionForeground)', fontSize: '12px' },
    link: { color: 'var(--vscode-textLink-foreground)' },
    refreshOptions: {
        position: 'relative',
        '& > summary': { cursor: 'pointer', color: 'var(--vscode-descriptionForeground)', fontSize: '11px' },
    },
    refreshPanel: {
        position: 'absolute',
        right: 0,
        top: '24px',
        zIndex: 2,
        width: 'min(300px, calc(100vw - 40px))',
        boxSizing: 'border-box',
        padding: '12px',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: '6px',
        backgroundColor: 'var(--vscode-editorWidget-background)',
    },
    status: {
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: '8px',
        padding: '8px 12px',
        fontSize: '12px',
        backgroundColor: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
    },
    statusItems: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px', flex: 1 },
    statusItem: { display: 'inline-flex', alignItems: 'center', gap: '16px' },
    separator: { color: 'var(--vscode-panel-border)', flexShrink: 0 },
    details: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '12px 40px',
        margin: '16px 0',
        '@media (max-width: 700px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
    },
    pair: {
        display: 'grid',
        gridTemplateColumns: 'minmax(90px, 1fr) minmax(0, 2fr)',
        gap: '16px',
        alignItems: 'baseline',
        '& dt': { color: 'var(--vscode-descriptionForeground)' },
    },
    detailBody: { borderTop: '1px solid var(--vscode-panel-border)', margin: '8px -12px -8px', padding: '0 14px 12px' },
    detailFooter: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' },
    more: {
        marginLeft: 'auto',
        fontSize: '11px',
        '& > summary': { cursor: 'pointer', color: 'var(--vscode-descriptionForeground)' },
        '&[open]': { flexBasis: '100%', marginLeft: 0 },
    },
    value: { margin: 0, textAlign: 'right', overflowWrap: 'anywhere' },
    select: {
        color: 'var(--vscode-descriptionForeground)',
        backgroundColor: 'var(--vscode-editor-background)',
        border: '1px solid transparent',
        borderRadius: tokens.borderRadiusMedium,
        padding: tokens.spacingHorizontalS,
        maxWidth: '100%',
        font: 'inherit',
        ':focus-visible': { outline: '1px solid var(--vscode-focusBorder)' },
    },
});

const cosmosIcon = new URL('../../../../resources/azurecosmosdb.png', import.meta.url).href;

const provisioningLabels: Record<ProvisioningState, string> = {
    Succeeded: l10n.t('Succeeded'),
    Creating: l10n.t('Creating'),
    Updating: l10n.t('Updating'),
    Deleting: l10n.t('Deleting'),
    Failed: l10n.t('Failed'),
    Canceled: l10n.t('Canceled'),
};

export function OverviewHeader({ overview: o }: { overview: AccountOverviewState }) {
    const styles = useStyles();
    const id = useId();
    const [expanded, setExpanded] = useState(false);
    const { announce } = useAnnounce();
    const summary = o.summary;
    if (!summary) {
        return null;
    }
    const unknown = l10n.t('Unknown');
    const yesNo = (value: boolean) => (value ? l10n.t('Enabled') : l10n.t('Disabled'));
    const backupRetention =
        summary.backupRetentionHours === undefined
            ? summary.continuousBackupTier
            : summary.backupRetentionHours % 24 === 0
              ? l10n.t('{days} days retention', { days: summary.backupRetentionHours / 24 })
              : l10n.t('{hours} hours retention', { hours: summary.backupRetentionHours });
    const fields: [string, string][] = [
        [l10n.t('Resource group'), summary.resourceGroup],
        [l10n.t('URI'), summary.documentEndpoint],
        [l10n.t('Subscription'), summary.subscriptionName],
        [l10n.t('Read locations'), summary.readRegions.join(', ') || unknown],
        [l10n.t('Subscription ID'), summary.subscriptionId],
        [l10n.t('Write locations'), summary.writeRegions.join(', ') || unknown],
        [
            l10n.t('Backup policy'),
            backupRetention
                ? l10n.t('{policy} ({retention})', {
                      policy: summary.backupPolicyType ?? unknown,
                      retention: backupRetention,
                  })
                : (summary.backupPolicyType ?? unknown),
        ],
        [l10n.t('Free tier'), yesNo(summary.freeTierEnabled)],
    ];
    const additionalFields: [string, string][] = [
        [l10n.t('Consistency'), summary.consistencyLevel ?? unknown],
        [
            l10n.t('Backup retention'),
            summary.backupRetentionHours === undefined
                ? (summary.continuousBackupTier ?? unknown)
                : l10n.t('{hours} hours', { hours: summary.backupRetentionHours }),
        ],
        [
            l10n.t('Backup interval'),
            summary.backupIntervalMinutes === undefined
                ? unknown
                : l10n.t('{minutes} minutes', { minutes: summary.backupIntervalMinutes }),
        ],
        [
            l10n.t('Automatic failover'),
            summary.automaticFailoverEnabled === undefined ? unknown : yesNo(summary.automaticFailoverEnabled),
        ],
        [
            l10n.t('Total throughput limit'),
            summary.totalThroughputLimit === undefined
                ? unknown
                : summary.totalThroughputLimit === -1
                  ? l10n.t('Unlimited')
                  : `${summary.totalThroughputLimit.toLocaleString()} RU/s`,
        ],
    ];
    const databases = o.inventory?.databases ?? [...new Set(o.containers.map((c) => c.databaseId))];
    const regions = [...new Set([...summary.writeRegions, ...summary.readRegions])];
    const scopes = databases.map((databaseId) => ({ databaseId, containerId: undefined }));
    const scopeIndex = scopes.findIndex(
        (scope) =>
            scope.databaseId === o.selectedContainer?.databaseId &&
            scope.containerId === o.selectedContainer?.containerId,
    );

    return (
        <header className={styles.root}>
            <div className={styles.row}>
                <div className={styles.identity}>
                    <img className={styles.icon} src={cosmosIcon} alt="" />
                    <div>
                        <h1 className={styles.title}>{summary.accountName}</h1>
                        <p className={styles.description}>{l10n.t('Azure Cosmos DB account')}</p>
                    </div>
                </div>
                <div className={styles.controls}>
                    <select
                        className={styles.select}
                        aria-label={l10n.t('Metric time range')}
                        value={o.timeRange}
                        onChange={(event) => o.setTimeRange(event.target.value as TimeRange)}
                    >
                        <option value="1H">{l10n.t('Last hour')}</option>
                        <option value="24H">{l10n.t('Last 24 hours')}</option>
                        <option value="7D">{l10n.t('Last 7 days')}</option>
                    </select>
                    <select
                        id={`${id}-scope`}
                        className={styles.select}
                        aria-label={l10n.t('Metric scope')}
                        value={scopeIndex}
                        onChange={(event) => o.setSelectedContainer(scopes[Number(event.target.value)])}
                    >
                        <option value={-1}>{l10n.t('All Databases')}</option>
                        {scopes.map((scope, index) => (
                            <option key={scope.databaseId} value={index}>
                                {scope.databaseId}
                            </option>
                        ))}
                    </select>
                    {regions.length > 1 && <span className={styles.description}>{l10n.t('All regions')}</span>}
                    <Button
                        appearance="subtle"
                        size="small"
                        className={styles.link}
                        icon={<ArrowClockwise16Regular aria-hidden />}
                        onClick={o.refresh}
                    >
                        {l10n.t('Refresh')}
                    </Button>
                    <details className={styles.refreshOptions}>
                        <summary>{o.paused ? l10n.t('Auto-refresh paused') : l10n.t('Refresh options')}</summary>
                        <div className={styles.refreshPanel}>
                            <span>
                                {l10n.t('Refreshed {time}', { time: new Date(o.lastRefreshedAt).toLocaleTimeString() })}
                            </span>
                            <Switch
                                label={l10n.t('Pause auto-refresh')}
                                checked={o.paused}
                                onChange={(_, data) => {
                                    o.setPaused(data.checked);
                                    announce(
                                        data.checked ? l10n.t('Auto-refresh paused.') : l10n.t('Auto-refresh resumed.'),
                                        { polite: true },
                                    );
                                }}
                            />
                            <p className={styles.description}>
                                {l10n.t(
                                    'Time and scope apply to metric trends. Resource inventory is account-wide; alerts, growth and detectors use their own labeled windows.',
                                )}
                            </p>
                        </div>
                    </details>
                </div>
            </div>
            <div className={styles.status}>
                <div className={styles.row}>
                    <div className={styles.statusItems}>
                        <span className={styles.statusItem}>
                            {l10n.t('Provisioning: {state}', {
                                state: summary.provisioningState
                                    ? provisioningLabels[summary.provisioningState]
                                    : unknown,
                            })}
                            <span className={styles.separator} aria-hidden="true">
                                |
                            </span>
                        </span>
                        <span className={styles.statusItem}>
                            {l10n.t('Regions: {regions}', {
                                regions: regions.join(', ') || unknown,
                            })}
                            <span className={styles.separator} aria-hidden="true">
                                |
                            </span>
                        </span>
                        <span className={styles.statusItem}>
                            {l10n.t('Capacity mode: {mode}', {
                                mode: summary.isServerless ? l10n.t('Serverless') : l10n.t('Provisioned throughput'),
                            })}
                            <span className={styles.separator} aria-hidden="true">
                                |
                            </span>
                        </span>
                        <span>
                            {l10n.t('Total throughput limit: {limit}', {
                                limit:
                                    summary.totalThroughputLimit === undefined
                                        ? unknown
                                        : summary.totalThroughputLimit === -1
                                          ? l10n.t('Unlimited')
                                          : `${summary.totalThroughputLimit.toLocaleString()} RU/s`,
                            })}
                        </span>
                    </div>
                    <Button
                        appearance="subtle"
                        size="small"
                        className={styles.link}
                        icon={expanded ? <ChevronUp16Regular aria-hidden /> : <ChevronDown16Regular aria-hidden />}
                        iconPosition="after"
                        id={`${id}-toggle`}
                        aria-expanded={expanded}
                        aria-controls={`${id}-details`}
                        onClick={() => setExpanded(!expanded)}
                    >
                        {l10n.t('Account details')}
                    </Button>
                </div>
                <section
                    className={styles.detailBody}
                    id={`${id}-details`}
                    aria-labelledby={`${id}-toggle`}
                    hidden={!expanded}
                >
                    <dl className={styles.details}>
                        {fields.map(([label, value]) => (
                            <div key={label} className={styles.pair}>
                                <dt>{label}</dt>
                                <dd className={styles.value}>{value}</dd>
                            </div>
                        ))}
                    </dl>
                    <div className={styles.detailFooter}>
                        <Button
                            appearance="subtle"
                            size="small"
                            className={styles.link}
                            disabled={o.accountActionBusy}
                            onClick={() => void o.runAccountAction({ action: 'openCosts' })}
                        >
                            {l10n.t('View cost')}
                        </Button>
                        <Button
                            appearance="subtle"
                            size="small"
                            className={styles.link}
                            disabled={o.accountActionBusy}
                            onClick={() => void o.runAccountAction({ action: 'openJson' })}
                        >
                            {l10n.t('JSON view')}
                        </Button>
                        <details className={styles.more}>
                            <summary>{l10n.t('Additional account properties')}</summary>
                            <dl className={styles.details}>
                                <div className={styles.pair}>
                                    <dt>{l10n.t('API type')}</dt>
                                    <dd className={styles.value}>{summary.apiType}</dd>
                                </div>
                                {additionalFields.map(([label, value]) => (
                                    <div key={label} className={styles.pair}>
                                        <dt>{label}</dt>
                                        <dd className={styles.value}>{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </details>
                    </div>
                </section>
            </div>
        </header>
    );
}
