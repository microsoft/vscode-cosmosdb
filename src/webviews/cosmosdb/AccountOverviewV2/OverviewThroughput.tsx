/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Popover, PopoverSurface, PopoverTrigger, useAnnounce } from '@fluentui/react-components';
import { Info16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useId, useRef } from 'react';
import { type OverviewSummaryProps } from './overviewFindingsModel';
import { formatSummaryValue, type MetricSummary } from './overviewMetricsModel';
import {
    formatRateDelta,
    hasMeasurement,
    NORMALIZED_ATTENTION_PERCENT,
    summarizeThroughput,
    THROTTLING_GUIDE_PERCENT,
} from './overviewThroughputModel';
import { OverviewTrend } from './OverviewTrend';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

const useStyles = makeStyles({
    heading: { display: 'flex', alignItems: 'center', gap: '4px' },
    title: { fontSize: '14px', fontWeight: 600, margin: 0 },
    info: { minWidth: 0, color: 'var(--vscode-descriptionForeground)' },
    notes: { maxWidth: '440px', fontSize: '12px', lineHeight: '1.5', '& > p': { margin: '8px 0' } },
    subtitle: { color: 'var(--vscode-descriptionForeground)', margin: '4px 0 14px', fontSize: '12px' },
    cards: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: '12px',
        '@media (max-width: 760px)': { gridTemplateColumns: '1fr' },
    },
    card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        minHeight: '308px',
        boxSizing: 'border-box',
        padding: '20px',
        minWidth: 0,
        overflowWrap: 'anywhere',
        backgroundColor: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: '4px',
    },
    statistic: { margin: 0 },
    cardTitle: { margin: 0, color: 'var(--vscode-descriptionForeground)', fontSize: '13px', fontWeight: 600 },
    valueRow: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', margin: '8px 0 0' },
    value: { fontSize: '30px', lineHeight: '1.2', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
    accent: { color: 'var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))', fontSize: '12px' },
    pill: {
        marginLeft: 'auto',
        alignSelf: 'center',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '10px',
        fontWeight: 600,
        color: 'var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))',
        backgroundColor: 'color-mix(in srgb, var(--vscode-charts-yellow) 12%, transparent)',
        border: '1px solid var(--vscode-contrastBorder, transparent)',
    },
    detail: { color: 'var(--vscode-descriptionForeground)', fontSize: '12px', lineHeight: '1.6', margin: 0 },
    status: { color: 'var(--vscode-descriptionForeground)', fontSize: '11px', lineHeight: '1.5', margin: 0 },
    gauge: { marginTop: '10px' },
    track: {
        height: '6px',
        backgroundColor: 'var(--vscode-panel-border)',
        border: '1px solid var(--vscode-contrastBorder, transparent)',
    },
    fill: { height: '100%', backgroundColor: 'var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))' },
    endpoints: {
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: '6px',
        fontSize: '10px',
        color: 'var(--vscode-descriptionForeground)',
    },
    pairs: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: '12px',
        margin: '12px 0 0',
        fontSize: '12px',
        '& dt': { color: 'var(--vscode-descriptionForeground)' },
        '& dd': { margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
    },
    action: {
        marginTop: 'auto',
        alignSelf: 'flex-start',
        minWidth: 0,
        padding: '2px 0',
        color: 'var(--vscode-textLink-foreground)',
        fontSize: '12px',
        textAlign: 'left',
    },
});

export function OverviewThroughput({
    overview,
    onInspect,
    analytics,
}: OverviewSummaryProps & { analytics?: OverviewAnalyticsState }) {
    const styles = useStyles();
    const id = useId();
    const serverless = overview.summary?.isServerless;
    const result = summarizeThroughput(overview.trends.normalizedRu, overview.trends.provisionedThroughput, analytics, {
        timeRange: overview.timeRange,
        scope: overview.selectedContainer,
        loading: overview.trendsLoading,
        serverless,
    });
    const { normalized, peak, throttling, consumed, provisioned, autoscale, delta } = result;
    const scope = overview.selectedContainer
        ? overview.selectedContainer.containerId
            ? `${overview.selectedContainer.databaseId} / ${overview.selectedContainer.containerId}`
            : l10n.t('Database {name}', { name: overview.selectedContainer.databaseId })
        : l10n.t('Account-wide');
    const timestampNote = (timestamp: number | undefined) =>
        timestamp === undefined
            ? ''
            : l10n.t('Latest usable sample: {time}. Reported measurements are not instantaneous current values.', {
                  time: new Date(timestamp).toLocaleString(),
              });
    const normalizedNote = `${normalized.label}. ${timestampNote(result.normalizedTimestamp)} ${normalized.detail}`;
    const provisionedNote = l10n.t(
        'Provisioned now means the latest reported maximum for the selected scope, not a sum of allocations or an instantaneous current value.',
    );
    const autoscaleNote = l10n.t(
        'Autoscale max is the latest reported AutoscaleMaxThroughput maximum for the selected scope, not a sum or a configured account limit.',
    );
    const deltaNote = l10n.t(
        'Change in percentage points from the immediately preceding equal-duration window for the same scope.',
    );
    const capacityValue = (summary: MetricSummary) =>
        serverless
            ? l10n.t('Not applicable')
            : hasMeasurement(summary)
              ? formatSummaryValue(summary)
              : summary.state === 'loading'
                ? l10n.t('Loading…')
                : l10n.t('Unavailable');
    const status = (summary: MetricSummary) =>
        summary.state !== 'ready' ? <p className={styles.status}>{summary.detail}</p> : null;
    const busy = overview.trendsLoading || !!analytics?.loading;
    const { announce } = useAnnounce();
    const wasBusy = useRef(false);
    useEffect(() => {
        if (busy) {
            announce(l10n.t('Updating throughput health…'), { polite: true });
        } else if (wasBusy.current) {
            announce(l10n.t('Throughput health updated.'), { polite: true });
        }
        wasBusy.current = busy;
    }, [announce, busy]);

    return (
        <section aria-labelledby={`${id}-title`} aria-busy={busy}>
            <div className={styles.heading}>
                <h2 id={`${id}-title`} className={styles.title}>
                    {l10n.t('Throughput health')}
                </h2>
                <Popover withArrow>
                    <PopoverTrigger disableButtonEnhancement>
                        <Button
                            appearance="subtle"
                            size="small"
                            className={styles.info}
                            icon={<Info16Regular aria-hidden />}
                            aria-label={l10n.t('Throughput measurement information')}
                        />
                    </PopoverTrigger>
                    <PopoverSurface
                        className={styles.notes}
                        tabIndex={-1}
                        aria-label={l10n.t('Throughput measurement information')}
                    >
                        <p>{l10n.t('Metric scope: {scope} · {window}', { scope, window: overview.timeRange })}</p>
                        <p>{normalizedNote}</p>
                        <p>
                            {l10n.t(
                                'Peak is the maximum usable normalized RU sample in the selected window, not the latest value. Elevated uses an 80% visual attention guide, not a detector or alert threshold.',
                            )}
                        </p>
                        <p>
                            {throttling.detail}{' '}
                            {l10n.t(
                                'Window total of 429 requests divided by total requests; no requests means no measured rate.',
                            )}
                        </p>
                        <p>{deltaNote}</p>
                        <p>
                            {l10n.t(
                                'The 5% gauge endpoint is an investigation guide, not an SLA or an automatic health failure. The fill stops at 5%; the number retains the measured rate. Aggregate requests do not establish partition concentration or successful retries.',
                            )}
                        </p>
                        <p>
                            {consumed.label}. {consumed.detail}
                        </p>
                        <p>
                            {provisionedNote} {timestampNote(result.provisionedTimestamp)} {provisioned.detail}
                        </p>
                        <p>
                            {autoscaleNote} {timestampNote(result.autoscaleTimestamp)} {autoscale.detail}
                        </p>
                        {result.window && <p>{result.window}</p>}
                    </PopoverSurface>
                </Popover>
            </div>
            <p className={styles.subtitle}>{l10n.t('Saturation and rate limiting must be interpreted together')}</p>
            <div className={styles.cards}>
                <article className={styles.card} aria-label={l10n.t('Normalized RU Consumption')}>
                    <dl className={styles.statistic}>
                        <dt className={styles.cardTitle}>{l10n.t('Normalized RU Consumption')}</dt>
                        <dd className={styles.valueRow} aria-description={normalizedNote}>
                            <span className={styles.value}>{formatSummaryValue(normalized)}</span>
                            {hasMeasurement(peak) && (
                                <span className={styles.accent}>
                                    {l10n.t('Peak {value}', { value: formatSummaryValue(peak) })}
                                </span>
                            )}
                            {normalized.value !== undefined && normalized.value >= NORMALIZED_ATTENTION_PERCENT && (
                                <span className={styles.pill}>{l10n.t('Elevated')}</span>
                            )}
                        </dd>
                    </dl>
                    <OverviewTrend
                        metric="normalizedRu"
                        series={overview.trends.normalizedRu}
                        summary={normalized}
                        timeRange={overview.timeRange}
                    />
                    <p className={styles.detail}>
                        {l10n.t(
                            'Maximum utilization across partition key ranges. Brief 100% spikes are acceptable when 429 rate and latency remain low.',
                        )}
                    </p>
                    {normalized.state === 'partial' && status(normalized)}
                    <Button
                        appearance="subtle"
                        size="small"
                        className={styles.action}
                        onClick={() => onInspect('metrics', 'normalizedRu')}
                    >
                        {l10n.t('View RU consumption details')}
                    </Button>
                </article>
                <article className={styles.card} aria-label={l10n.t('429 throttling rate')}>
                    <dl className={styles.statistic}>
                        <dt className={styles.cardTitle}>{l10n.t('429 throttling rate')}</dt>
                        <dd className={styles.valueRow} aria-description={throttling.detail}>
                            <span className={styles.value}>{formatSummaryValue(throttling)}</span>
                            {delta !== undefined && (
                                <span className={styles.accent} aria-description={deltaNote}>
                                    {formatRateDelta(delta)}
                                </span>
                            )}
                        </dd>
                    </dl>
                    {throttling.value !== undefined && (
                        <div className={styles.gauge}>
                            <div className={styles.track} aria-hidden="true">
                                <div
                                    className={styles.fill}
                                    style={{
                                        width: `${Math.min(100, (throttling.value / THROTTLING_GUIDE_PERCENT) * 100)}%`,
                                    }}
                                />
                            </div>
                            <div className={styles.endpoints}>
                                <span>0%</span>
                                <span>{l10n.t('5% investigate')}</span>
                            </div>
                        </div>
                    )}
                    <p className={styles.detail}>
                        {l10n.t(
                            'A 1–5% rate can be typical when end-to-end latency is acceptable and requests are evenly distributed across partitions. Verify distribution and retry outcomes separately.',
                        )}
                    </p>
                    {status(throttling)}
                    <Button
                        appearance="subtle"
                        size="small"
                        className={styles.action}
                        onClick={() => onInspect('throttling')}
                    >
                        {l10n.t('View 429 throttling details')}
                    </Button>
                </article>
                <article className={styles.card} aria-label={l10n.t('Provisioned vs consumed')}>
                    <dl className={styles.statistic}>
                        <dt className={styles.cardTitle}>{l10n.t('Provisioned vs consumed')}</dt>
                        <dd className={styles.valueRow} aria-description={`${consumed.label}. ${consumed.detail}`}>
                            <span className={styles.value}>
                                {consumed.value?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}
                            </span>
                            <span className={styles.detail}>{l10n.t('RU/s peak')}</span>
                        </dd>
                    </dl>
                    <dl className={styles.pairs}>
                        <dt>{l10n.t('Consumed peak')}</dt>
                        <dd aria-description={consumed.detail}>{formatSummaryValue(consumed)}</dd>
                        <dt>{l10n.t('Provisioned now')}</dt>
                        <dd aria-description={`${provisionedNote} ${provisioned.detail}`}>
                            {capacityValue(provisioned)}
                        </dd>
                        <dt>{l10n.t('Autoscale max')}</dt>
                        <dd aria-description={`${autoscaleNote} ${autoscale.detail}`}>{capacityValue(autoscale)}</dd>
                    </dl>
                    {status(consumed)}
                    {!serverless && status(provisioned)}
                    {!serverless && status(autoscale)}
                    <Button
                        appearance="subtle"
                        size="small"
                        className={styles.action}
                        onClick={() => onInspect('capacity')}
                    >
                        {l10n.t('Review capacity details')}
                    </Button>
                </article>
            </div>
        </section>
    );
}
