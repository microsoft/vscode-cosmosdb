/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Spinner, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef, useState } from 'react';
import { type MetricKey } from '../../api/types';
import { DashboardActionsProvider } from '../AccountOverview/DashboardChrome';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { OverviewActions } from './OverviewActions';
import { detailTitles, OverviewDetails, type OverviewDetailSection } from './OverviewDetails';
import { OverviewFindings, OverviewRecommendations } from './OverviewFindings';
import { OverviewHeader } from './OverviewHeader';
import { OverviewMetrics } from './OverviewMetrics';
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
    const [initialMetric, setInitialMetric] = useState<MetricKey>();
    const headingRef = useRef<HTMLHeadingElement>(null);
    const mainRef = useRef<HTMLElement>(null);
    const returnTarget = useRef<HTMLElement | null>(null);
    const returning = useRef(false);

    const inspect = (target: OverviewDetailSection, metric?: MetricKey) => {
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
                            {(['metrics', 'inventory', 'partition', 'findings'] as const).map((target) => (
                                <Button
                                    key={target}
                                    appearance="subtle"
                                    size="small"
                                    className={styles.link}
                                    onClick={() => inspect(target)}
                                >
                                    {detailTitles[target]}
                                </Button>
                            ))}
                        </nav>
                    </>
                )}
            </main>
        </DashboardActionsProvider>
    );
}
