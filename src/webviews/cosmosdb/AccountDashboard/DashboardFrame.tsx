/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageBar, MessageBarActions, MessageBarBody, Button, ProgressBar } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type ReactNode } from 'react';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import './accountDashboard.scss';
import { DashboardHeader } from './DashboardHeader';
import { DashboardToolbar } from './DashboardToolbar';

/** The database the inventory has stepped into doubles as the metric scope, so the whole page reads one scope. */
export function useDashboardScope(overview: AccountOverviewState) {
    const currentDatabase = overview.selectedContainer?.databaseId;
    const setCurrentDatabase = (databaseId: string | undefined) =>
        overview.setSelectedContainer(databaseId ? { databaseId } : undefined);
    return { currentDatabase, setCurrentDatabase };
}

/**
 * Everything the three design options share: the top-edge progress bar, the shaded identity band, the action bar,
 * the content column and the source footer. Each option supplies only what sits in the content column.
 */
export function DashboardFrame({ overview, children }: { overview: AccountOverviewState; children: ReactNode }) {
    const { currentDatabase } = useDashboardScope(overview);
    const busy =
        !overview.summary ||
        !overview.inventory ||
        overview.trendsLoading ||
        overview.accountActionBusy ||
        (overview.alertsLoading && !overview.alerts);

    return (
        <>
            {busy && <ProgressBar thickness="large" shape="square" className="progressBar" aria-hidden={true} />}
            <div className="dashboardHeaderBand">
                <DashboardHeader overview={overview} />
            </div>
            <DashboardToolbar overview={overview} currentDatabase={currentDatabase} />
            <main className="dashboardContent" aria-label={l10n.t('Account overview')}>
                {overview.accountActionFailed && (
                    <MessageBar intent="error" layout="multiline">
                        <MessageBarBody>
                            {l10n.t(
                                'The account action could not be completed. Retry or use the Azure Resources view.',
                            )}
                        </MessageBarBody>
                        <MessageBarActions>
                            <Button appearance="secondary" onClick={overview.refresh}>
                                {l10n.t('Refresh')}
                            </Button>
                        </MessageBarActions>
                    </MessageBar>
                )}
                {children}
            </main>
            <footer className="dashboardFooter">
                {l10n.t(
                    'Metrics and alerts: Azure Monitor · Recommendations: Azure Advisor and derived checks · Inventory: Azure Resource Manager',
                )}
            </footer>
        </>
    );
}
