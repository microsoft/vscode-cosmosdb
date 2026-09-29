/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Tooltip } from '@fluentui/react-components';
import { BracesRegular, ChevronDownRegular, ChevronUpRegular, CopyRegular, MoneyRegular } from '@fluentui/react-icons';
import { FocusableBadge } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { Fragment, useId, useState } from 'react';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { HEALTH_PRESENTATION, type Tone } from './dashboardModel';

const cosmosIcon = new URL('../../../../resources/azurecosmosdb.png', import.meta.url).href;

interface Fact {
    label: string;
    value: string;
    tooltip: string;
}

interface HeaderBadge {
    label: string;
    tooltip: string;
    color: 'success' | 'warning' | 'danger' | 'informative';
}

interface DetailRow {
    label: string;
    value: string;
    copyable?: boolean;
}

function regionsFact(regions: string[]): string {
    return regions.length <= 1 ? (regions[0] ?? l10n.t('Unknown')) : `${regions[0]} +${regions.length - 1}`;
}

export function collectResilienceBadges(overview: AccountOverviewState): HeaderBadge[] {
    const summary = overview.summary;
    if (!summary) {
        return [];
    }
    const badges: HeaderBadge[] = [];
    if (summary.provisioningState && summary.provisioningState !== 'Succeeded') {
        badges.push({
            label: summary.provisioningState,
            tooltip: l10n.t('The Azure resource reports provisioning state {state}.', {
                state: summary.provisioningState,
            }),
            color: summary.provisioningState === 'Failed' ? 'danger' : 'warning',
        });
    }
    if (summary.writeRegions.length > 1) {
        badges.push({
            label: l10n.t('Multi-region writes'),
            tooltip: l10n.t('Writes are accepted in {count} regions.', { count: summary.writeRegions.length }),
            color: 'success',
        });
    }
    if (summary.automaticFailoverEnabled !== undefined && summary.readRegions.length > 1) {
        badges.push(
            summary.automaticFailoverEnabled
                ? {
                      label: l10n.t('Automatic failover'),
                      tooltip: l10n.t('Service-managed failover is enabled across the account’s regions.'),
                      color: 'success',
                  }
                : {
                      label: l10n.t('Manual failover'),
                      tooltip: l10n.t('Service-managed failover is disabled; region failover is manual.'),
                      color: 'warning',
                  },
        );
    }
    if (summary.freeTierEnabled) {
        badges.push({
            label: l10n.t('Free tier'),
            tooltip: l10n.t('The first 1000 RU/s and 25 GB of storage are free on this account.'),
            color: 'informative',
        });
    }
    return badges;
}

function collectFacts(overview: AccountOverviewState): Fact[] {
    const summary = overview.summary;
    if (!summary) {
        return [];
    }
    const regions = [...new Set([...summary.writeRegions, ...summary.readRegions])];
    return [
        {
            label: l10n.t('API'),
            value: summary.apiType,
            tooltip: l10n.t('The API this account exposes.'),
        },
        {
            label: l10n.t('Capacity'),
            value: summary.isServerless ? l10n.t('Serverless') : l10n.t('Provisioned'),
            tooltip: summary.isServerless
                ? l10n.t('Serverless accounts are billed per request unit consumed.')
                : l10n.t('Provisioned throughput is reserved per database or container, manually or with autoscale.'),
        },
        {
            label: l10n.t('Consistency'),
            value: summary.consistencyLevel ?? l10n.t('Unknown'),
            tooltip: l10n.t('Default consistency level for reads on this account.'),
        },
        {
            label: l10n.t('Regions'),
            value: regionsFact(regions),
            tooltip: regions.join(', ') || l10n.t('No regions reported.'),
        },
    ];
}

function collectDetails(overview: AccountOverviewState): { title: string; rows: DetailRow[] }[] {
    const summary = overview.summary;
    if (!summary) {
        return [];
    }
    const yesNo = (value: boolean | undefined) =>
        value === undefined ? l10n.t('Unknown') : value ? l10n.t('Enabled') : l10n.t('Disabled');
    const retention =
        summary.backupRetentionHours === undefined
            ? summary.continuousBackupTier
            : summary.backupRetentionHours % 24 === 0
              ? l10n.t('{days} days retention', { days: summary.backupRetentionHours / 24 })
              : l10n.t('{hours} hours retention', { hours: summary.backupRetentionHours });
    return [
        {
            title: l10n.t('Account'),
            rows: [
                { label: l10n.t('Endpoint'), value: summary.documentEndpoint, copyable: true },
                { label: l10n.t('Resource group'), value: summary.resourceGroup },
                { label: l10n.t('Subscription'), value: summary.subscriptionName },
                { label: l10n.t('Subscription ID'), value: summary.subscriptionId, copyable: true },
                { label: l10n.t('Provisioning state'), value: summary.provisioningState ?? l10n.t('Unknown') },
                {
                    label: l10n.t('Throughput limit'),
                    value:
                        summary.totalThroughputLimit === undefined
                            ? l10n.t('Unknown')
                            : summary.totalThroughputLimit === -1
                              ? l10n.t('Unlimited')
                              : l10n.t('{ru} RU/s', { ru: summary.totalThroughputLimit.toLocaleString() }),
                },
                { label: l10n.t('Free tier'), value: yesNo(summary.freeTierEnabled) },
            ],
        },
        {
            title: l10n.t('Resilience and backup'),
            rows: [
                { label: l10n.t('Write regions'), value: summary.writeRegions.join(', ') || l10n.t('Unknown') },
                { label: l10n.t('Read regions'), value: summary.readRegions.join(', ') || l10n.t('Unknown') },
                { label: l10n.t('Automatic failover'), value: yesNo(summary.automaticFailoverEnabled) },
                { label: l10n.t('Consistency'), value: summary.consistencyLevel ?? l10n.t('Unknown') },
                {
                    label: l10n.t('Backup policy'),
                    value: retention
                        ? l10n.t('{policy} ({retention})', {
                              policy: summary.backupPolicyType ?? l10n.t('Unknown'),
                              retention,
                          })
                        : (summary.backupPolicyType ?? l10n.t('Unknown')),
                },
            ],
        },
    ];
}

const toBadgeColor = (tone: Tone): HeaderBadge['color'] | 'subtle' => tone;

/**
 * The shaded identity band: icon and account name, then its state, liveness, resilience badges and key facts. The
 * cold facts wait behind the details disclosure, which also carries the JSON and cost hand-offs.
 */
export function DashboardHeader({ overview }: { overview: AccountOverviewState }) {
    const [expanded, setExpanded] = useState(false);
    const id = useId();
    const summary = overview.summary;
    const health = overview.accountHealth ? HEALTH_PRESENTATION[overview.accountHealth] : undefined;
    const facts = collectFacts(overview);
    const badges = collectResilienceBadges(overview);
    const details = collectDetails(overview);
    const updated = new Date(overview.lastRefreshedAt).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    });

    return (
        <>
            <header className="dashboardHeader">
                <div className="dashboardHeaderIdentityGroup">
                    <div className="dashboardHeaderIcon" aria-hidden="true">
                        <img src={cosmosIcon} alt="" />
                    </div>
                    <div className="dashboardHeaderIdentity">
                        <h1 className="dashboardHeaderTitle" title={summary?.accountName}>
                            {summary?.accountName ?? l10n.t('Loading…')}
                        </h1>
                    </div>
                </div>

                <div className="dashboardHeaderStatus">
                    {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a labelled group of inline status items, as in the DocumentDB header */}
                    <div className="dashboardHeaderItems" role="group" aria-label={l10n.t('Account status')}>
                        <Tooltip
                            content={l10n.t(
                                'Derived from provisioning state, sustained throttling, fired Azure Monitor alerts and high-impact Advisor recommendations.',
                            )}
                            relationship="description"
                            withArrow
                        >
                            <FocusableBadge
                                className="dashboardStatusBadge"
                                appearance="tint"
                                shape="rounded"
                                color={health ? toBadgeColor(health.tone) : 'informative'}
                            >
                                {health?.label ?? l10n.t('Checking health…')}
                            </FocusableBadge>
                        </Tooltip>
                        <Tooltip
                            content={
                                overview.paused
                                    ? l10n.t('Auto-refresh is paused. Use Refresh to update on demand.')
                                    : l10n.t(
                                          'Metrics refresh every {seconds} s and inventory telemetry every {inventory} s while this panel is visible.',
                                          {
                                              seconds: overview.autoRefreshIntervalsSeconds.metrics,
                                              inventory: overview.autoRefreshIntervalsSeconds.inventory,
                                          },
                                      )
                            }
                            relationship="description"
                            withArrow
                        >
                            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus exposes the refresh tooltip */}
                            <span className="dashboardHeaderLive" tabIndex={0}>
                                <span className="dashboardLiveDot" data-paused={overview.paused} aria-hidden="true" />
                                <span>
                                    {overview.paused
                                        ? l10n.t('Paused · {time}', { time: updated })
                                        : l10n.t('Live · {time}', { time: updated })}
                                </span>
                            </span>
                        </Tooltip>
                        {badges.map((badge) => (
                            <span className="dashboardFactSegment" key={badge.label}>
                                <span className="dashboardFactSeparator" aria-hidden="true">
                                    |
                                </span>
                                <Tooltip content={badge.tooltip} relationship="description" withArrow>
                                    <FocusableBadge
                                        className="dashboardResilienceBadge"
                                        appearance="outline"
                                        shape="rounded"
                                        color={badge.color}
                                    >
                                        {badge.label}
                                    </FocusableBadge>
                                </Tooltip>
                            </span>
                        ))}
                        {facts.map((fact, index) => (
                            <Tooltip content={fact.tooltip} relationship="description" withArrow key={fact.label}>
                                <span
                                    className="dashboardFactSegment"
                                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- names the label/value pair for its tooltip
                                    role="group"
                                    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus exposes the fact tooltip
                                    tabIndex={0}
                                    aria-labelledby={`${id}-fact-${index}-label ${id}-fact-${index}-value`}
                                >
                                    <span className="dashboardFactName">
                                        <span className="dashboardFactSeparator" aria-hidden="true">
                                            |
                                        </span>
                                        <span className="dashboardFactLabel" id={`${id}-fact-${index}-label`}>
                                            {fact.label}
                                        </span>
                                    </span>
                                    <span className="dashboardFactValue" id={`${id}-fact-${index}-value`}>
                                        {fact.value}
                                    </span>
                                </span>
                            </Tooltip>
                        ))}
                    </div>
                    {details.length > 0 && (
                        <Button
                            appearance="outline"
                            size="small"
                            className="dashboardDisclosure"
                            aria-expanded={expanded}
                            aria-controls={`${id}-details`}
                            icon={expanded ? <ChevronUpRegular /> : <ChevronDownRegular />}
                            iconPosition="after"
                            onClick={() => setExpanded(!expanded)}
                        >
                            <span className="dashboardDisclosureLabel">
                                <span aria-hidden={!expanded} data-inactive={!expanded}>
                                    {l10n.t('Hide details')}
                                </span>
                                <span aria-hidden={expanded} data-inactive={expanded}>
                                    {l10n.t('Show details')}
                                </span>
                            </span>
                        </Button>
                    )}
                </div>
            </header>
            {expanded && (
                <div className="dashboardDetailsRegion" id={`${id}-details`}>
                    <Card className="dashboardDetailsPanel" appearance="filled">
                        <div className="dashboardDetailsGroups">
                            {details.map((group) => (
                                <section key={group.title}>
                                    <h2 className="dashboardDetailsGroupTitle">{group.title}</h2>
                                    <dl className="dashboardDetailsGrid">
                                        {group.rows.map((row) => (
                                            <Fragment key={row.label}>
                                                <dt className="dashboardDetailLabel">{row.label}</dt>
                                                <dd className="dashboardDetailValue">
                                                    <span className="dashboardDetailText" title={row.value}>
                                                        {row.value}
                                                    </span>
                                                    {row.copyable && (
                                                        <Tooltip
                                                            content={l10n.t('Copy {0}', row.label)}
                                                            relationship="label"
                                                            withArrow
                                                        >
                                                            <Button
                                                                appearance="transparent"
                                                                size="small"
                                                                className="dashboardDetailCopy"
                                                                icon={<CopyRegular />}
                                                                onClick={() =>
                                                                    void navigator.clipboard.writeText(row.value)
                                                                }
                                                            />
                                                        </Tooltip>
                                                    )}
                                                </dd>
                                            </Fragment>
                                        ))}
                                    </dl>
                                </section>
                            ))}
                        </div>
                        <div className="dashboardDetailsFooter">
                            <Button
                                appearance="secondary"
                                size="small"
                                icon={<BracesRegular />}
                                disabled={overview.accountActionBusy}
                                onClick={() => void overview.runAccountAction({ action: 'openJson' })}
                            >
                                {l10n.t('View Account JSON')}
                            </Button>
                            <Button
                                appearance="secondary"
                                size="small"
                                icon={<MoneyRegular />}
                                disabled={overview.accountActionBusy}
                                onClick={() => void overview.runAccountAction({ action: 'openCosts' })}
                            >
                                {l10n.t('View Cost')}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </>
    );
}
