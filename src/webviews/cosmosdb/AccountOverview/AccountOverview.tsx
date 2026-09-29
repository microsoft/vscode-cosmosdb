/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Spinner, ToggleButton, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useState } from 'react';
import { CombinedVariant } from '../AccountDashboard/CombinedVariant';
import { MonitorVariant } from '../AccountDashboard/MonitorVariant';
import { TriageVariant } from '../AccountDashboard/TriageVariant';
import { AccountOverviewV2 } from '../AccountOverviewV2/AccountOverviewV2';
import { useOverviewAnalytics } from '../AccountOverviewV2/useOverviewAnalytics';
import { AccountHeader } from './AccountHeader';
import { ActiveAlerts } from './ActiveAlerts';
import { DashboardActionsProvider, DashboardCard, SectionHeader } from './DashboardChrome';
import { DerivedAdvisories } from './DerivedAdvisories';
import { InventoryTable } from './InventoryTable';
import { METRIC_ORDER } from './metrics/descriptors';
import { MetricsSection } from './metrics/MetricsSection';
import { PartitionHealth } from './PartitionHealth';
import { Recommendations } from './Recommendations';
import { type AccountOverviewState, useAccountOverview } from './useAccountOverview';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
        padding: tokens.spacingHorizontalXXL,
        color: 'var(--vscode-editor-foreground)',
        backgroundColor: 'var(--vscode-editor-background)',
        minHeight: '100vh',
        boxSizing: 'border-box',
    },
    layout: {
        display: 'flex',
        // Stretch the two columns to a common height so the rail can match the taller main column (the rail's own
        // content never drives the row height because its growable card can shrink — see `advisoriesCard`).
        alignItems: 'stretch',
        gap: tokens.spacingHorizontalL,
        flexWrap: 'wrap',
    },
    mainColumn: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
        flex: '1 1 640px',
        minWidth: 0,
    },
    rail: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
        flex: '1 1 300px',
        minWidth: 0,
        // Allow the flex children to shrink below their content size so the growable advisories card can bound
        // itself and scroll internally instead of stretching the whole panel taller.
        minHeight: 0,
        maxWidth: '420px',
    },
    // The Derived Advisories card fills whatever vertical space is left in the rail after the fixed cards, matching
    // the main column's height. `flex: 1 1 0` + `minHeight: 0` lets it grow to fill yet shrink to nothing, so its
    // (potentially long) content never drives the row taller; the list scrolls inside it instead.
    advisoriesCard: {
        flex: '1 1 0',
        minHeight: 0,
        overflow: 'hidden',
    },
    loading: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
    },
});

type Variant = '1' | '2' | '3' | 'original' | 'preview';
const VARIANTS: Variant[] = ['1', '2', '3', 'original', 'preview'];

function initialVariant(): Variant {
    const requested = new URLSearchParams(decodeURIComponent(globalThis.location?.search ?? '')).get('variant');
    return VARIANTS.includes(requested as Variant) ? (requested as Variant) : '3';
}

export const AccountOverview = () => {
    const overview = useAccountOverview();
    const [variant, setVariant] = useState<Variant>(initialVariant);
    const analytics = useOverviewAnalytics(variant !== '1' && variant !== 'original', overview);
    const labels: Record<Variant, string> = {
        '1': l10n.t('Option 1 · Monitor'),
        '2': l10n.t('Option 2 · Triage'),
        '3': l10n.t('Option 3 · Combined'),
        original: l10n.t('Before: Original'),
        preview: l10n.t('Before: Preview'),
    };

    return (
        <div className="accountDashboard">
            <div className="prototypeBar" role="toolbar" aria-label={l10n.t('Design option')}>
                <span>{l10n.t('Design prototype:')}</span>
                {VARIANTS.map((key) => (
                    <ToggleButton
                        key={key}
                        size="small"
                        appearance={variant === key ? 'primary' : 'subtle'}
                        checked={variant === key}
                        onClick={() => setVariant(key)}
                    >
                        {labels[key]}
                    </ToggleButton>
                ))}
            </div>
            {variant === '1' && <MonitorVariant overview={overview} />}
            {variant === '2' && <TriageVariant overview={overview} analytics={analytics} />}
            {variant === '3' && <CombinedVariant overview={overview} analytics={analytics} />}
            {variant === 'original' && <OriginalAccountOverview overview={overview} />}
            {variant === 'preview' && <AccountOverviewV2 overview={overview} analytics={analytics} />}
        </div>
    );
};

export const OriginalAccountOverview = ({ overview }: { overview: AccountOverviewState }) => {
    const styles = useStyles();
    const {
        summary,
        inventory,
        inventoryMetrics,
        accountHealth,
        containers,
        trends,
        trendsLoading,
        timeRange,
        setTimeRange,
        selectedContainer,
        setSelectedContainer,
        partitionMode,
        setPartitionMode,
        partitionContainer,
        partitionHealth,
        partitionLoading,
        alerts,
        alertsLoading,
        alertTimeRange,
        setAlertTimeRange,
        recommendations,
        recommendationsLoading,
        derivedAdvisories,
        derivedLoading,
        dismissedAdvisoryIds,
        paused,
        setPaused,
        lastRefreshedAt,
        refresh,
        autoRefreshIntervalsSeconds,
        actions,
        handleOpenUrl,
        handleRevealInTree,
        handleOpenQueryEditor,
        handleSelectPartitionContainer,
        handleDismissAdvisory,
    } = overview;

    if (!summary || !inventory) {
        return (
            <div className={styles.loading}>
                <Spinner label={l10n.t('Loading…')} />
            </div>
        );
    }

    return (
        <DashboardActionsProvider value={actions}>
            <div className={styles.root}>
                <div className={styles.layout}>
                    <div className={styles.mainColumn}>
                        <DashboardCard>
                            <AccountHeader
                                summary={summary}
                                accountHealth={accountHealth}
                                lastRefreshedAt={lastRefreshedAt}
                                paused={paused}
                                onTogglePause={setPaused}
                                onRefresh={refresh}
                                autoRefreshIntervalsSeconds={autoRefreshIntervalsSeconds}
                            />
                        </DashboardCard>

                        <MetricsSection
                            order={METRIC_ORDER}
                            seriesByMetric={trends}
                            loading={trendsLoading}
                            timeRange={timeRange}
                            onTimeRangeChange={setTimeRange}
                            containers={containers}
                            selectedContainer={selectedContainer}
                            onSelectContainer={setSelectedContainer}
                        />

                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Databases and Containers')}
                                description={l10n.t(
                                    'Throughput mode, partition key, and indexing posture per container.',
                                )}
                            />
                            <InventoryTable
                                rows={inventory.rows}
                                supported={inventory.supported}
                                available={inventory.available}
                                reason={inventory.reason}
                                metrics={inventoryMetrics?.available ? inventoryMetrics.metrics : undefined}
                                onRevealInTree={handleRevealInTree}
                                onOpenQueryEditor={handleOpenQueryEditor}
                            />
                        </DashboardCard>

                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Partition Key Distribution Health')}
                                description={l10n.t(
                                    'Physical-partition RU and storage distribution for the selected container, with hot partitions flagged.',
                                )}
                            />
                            <PartitionHealth
                                result={partitionHealth}
                                loading={partitionLoading}
                                mode={partitionMode}
                                onModeChange={setPartitionMode}
                                containers={containers}
                                selected={partitionContainer}
                                onSelectContainer={handleSelectPartitionContainer}
                            />
                        </DashboardCard>
                    </div>

                    <aside className={styles.rail} aria-label={l10n.t('Alerts and recommendations')}>
                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Active Alerts')}
                                description={l10n.t('Fired Azure Monitor alerts targeting this account.')}
                            />
                            <ActiveAlerts
                                result={alerts}
                                loading={alertsLoading}
                                timeRange={alertTimeRange}
                                onTimeRangeChange={setAlertTimeRange}
                                onOpenUrl={handleOpenUrl}
                            />
                        </DashboardCard>

                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Recommendations')}
                                description={l10n.t('Azure Advisor guidance for this account.')}
                            />
                            <Recommendations
                                result={recommendations}
                                loading={recommendationsLoading}
                                onOpenUrl={handleOpenUrl}
                            />
                        </DashboardCard>

                        <DashboardCard className={styles.advisoriesCard}>
                            <SectionHeader
                                title={l10n.t('Derived Advisories')}
                                description={l10n.t(
                                    "Advisories computed from this account's telemetry, not the Azure portal.",
                                )}
                            />
                            <DerivedAdvisories
                                result={derivedAdvisories}
                                loading={derivedLoading}
                                dismissedIds={dismissedAdvisoryIds}
                                onDismiss={handleDismissAdvisory}
                            />
                        </DashboardCard>
                    </aside>
                </div>
            </div>
        </DashboardActionsProvider>
    );
};
