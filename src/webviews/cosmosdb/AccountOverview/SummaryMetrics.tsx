/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useMemo } from 'react';
import { type InventoryContainerRow, type RuTrendsResult } from '../../api/types';
import { MetricTile } from './DashboardChrome';

const useStyles = makeStyles({
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: tokens.spacingHorizontalM,
    },
});

/** Formats a RU/s value compactly, e.g. 146000 → "146k RU/s". */
function formatThroughput(ru: number): string {
    if (ru >= 1000) {
        const k = Math.round(ru / 100) / 10;
        return l10n.t('{value}k RU/s', { value: k });
    }
    return l10n.t('{value} RU/s', { value: ru });
}

/**
 * Sums provisioned RU/s across the account without double-counting shared
 * database throughput (every container under a shared database reports the same
 * database-level RU, so those are deduped by database id).
 */
function computeProvisionedRU(rows: InventoryContainerRow[]): { total: number; hasProvisioned: boolean } {
    const perDatabaseShared = new Map<string, number>();
    let dedicated = 0;
    let hasProvisioned = false;

    for (const row of rows) {
        if (row.throughputRU === undefined) {
            continue;
        }
        if (row.throughputMode === 'dedicated' || row.throughputMode === 'autoscale') {
            dedicated += row.throughputRU;
            hasProvisioned = true;
        } else if (row.throughputMode === 'shared') {
            perDatabaseShared.set(row.databaseId, row.throughputRU);
            hasProvisioned = true;
        }
    }

    const shared = [...perDatabaseShared.values()].reduce((sum, ru) => sum + ru, 0);
    return { total: dedicated + shared, hasProvisioned };
}

const TIME_RANGE_LABEL: Record<RuTrendsResult['timeRange'], string> = {
    '1H': l10n.t('last hour'),
    '24H': l10n.t('last 24 hours'),
    '7D': l10n.t('last 7 days'),
};

export const SummaryMetrics = ({
    rows,
    supported,
    trends,
}: {
    rows: InventoryContainerRow[];
    supported: boolean;
    trends?: RuTrendsResult;
}) => {
    const styles = useStyles();

    const provisioned = useMemo(() => computeProvisionedRU(rows), [rows]);
    const databaseCount = useMemo(() => new Set(rows.map((r) => r.databaseId)).size, [rows]);

    const provisionedValue = supported && provisioned.hasProvisioned ? formatThroughput(provisioned.total) : '—';
    const provisionedCaption =
        supported && provisioned.hasProvisioned
            ? l10n.t('Sum of provisioned throughput across containers')
            : l10n.t('Serverless or unavailable');

    const utilizationValue =
        trends?.available && trends.peakPercent !== undefined ? `${Math.round(trends.peakPercent)}%` : '—';
    const utilizationCaption = trends
        ? l10n.t('Peak normalized RU over {range}', { range: TIME_RANGE_LABEL[trends.timeRange] })
        : l10n.t('Loading…');

    return (
        <div className={styles.grid}>
            <MetricTile
                label={l10n.t('Provisioned throughput')}
                value={provisionedValue}
                caption={provisionedCaption}
            />
            <MetricTile
                label={l10n.t('Account RU utilization')}
                value={utilizationValue}
                caption={utilizationCaption}
            />
            <MetricTile
                label={l10n.t('Databases')}
                value={supported ? String(databaseCount) : '—'}
                caption={
                    supported ? l10n.t('{count} containers total', { count: rows.length }) : l10n.t('Not available')
                }
            />
        </div>
    );
};
