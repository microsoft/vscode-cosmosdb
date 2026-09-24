/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type MetricKey } from '../../api/types';
import { DashboardCard } from '../AccountOverview/DashboardChrome';
import { InventoryTable } from '../AccountOverview/InventoryTable';
import { METRIC_ORDER } from '../AccountOverview/metrics/descriptors';
import { MetricsSection } from '../AccountOverview/metrics/MetricsSection';
import { PartitionHealth } from '../AccountOverview/PartitionHealth';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { OverviewFindingDetails } from './OverviewFindings';

export type OverviewDetailSection = 'metrics' | 'inventory' | 'partition' | 'findings' | 'recommendations';

export const detailTitles: Record<OverviewDetailSection, string> = {
    metrics: l10n.t('Metric details'),
    inventory: l10n.t('Databases and Containers'),
    partition: l10n.t('Partition Key Distribution Health'),
    findings: l10n.t('Account health'),
    recommendations: l10n.t('Recommendations'),
};

const useStyles = makeStyles({
    alertWindow: { border: 0, padding: 0, margin: '0 0 12px', minWidth: 0 },
});

export function OverviewDetails({
    section,
    overview: o,
    initialMetric,
}: {
    section: OverviewDetailSection;
    overview: AccountOverviewState;
    initialMetric?: MetricKey;
}) {
    const styles = useStyles();
    switch (section) {
        case 'metrics':
            return (
                <MetricsSection
                    initialMetric={initialMetric}
                    order={METRIC_ORDER}
                    seriesByMetric={o.trends}
                    loading={o.trendsLoading}
                    timeRange={o.timeRange}
                    onTimeRangeChange={o.setTimeRange}
                    containers={o.containers}
                    selectedContainer={o.selectedContainer}
                    onSelectContainer={o.setSelectedContainer}
                />
            );
        case 'inventory':
            return o.inventory ? (
                <DashboardCard>
                    <InventoryTable
                        rows={o.inventory.rows}
                        supported={o.inventory.supported}
                        available={o.inventory.available}
                        reason={o.inventory.reason}
                        metrics={o.inventoryMetrics?.available ? o.inventoryMetrics.metrics : undefined}
                        onRevealInTree={o.handleRevealInTree}
                        onOpenQueryEditor={o.handleOpenQueryEditor}
                    />
                </DashboardCard>
            ) : null;
        case 'partition':
            return (
                <DashboardCard>
                    <PartitionHealth
                        result={o.partitionHealth}
                        loading={o.partitionLoading}
                        mode={o.partitionMode}
                        onModeChange={o.setPartitionMode}
                        containers={o.containers}
                        selected={o.partitionContainer}
                        onSelectContainer={o.handleSelectPartitionContainer}
                    />
                </DashboardCard>
            );
        case 'findings':
            return (
                <>
                    <fieldset className={styles.alertWindow}>
                        <legend>{l10n.t('Azure alert window')}</legend>
                        {(
                            [
                                ['1h', l10n.t('1h')],
                                ['1d', l10n.t('1d')],
                                ['7d', l10n.t('7d')],
                                ['30d', l10n.t('30d')],
                            ] as const
                        ).map(([range, label]) => (
                            <Button
                                key={range}
                                appearance="subtle"
                                size="small"
                                aria-pressed={o.alertTimeRange === range}
                                onClick={() => o.setAlertTimeRange(range)}
                            >
                                {label}
                            </Button>
                        ))}
                    </fieldset>
                    <OverviewFindingDetails section={section} overview={o} />
                </>
            );
        case 'recommendations':
            return <OverviewFindingDetails section={section} overview={o} />;
    }
}
