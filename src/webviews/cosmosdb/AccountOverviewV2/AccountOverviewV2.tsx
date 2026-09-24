/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    makeStyles,
    Spinner,
    tokens,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef, useState } from 'react';
import { type MetricKey } from '../../api/types';
import { DashboardActionsProvider } from '../AccountOverview/DashboardChrome';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { OverviewActions } from './OverviewActions';
import { OverviewCapacityDetails } from './OverviewCapacityDetails';
import { detailTitles, OverviewDetails, type OverviewDetailSection } from './OverviewDetails';
import { OverviewFindings, OverviewRecommendations } from './OverviewFindings';
import { type OverviewSummaryProps } from './overviewFindingsModel';
import { OverviewHeader } from './OverviewHeader';
import { OverviewMetrics } from './OverviewMetrics';
import { OverviewRuDetails } from './OverviewRuDetails';
import { OverviewThrottlingDetails } from './OverviewThrottlingDetails';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        padding: '20px',
        color: 'var(--vscode-editor-foreground)',
        backgroundColor: 'var(--vscode-editor-background)',
        minWidth: 0,
        overflowWrap: 'anywhere',
        maxWidth: '1120px',
        width: '100%',
        marginLeft: 'auto',
        marginRight: 'auto',
        boxSizing: 'border-box',
    },
    navigation: {
        display: 'flex',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
        borderTop: '1px solid var(--vscode-panel-border)',
        paddingTop: '12px',
    },
    link: { color: 'var(--vscode-textLink-foreground)' },
    dialog: {
        width: 'min(1120px, calc(100vw - 48px))',
        maxWidth: '1120px',
        color: 'var(--vscode-editor-foreground)',
        backgroundColor: 'var(--vscode-editor-background)',
    },
});

export function AccountOverviewV2({
    overview,
    analytics,
}: {
    overview: AccountOverviewState;
    analytics: OverviewAnalyticsState;
}) {
    const styles = useStyles();
    const [section, setSection] = useState<OverviewDetailSection>();
    const [findingsSection, setFindingsSection] = useState<'findings' | 'recommendations'>();
    const findingsReturnTarget = useRef<HTMLElement | null>(null);
    const findingsReturning = useRef(false);
    const [throughputDetail, setThroughputDetail] = useState<'ru' | 'throttling' | 'capacity'>();
    const throughputReturnTarget = useRef<HTMLElement | null>(null);
    const throughputReturning = useRef(false);
    const [initialMetric, setInitialMetric] = useState<MetricKey>();
    const headingRef = useRef<HTMLHeadingElement>(null);
    const mainRef = useRef<HTMLElement>(null);
    const returnTarget = useRef<HTMLElement | null>(null);
    const returning = useRef(false);

    const inspect: OverviewSummaryProps['onInspect'] = (target, metric) => {
        if ((target === 'metrics' && metric === 'normalizedRu') || target === 'throttling' || target === 'capacity') {
            throughputReturnTarget.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setThroughputDetail(target === 'metrics' ? 'ru' : target);
            return;
        }
        if (target === 'findings' || target === 'recommendations') {
            findingsReturnTarget.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setFindingsSection(target);
            return;
        }
        returnTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setInitialMetric(metric);
        setSection(target);
    };
    useEffect(() => {
        if (section) {
            headingRef.current?.focus();
        } else if (returning.current) {
            const target = returnTarget.current;
            if (target?.isConnected) {
                target.focus();
            } else {
                mainRef.current?.focus();
            }
            returning.current = false;
        }
    }, [section]);
    useEffect(() => {
        if (!findingsSection && findingsReturning.current) {
            const target = findingsReturnTarget.current;
            (target?.isConnected ? target : mainRef.current)?.focus();
            findingsReturning.current = false;
        }
    }, [findingsSection]);
    useEffect(() => {
        if (!throughputDetail && throughputReturning.current) {
            const target = throughputReturnTarget.current;
            (target?.isConnected ? target : mainRef.current)?.focus();
            throughputReturning.current = false;
        }
    }, [throughputDetail]);

    const closeFindings = () => {
        findingsReturning.current = true;
        setFindingsSection(undefined);
    };

    const throughputProps = {
        overview,
        analytics,
        onClose: () => {
            throughputReturning.current = true;
            setThroughputDetail(undefined);
        },
        onReviewPartitions: () => {
            setThroughputDetail(undefined);
            overview.setPartitionMode('ru');
            if (overview.selectedContainer?.containerId) {
                overview.handleSelectPartitionContainer({
                    databaseId: overview.selectedContainer.databaseId,
                    containerId: overview.selectedContainer.containerId,
                });
            } else if (
                overview.selectedContainer?.databaseId &&
                overview.partitionContainer?.databaseId !== overview.selectedContainer.databaseId
            ) {
                const container = overview.containers.find(
                    (item) => item.databaseId === overview.selectedContainer?.databaseId,
                );
                if (container) {
                    overview.handleSelectPartitionContainer(container);
                }
            }
            returnTarget.current = throughputReturnTarget.current;
            setSection('partition');
        },
    };

    if (!overview.summary || !overview.inventory) {
        return <Spinner label={l10n.t('Loading account overview…')} />;
    }

    return (
        <DashboardActionsProvider value={overview.actions}>
            <main ref={mainRef} tabIndex={-1} className={styles.root} aria-label={l10n.t('Account overview')}>
                <OverviewHeader overview={overview} />
                <OverviewActions overview={overview} />
                {section ? (
                    <>
                        <div>
                            <Button
                                appearance="subtle"
                                size="small"
                                className={styles.link}
                                onClick={() => {
                                    returning.current = true;
                                    setSection(undefined);
                                }}
                            >
                                {l10n.t('Back to summary')}
                            </Button>
                        </div>
                        <h2 ref={headingRef} tabIndex={-1}>
                            {detailTitles[section]}
                        </h2>
                        <OverviewDetails section={section} overview={overview} initialMetric={initialMetric} />
                    </>
                ) : (
                    <>
                        <OverviewFindings overview={overview} onInspect={inspect} />
                        <OverviewMetrics overview={overview} onInspect={inspect} analytics={analytics} />
                        <OverviewRecommendations overview={overview} onInspect={inspect} />
                        <nav className={styles.navigation} aria-label={l10n.t('Detailed diagnostics')}>
                            {(['metrics', 'inventory', 'partition', 'findings', 'recommendations'] as const).map(
                                (target) => (
                                    <Button
                                        key={target}
                                        appearance="subtle"
                                        size="small"
                                        className={styles.link}
                                        onClick={() => inspect(target)}
                                    >
                                        {detailTitles[target]}
                                    </Button>
                                ),
                            )}
                        </nav>
                    </>
                )}
            </main>
            <Dialog
                open={findingsSection !== undefined}
                onOpenChange={(_, data) => {
                    if (!data.open) {
                        closeFindings();
                    }
                }}
            >
                <DialogSurface className={styles.dialog}>
                    <DialogBody>
                        <DialogTitle>{findingsSection && detailTitles[findingsSection]}</DialogTitle>
                        <DialogContent>
                            {findingsSection && <OverviewDetails section={findingsSection} overview={overview} />}
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={closeFindings}>
                                {l10n.t('Close')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
            {throughputDetail === 'ru' && <OverviewRuDetails {...throughputProps} />}
            {throughputDetail === 'throttling' && <OverviewThrottlingDetails {...throughputProps} />}
            {throughputDetail === 'capacity' && <OverviewCapacityDetails {...throughputProps} />}
        </DashboardActionsProvider>
    );
}
