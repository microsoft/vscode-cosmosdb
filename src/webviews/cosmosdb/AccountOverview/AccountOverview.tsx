/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Spinner, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useState } from 'react';
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
    selector: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalS,
        padding: tokens.spacingHorizontalM,
        margin: 0,
        border: 0,
        minWidth: 0,
        borderBottom: '1px solid var(--vscode-panel-border)',
    },
});

export const AccountOverview = () => {
    const styles = useStyles();
    const overview = useAccountOverview();
    const [preview, setPreview] = useState(false);
    const analytics = useOverviewAnalytics(preview, overview);

    return (
        <>
            <fieldset className={styles.selector} aria-label={l10n.t('Overview version')}>
                <Button aria-pressed={!preview} onClick={() => setPreview(false)}>
                    {l10n.t('Original')}
                </Button>
                <Button aria-pressed={preview} onClick={() => setPreview(true)}>
                    {l10n.t('Preview')}
                </Button>
            </fieldset>
            {preview ? (
                <AccountOverviewV2 overview={overview} analytics={analytics} />
            ) : (
                <OriginalAccountOverview overview={overview} />
            )}
        </>
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
