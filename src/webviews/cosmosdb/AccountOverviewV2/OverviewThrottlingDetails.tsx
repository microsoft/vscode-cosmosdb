/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { Info16Filled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId } from 'react';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { formatSummaryValue } from './overviewMetricsModel';
import { relativeThrottlingChange, throttledRequestDistribution } from './overviewThrottlingDetailsModel';
import {
    DetailStatistic,
    OverviewThroughputDetailDialog,
    useThroughputDetailStyles,
} from './OverviewThroughputDetailDialog';
import { formatRateDelta, summarizeThroughput, THROTTLING_GUIDE_PERCENT } from './overviewThroughputModel';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

const useStyles = makeStyles({
    legend: { listStyleType: 'none', padding: 0 },
    item: { display: 'flex', alignItems: 'baseline', gap: '8px' },
    swatch: {
        width: '9px',
        height: '9px',
        flexShrink: 0,
        border: '1px solid var(--vscode-contrastBorder, transparent)',
    },
    segment: { height: '100%', flexShrink: 0 },
    table: {
        '& th, & th:not(:first-child), & td:not(:first-child)': { textAlign: 'left', padding: '6px 12px 6px 0' },
    },
});

const colors = [
    'var(--vscode-charts-orange, var(--vscode-errorForeground))',
    'var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))',
    'var(--vscode-charts-blue, var(--vscode-textLink-foreground))',
];
const otherColor = 'var(--vscode-descriptionForeground)';
const percent = (value: number) => formatSummaryValue({ value, unit: '%' });

export function OverviewThrottlingDetails({
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
    const busy = overview.trendsLoading || analytics.loading;
    const context = {
        timeRange: overview.timeRange,
        scope: overview.selectedContainer,
        loading: busy,
        serverless: overview.summary?.isServerless,
    };
    const result = summarizeThroughput(
        overview.trends.normalizedRu,
        overview.trends.provisionedThroughput,
        busy ? { loading: true, failed: false } : analytics,
        context,
    );
    const distribution = throttledRequestDistribution(analytics, context, overview.inventory);
    // A previous value is usable only after summarizeThroughput validates its scope and adjacent equal-duration window.
    const previous = result.delta === undefined ? undefined : analytics.data?.previousThrottling?.ratePercent;
    const change = relativeThrottlingChange(result.throttling.value, previous);
    const unavailable = busy ? l10n.t('Loading…') : l10n.t('Unavailable');
    const changeDetail =
        result.delta === undefined
            ? l10n.t('A validated preceding equal-duration window is required to compare rates.')
            : l10n.t(
                  'Percentage-point change: {change}. Relative change divides the rate difference by the previous rate; it is unavailable when the previous rate is zero or the result is not finite.',
                  { change: formatRateDelta(result.delta) },
              );
    const scope = overview.selectedContainer;
    const scopeLabel = scope
        ? scope.containerId
            ? `${scope.databaseId} / ${scope.containerId}`
            : scope.databaseId
        : l10n.t('Account-wide');
    const previousLabel = {
        '1H': l10n.t('Previous hour'),
        '24H': l10n.t('Previous 24 hours'),
        '7D': l10n.t('Previous 7 days'),
    }[overview.timeRange];
    const shareLabel = (resource: { databaseId: string; containerId: string } | undefined) =>
        resource ? `${resource.databaseId} / ${resource.containerId}` : l10n.t('Other / unattributed');
    const leading = distribution.shares.find((share) => share.resource !== undefined);
    const requestFields = [
        l10n.t('Time'),
        l10n.t('Operation'),
        l10n.t('Resource / PK value'),
        l10n.t('Retry after'),
        l10n.t('Outcome'),
    ];

    return (
        <OverviewThroughputDetailDialog
            title={l10n.t('429 throttling')}
            subtitle={l10n.t('Percentage of measured requests that returned 429 when available RU/s was exceeded.')}
            busy={busy}
            onClose={onClose}
            onReviewPartitions={onReviewPartitions}
        >
            <dl className={styles.stats}>
                <DetailStatistic
                    label={l10n.t('Current')}
                    value={result.throttling.value === undefined ? unavailable : percent(result.throttling.value)}
                    detail={l10n.t('Measured window-total 429 requests divided by total requests, not a live rate.')}
                />
                <DetailStatistic
                    label={previousLabel}
                    value={previous === undefined ? unavailable : percent(previous)}
                    detail={l10n.t('The immediately preceding equal-duration window for the same scope.')}
                />
                <DetailStatistic
                    label={l10n.t('Relative change')}
                    value={
                        change === undefined
                            ? unavailable
                            : `${change > 0 ? '+' : change < 0 ? '−' : ''}${percent(Math.abs(change))}`
                    }
                    detail={changeDetail}
                    tone={change !== undefined && change > 0 ? 'danger' : 'warning'}
                />
                <DetailStatistic
                    label={l10n.t('Investigation guide')}
                    value={percent(THROTTLING_GUIDE_PERCENT)}
                    detail={l10n.t(
                        '5% is an investigation guide, not a detector threshold, SLA, or automatic failure.',
                    )}
                    tone="success"
                />
            </dl>
            <p className={styles.note}>{l10n.t('Scope: {scope}', { scope: scopeLabel })}</p>
            <p className={styles.note}>{result.throttling.detail}</p>
            {result.window && <p className={styles.note}>{result.window}</p>}
            <p className={styles.note}>{changeDetail}</p>
            <p className={styles.note}>
                {l10n.t('5% is an investigation guide, not a detector threshold, SLA, or automatic failure.')}
            </p>

            <section className={styles.section} aria-labelledby={`${id}-distribution`}>
                <h3 className={styles.heading} id={`${id}-distribution`}>
                    {l10n.t('Throttled requests')}
                </h3>
                {distribution.total !== undefined && (
                    <p className={styles.note}>
                        {l10n.t('{count} measured 429 requests in the selected scope and window.', {
                            count: distribution.total.toLocaleString(),
                        })}
                    </p>
                )}
                {distribution.shares.length > 0 && (
                    <>
                        <div className={styles.track} aria-hidden="true">
                            {distribution.shares.map((share, index) => (
                                <div
                                    key={index}
                                    className={local.segment}
                                    style={{
                                        width: `${share.percent}%`,
                                        backgroundColor: share.resource ? colors[index] : otherColor,
                                    }}
                                />
                            ))}
                        </div>
                        <ul className={mergeClasses(styles.legend, local.legend)}>
                            {distribution.shares.map((share, index) => (
                                <li key={index} className={local.item}>
                                    <span
                                        className={local.swatch}
                                        aria-hidden="true"
                                        style={{ backgroundColor: share.resource ? colors[index] : otherColor }}
                                    />
                                    <span>
                                        {l10n.t('{container}: {count} requests ({share})', {
                                            container: shareLabel(share.resource),
                                            count: share.count.toLocaleString(),
                                            share: percent(share.percent),
                                        })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
                <p className={styles.note}>{distribution.detail}</p>
                <dl className={styles.guidance}>
                    <dt>
                        <Info16Filled className={styles.info} aria-hidden="true" />
                        {l10n.t('Container-level evidence')}
                    </dt>
                    <dd>
                        {leading &&
                            l10n.t('{container} accounts for {share} of measured 429 requests in this scope. ', {
                                container: shareLabel(leading.resource),
                                share: percent(leading.percent),
                            })}
                        {l10n.t(
                            'Container concentration does not establish a hot logical partition. Aggregate metrics do not identify logical partition-key values or retry outcomes.',
                        )}
                    </dd>
                </dl>
            </section>

            <section className={styles.section} aria-labelledby={`${id}-guidance`}>
                <h3 className={styles.heading} id={`${id}-guidance`}>
                    {l10n.t('Recommendations')}
                </h3>
                <dl className={styles.guidance}>
                    <dt>
                        <Info16Filled className={styles.info} aria-hidden="true" />
                        {l10n.t('Inspect affected requests')}
                    </dt>
                    <dd>
                        {l10n.t(
                            'Use available request-level telemetry to identify operations and resources returning 429. Partition-key values require telemetry that actually captures them.',
                        )}
                    </dd>
                    <dt>
                        <Info16Filled className={styles.info} aria-hidden="true" />
                        {l10n.t('Review partition-key distribution')}
                    </dt>
                    <dd>
                        {l10n.t(
                            'Compare partition utilization and workload distribution. A large container share alone does not identify a hot tenant, entity, or logical partition.',
                        )}
                    </dd>
                    <dt>
                        <Info16Filled className={styles.info} aria-hidden="true" />
                        {l10n.t('Check retry and latency impact')}
                    </dt>
                    <dd>
                        {l10n.t(
                            'Use SDK or application telemetry to verify retry outcomes and end-to-end latency against your objectives. Service-side aggregate metrics cannot confirm successful retries.',
                        )}
                    </dd>
                </dl>
            </section>

            <section className={styles.section} aria-labelledby={`${id}-requests`}>
                <h3 className={styles.heading} id={`${id}-requests`}>
                    {l10n.t('Affected requests')}
                </h3>
                <div className={styles.tableFrame}>
                    <table className={mergeClasses(styles.table, local.table)} aria-labelledby={`${id}-requests`}>
                        <thead>
                            <tr>
                                {requestFields.map((field) => (
                                    <th key={field} scope="col">
                                        {field}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td colSpan={requestFields.length}>
                                    {l10n.t(
                                        'Request-level details are unavailable here. The current data source provides aggregate counts, not individual request times, operations, partition-key values, retry-after delays, or SDK outcomes.',
                                    )}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p className={styles.note}>
                    {l10n.t(
                        'Correlate suitable request logs with SDK or application telemetry where available. Enabling service diagnostics alone does not guarantee visibility into client retries or final outcomes.',
                    )}
                </p>
            </section>
        </OverviewThroughputDetailDialog>
    );
}
