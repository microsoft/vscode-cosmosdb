/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { Info16Filled, Warning16Filled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId } from 'react';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { summarizeCapacity } from './overviewCapacityModel';
import { formatSummaryValue, isNonNegativeFinite } from './overviewMetricsModel';
import {
    DetailStatistic,
    OverviewThroughputDetailDialog,
    useThroughputDetailStyles,
} from './OverviewThroughputDetailDialog';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

const useStyles = makeStyles({
    stats: {
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        '@media (max-width: 650px)': { gridTemplateColumns: '1fr' },
    },
    labels: { display: 'flex', justifyContent: 'space-between', gap: '16px', fontVariantNumeric: 'tabular-nums' },
    value: { flexShrink: 0 },
    consumed: { backgroundColor: 'var(--vscode-charts-blue, var(--vscode-textLink-foreground))' },
    headroom: { backgroundColor: 'var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))' },
    ceiling: { backgroundColor: 'var(--vscode-descriptionForeground)' },
    swatch: { display: 'inline-block', width: '10px', height: '10px', marginRight: '8px' },
    resources: { listStyleType: 'none', padding: 0, margin: 0 },
    resource: { padding: '8px 0', borderBottom: '1px solid var(--vscode-panel-border)' },
    warningNote: { display: 'flex', alignItems: 'baseline', gap: '8px', margin: '16px 0' },
    danger: { color: 'var(--vscode-errorForeground)' },
});

function formatRu(value: number | undefined): string {
    return isNonNegativeFinite(value) ? formatSummaryValue({ value, unit: 'RU/s' }) : l10n.t('Unavailable');
}

export function OverviewCapacityDetails({
    overview,
    analytics,
    onClose,
    onReviewPartitions,
}: {
    overview: AccountOverviewState;
    analytics: OverviewAnalyticsState;
    onClose: () => void;
    onReviewPartitions: () => void;
}) {
    const styles = useThroughputDetailStyles();
    const local = useStyles();
    const id = useId();
    const model = summarizeCapacity(overview, analytics);
    const { throughput, peak, provisioned, autoscale, comparable, headroom, ranked } = model;
    const serverless = overview.summary?.isServerless;
    const busy = overview.trendsLoading || analytics.loading;
    const scope = overview.selectedContainer;
    const scopeLabel = scope
        ? scope.containerId
            ? `${scope.databaseId} / ${scope.containerId}`
            : scope.databaseId
        : l10n.t('All databases');
    const range = {
        '1H': l10n.t('last hour'),
        '24H': l10n.t('last 24 hours'),
        '7D': l10n.t('last 7 days'),
    }[overview.timeRange];
    const provisionedNote =
        throughput.provisionedTimestamp === undefined
            ? throughput.provisioned.detail
            : l10n.t('Latest reported maximum provisioned throughput: {value} at {time}.', {
                  value: formatRu(provisioned),
                  time: new Date(throughput.provisionedTimestamp).toLocaleString(),
              });
    const reported = [
        { label: l10n.t('Peak consumed'), value: peak, color: local.consumed, capacity: false },
        {
            label: l10n.t('Latest reported provisioned maximum'),
            value: provisioned,
            color: local.headroom,
            capacity: true,
        },
        { label: l10n.t('Latest reported autoscale maximum'), value: autoscale, color: local.ceiling, capacity: true },
    ];
    const reportedScale = Math.max(...reported.map((row) => row.value ?? 0));
    const resourceScale = ranked[0]?.peakBucketAverageRuPerSecond ?? 0;
    const scenarios = [
        { label: l10n.t('Current peak'), multiplier: 1 },
        { label: l10n.t('+25% traffic'), multiplier: 1.25 },
        { label: l10n.t('2× traffic'), multiplier: 2 },
        { label: l10n.t('3× traffic'), multiplier: 3 },
    ];

    return (
        <OverviewThroughputDetailDialog
            title={l10n.t('Throughput capacity')}
            subtitle={l10n.t('Compare peak demand with reported provisioned throughput and autoscale maximum.')}
            busy={busy}
            onClose={onClose}
            onReviewPartitions={onReviewPartitions}
        >
            <p className={styles.note}>{l10n.t('Scope: {scope}. Window: {range}.', { scope: scopeLabel, range })}</p>
            <p className={styles.note}>
                {throughput.window ?? throughput.consumed.detail} {throughput.window && throughput.consumed.detail}
            </p>
            <dl className={mergeClasses(styles.stats, local.stats)}>
                <DetailStatistic
                    label={l10n.t('Peak consumed')}
                    value={formatRu(peak)}
                    detail={throughput.consumed.detail}
                />
                <DetailStatistic
                    label={
                        comparable
                            ? l10n.t('Available before scale-up (historical estimate)')
                            : l10n.t('Available before scale-up')
                    }
                    value={serverless ? l10n.t('Not applicable') : formatRu(headroom)}
                    detail={
                        comparable
                            ? l10n.t(
                                  'Historical difference only, floored at zero. Not available capacity now; manual throughput does not scale automatically.',
                              )
                            : model.comparisonNote
                    }
                />
                <DetailStatistic
                    label={l10n.t('Allocated (reported maximum)')}
                    value={serverless ? l10n.t('Not applicable') : formatRu(provisioned)}
                    detail={provisionedNote}
                />
            </dl>
            {model.stack ? (
                <>
                    <div className={local.labels}>
                        <span>{formatRu(0)}</span>
                        <span>{formatRu(provisioned)}</span>
                    </div>
                    <div className={styles.track} aria-hidden>
                        <span className={local.consumed} style={{ width: `${(peak! / provisioned!) * 100}%` }} />
                        <span className={local.headroom} style={{ width: `${(headroom! / provisioned!) * 100}%` }} />
                    </div>
                    <div className={styles.legend}>
                        <span>
                            <span className={mergeClasses(local.swatch, local.consumed)} aria-hidden />
                            {l10n.t('Peak consumed: {value}', { value: formatRu(peak) })}
                        </span>
                        <span>
                            <span className={mergeClasses(local.swatch, local.headroom)} aria-hidden />
                            {l10n.t('Historical difference: {value}', { value: formatRu(headroom) })}
                        </span>
                    </div>
                </>
            ) : (
                <ul className={local.resources}>
                    {reported.map((row) => (
                        <li key={row.label} className={local.resource}>
                            <div className={local.labels}>
                                <span>{row.label}</span>
                                <span className={local.value}>
                                    {serverless && row.capacity ? l10n.t('Not applicable') : formatRu(row.value)}
                                </span>
                            </div>
                            {isNonNegativeFinite(row.value) && (
                                <div className={styles.track} aria-hidden>
                                    <span
                                        className={row.color}
                                        style={{
                                            width: `${reportedScale > 0 ? (row.value / reportedScale) * 100 : 0}%`,
                                        }}
                                    />
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            <p className={styles.note}>{provisionedNote}</p>
            {!serverless && (
                <p className={styles.note}>
                    {autoscale === undefined
                        ? throughput.autoscale.detail
                        : l10n.t('Latest reported autoscale maximum: {value} at {time}.', {
                              value: formatRu(autoscale),
                              time: new Date(throughput.autoscaleTimestamp!).toLocaleString(),
                          })}
                </p>
            )}
            <p className={styles.note}>
                {l10n.t(
                    'Reported maxima are not sums of resource allocations or an account-wide autoscale ceiling. Separate bars share a visual scale, not a part-to-whole relationship.',
                )}
            </p>
            <p className={local.warningNote}>
                <Warning16Filled className={styles.warning} aria-hidden />
                <span>{model.comparisonNote}</span>
            </p>
            {comparable && (
                <p className={styles.note}>
                    {peak! > provisioned!
                        ? l10n.t('Range peak exceeds the latest reported provisioned throughput by {value}.', {
                              value: formatRu(peak! - provisioned!),
                          })
                        : l10n.t('Range peak is {value} below the latest reported provisioned throughput.', {
                              value: formatRu(headroom),
                          })}{' '}
                    {l10n.t('This manual-throughput comparison does not imply automatic scale-up.')}
                </p>
            )}
            <section className={styles.section}>
                <h2 className={styles.heading}>{l10n.t('Recommendations')}</h2>
                <dl className={styles.guidance}>
                    <dt>
                        <Warning16Filled className={styles.warning} aria-hidden />
                        {l10n.t('Watch current headroom')}
                    </dt>
                    <dd>
                        {l10n.t(
                            'Verify current resource throughput and recent demand before changing capacity. A period peak compared with a later sample does not establish current headroom.',
                        )}
                    </dd>
                    <dt>
                        <Info16Filled className={styles.info} aria-hidden />
                        {l10n.t('Review autoscale maximum')}
                    </dt>
                    <dd>
                        {serverless
                            ? l10n.t('Not applicable for this serverless account.')
                            : comparable
                              ? l10n.t(
                                    'The selected container uses dedicated manual throughput. No autoscale expansion is assumed.',
                                )
                              : l10n.t(
                                    'If autoscale is configured, review the owning container or shared database pool. A reported maximum does not establish a dedicated container allocation or an account-wide ceiling.',
                                )}
                    </dd>
                    <dt>
                        <Info16Filled className={styles.info} aria-hidden />
                        {l10n.t('Treat hot partitions separately')}
                    </dt>
                    <dd>
                        {l10n.t(
                            'Review partition-level utilization and throttling. Aggregate capacity does not remove per-partition limits or guarantee that a hot partition can serve more requests.',
                        )}
                    </dd>
                </dl>
            </section>
            <section className={styles.section}>
                <h2 className={styles.heading}>{l10n.t('Where peak RU/s is consumed')}</h2>
                <p className={styles.note}>{model.resources.detail}</p>
                {ranked.length === 0 ? (
                    <p className={styles.note}>
                        {l10n.t('No matched resource consumption measurements are available.')}
                    </p>
                ) : (
                    <ul className={local.resources}>
                        {ranked.map((resource) => (
                            <li key={`${resource.databaseId}/${resource.containerId}`} className={local.resource}>
                                <div className={local.labels}>
                                    <span>{`${resource.databaseId} / ${resource.containerId}`}</span>
                                    <span className={local.value}>
                                        {formatRu(resource.peakBucketAverageRuPerSecond)}
                                    </span>
                                </div>
                                <div className={styles.track} aria-hidden>
                                    <span
                                        className={local.consumed}
                                        style={{
                                            width: `${resourceScale > 0 ? (resource.peakBucketAverageRuPerSecond! / resourceScale) * 100 : 0}%`,
                                        }}
                                    />
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                <p className={styles.note}>
                    {l10n.t(
                        'Up to four measured resources, ranked by peak bucket-average RU/s. Bars are relative to the largest resource peak, not capacity. Resource peaks can occur at different times and must not be added together.',
                    )}
                </p>
            </section>
            <section className={styles.section}>
                <h2 id={`${id}-traffic`} className={styles.heading}>
                    {l10n.t('Capacity at projected traffic')}
                </h2>
                <div className={styles.tableFrame}>
                    <table className={styles.table} aria-labelledby={`${id}-traffic`}>
                        <thead>
                            <tr>
                                <th scope="col">{l10n.t('Traffic')}</th>
                                <th scope="col">{l10n.t('Demand')}</th>
                                <th scope="col">{l10n.t('Assessment')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {scenarios.map((scenario) => {
                                const demand = peak === undefined ? undefined : peak * scenario.multiplier;
                                const valid = isNonNegativeFinite(demand);
                                const over = comparable && valid && demand > provisioned!;
                                return (
                                    <tr key={scenario.multiplier}>
                                        <th scope="row">{scenario.label}</th>
                                        <td>{formatRu(demand)}</td>
                                        <td className={over ? local.danger : undefined}>
                                            {serverless
                                                ? l10n.t('Not applicable')
                                                : !valid
                                                  ? l10n.t('Unavailable: no valid demand estimate')
                                                  : !comparable
                                                    ? l10n.t('Not comparable')
                                                    : over
                                                      ? l10n.t('Over reported provisioned throughput')
                                                      : l10n.t('Within reported provisioned throughput')}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <p className={styles.note}>
                    {l10n.t(
                        'Linear demand estimates assume unchanged request cost and traffic distribution. They are not forecasts of successful requests, autoscale behavior, or service availability. Historical comparisons do not account for partition limits or changes in provisioned throughput.',
                    )}
                </p>
            </section>
        </OverviewThroughputDetailDialog>
    );
}
