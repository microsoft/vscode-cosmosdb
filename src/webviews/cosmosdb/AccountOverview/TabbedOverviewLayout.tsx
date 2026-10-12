/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Tab, TabList, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type ReactNode, useId } from 'react';

export type OverviewTab = 'monitoring' | 'databases' | 'advisories';

const useStyles = makeStyles({
    content: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
        minWidth: 0,
    },
});

/** Keep sections mounted so tab changes preserve filters, chart selection, and inventory state. */
export const TabbedOverviewLayout = ({
    selectedTab,
    onTabSelect,
    header,
    monitoring,
    inventory,
    partitionHealth,
    advisories,
    recommendations,
    alerts,
}: {
    selectedTab: OverviewTab;
    onTabSelect: (tab: OverviewTab) => void;
    header: ReactNode;
    monitoring: ReactNode;
    inventory: ReactNode;
    partitionHealth: ReactNode;
    advisories: ReactNode;
    recommendations: ReactNode;
    alerts: ReactNode;
}) => {
    const styles = useStyles();
    const id = useId();
    const sections = [
        { tab: 'monitoring', label: l10n.t('Monitoring'), content: monitoring },
        {
            tab: 'databases',
            label: l10n.t('Databases and Containers'),
            content: (
                <>
                    {inventory}
                    {partitionHealth}
                </>
            ),
        },
        {
            tab: 'advisories',
            label: l10n.t('Advisories'),
            content: (
                <>
                    {advisories}
                    {recommendations}
                    {alerts}
                </>
            ),
        },
    ] satisfies { tab: OverviewTab; label: string; content: ReactNode }[];

    return (
        <>
            {header}
            <TabList
                aria-label={l10n.t('Account overview sections')}
                selectedValue={selectedTab}
                onTabSelect={(_, data) => {
                    const section = sections.find(({ tab }) => tab === data.value);
                    if (section) {
                        onTabSelect(section.tab);
                    }
                }}
            >
                {sections.map(({ tab, label }) => (
                    <Tab key={tab} id={`${id}-${tab}`} aria-controls={`${id}-${tab}-panel`} value={tab}>
                        {label}
                    </Tab>
                ))}
            </TabList>
            {sections.map(({ tab, content }) => (
                <div
                    key={tab}
                    role="tabpanel"
                    id={`${id}-${tab}-panel`}
                    aria-labelledby={`${id}-${tab}`}
                    hidden={selectedTab !== tab}
                    tabIndex={0}
                >
                    <div className={styles.content}>{content}</div>
                </div>
            ))}
        </>
    );
};
