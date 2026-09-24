/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type MetricKey } from '../../api/types';
import { ActiveAlerts } from '../AccountOverview/ActiveAlerts';
import { DashboardCard, SectionHeader } from '../AccountOverview/DashboardChrome';
import { DerivedAdvisories } from '../AccountOverview/DerivedAdvisories';
import { InventoryTable } from '../AccountOverview/InventoryTable';
import { METRIC_ORDER } from '../AccountOverview/metrics/descriptors';
import { MetricsSection } from '../AccountOverview/metrics/MetricsSection';
import { PartitionHealth } from '../AccountOverview/PartitionHealth';
import { Recommendations } from '../AccountOverview/Recommendations';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';

export type OverviewDetailSection = 'metrics' | 'inventory' | 'partition' | 'findings';

export const detailTitles: Record<OverviewDetailSection, string> = {
    metrics: l10n.t('Metric details'),
    inventory: l10n.t('Databases and Containers'),
    partition: l10n.t('Partition Key Distribution Health'),
    findings: l10n.t('All findings'),
};

export function OverviewDetails({
    section,
    overview: o,
    initialMetric,
}: {
    section: OverviewDetailSection;
    overview: AccountOverviewState;
    initialMetric?: MetricKey;
}) {
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
                    <DashboardCard>
                        <SectionHeader title={l10n.t('Active Alerts')} />
                        <ActiveAlerts
                            result={o.alerts}
                            loading={o.alertsLoading}
                            timeRange={o.alertTimeRange}
                            onTimeRangeChange={o.setAlertTimeRange}
                            onOpenUrl={o.handleOpenUrl}
                        />
                    </DashboardCard>
                    <DashboardCard>
                        <SectionHeader title={l10n.t('Recommendations')} />
                        <Recommendations
                            result={o.recommendations}
                            loading={o.recommendationsLoading}
                            onOpenUrl={o.handleOpenUrl}
                        />
                    </DashboardCard>
                    <DashboardCard>
                        <SectionHeader title={l10n.t('Derived Advisories')} />
                        <DerivedAdvisories
                            result={o.derivedAdvisories}
                            loading={o.derivedLoading}
                            dismissedIds={o.dismissedAdvisoryIds}
                            onDismiss={o.handleDismissAdvisory}
                        />
                    </DashboardCard>
                </>
            );
    }
}
