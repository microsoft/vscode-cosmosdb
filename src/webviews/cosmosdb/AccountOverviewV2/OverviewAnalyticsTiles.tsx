/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { unavailableSummary } from './overviewFindingsModel';
import { formatSummaryValue } from './overviewMetricsModel';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

const useStyles = makeStyles({
    statistic: { margin: 0, minWidth: 0 },
    label: { fontSize: tokens.fontSizeBase200, color: 'var(--vscode-descriptionForeground)' },
    value: { margin: '6px 0', fontSize: '28px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
    detail: { margin: '6px 0', fontSize: tokens.fontSizeBase200, color: 'var(--vscode-descriptionForeground)' },
    window: { gridColumn: '1 / -1', margin: 0, color: 'var(--vscode-descriptionForeground)' },
});

export function OverviewAnalyticsTiles({ analytics }: { analytics: OverviewAnalyticsState }) {
    const styles = useStyles();
    const { data, failed, loading } = analytics;
    const pending = loading ? l10n.t('Loading…') : undefined;
    return (
        <>
            <dl className={styles.statistic}>
                <dt className={styles.label}>{l10n.t('429 throttling rate')}</dt>
                <dd className={styles.value}>
                    {pending ??
                        formatSummaryValue({
                            value: data?.throttling.available ? data.throttling.ratePercent : undefined,
                            unit: '%',
                        })}
                </dd>
                <dd className={styles.detail}>
                    {!loading && data?.throttling.available
                        ? l10n.t('{throttled} of {total} measured requests returned 429.', {
                              throttled: data.throttling.throttledRequests?.toLocaleString() ?? l10n.t('Unknown'),
                              total: data.throttling.totalRequests?.toLocaleString() ?? l10n.t('Unknown'),
                          })
                        : !loading && !failed
                          ? unavailableSummary(data?.throttling.reason)
                          : null}
                </dd>
                <dd className={styles.detail}>
                    {l10n.t(
                        'Window total of 429 requests divided by total requests; no requests means no measured rate.',
                    )}
                </dd>
            </dl>
            <dl className={styles.statistic}>
                <dt className={styles.label}>{l10n.t('Peak bucket-average consumed RU/s')}</dt>
                <dd className={styles.value}>
                    {pending ??
                        formatSummaryValue({
                            value: data?.consumedRu.available
                                ? data.consumedRu.peakBucketAverageRuPerSecond
                                : undefined,
                            unit: 'RU/s',
                        })}
                </dd>
                <dd className={styles.detail}>
                    {!loading && data?.consumedRu.available
                        ? l10n.t('Maximum bucket RU divided by {seconds} seconds; not an instantaneous peak.', {
                              seconds: data.consumedRu.bucketSeconds,
                          })
                        : !loading && !failed
                          ? unavailableSummary(data?.consumedRu.reason)
                          : null}
                </dd>
            </dl>
            {failed && (
                <p className={styles.window} role="alert">
                    {l10n.t('Additional throughput analytics could not be loaded. Use Refresh to retry.')}
                </p>
            )}
            {!loading && data && (
                <p className={styles.window}>
                    {l10n.t('Rate and RU/s use complete buckets from {start} to {end}.', {
                        start: new Date(data.windowStart).toLocaleString(),
                        end: new Date(data.windowEnd).toLocaleString(),
                    })}
                </p>
            )}
        </>
    );
}
