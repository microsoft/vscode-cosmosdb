/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Tab, TabList, tokens, Tooltip } from '@fluentui/react-components';
import { Warning16Filled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode, useEffect, useId, useRef } from 'react';

export type OverviewTab = 'monitoring' | 'databases' | 'advisories';

export type TabHealthIndicators = Partial<
    Record<OverviewTab, { severity: 'Critical' | 'Needs Attention'; description: string }>
>;

const useStyles = makeStyles({
    tabs: {
        flexWrap: 'wrap',
        minWidth: 0,
    },
    tab: {
        maxWidth: '100%',
    },
    tabContent: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        minWidth: 0,
    },
    critical: {
        color: tokens.colorPaletteRedForeground1,
        flexShrink: 0,
    },
    warning: {
        color: tokens.colorPaletteYellowForeground2,
        flexShrink: 0,
    },
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
    requestedTab,
    navigationRevision = 0,
    healthIndicators = {},
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
    requestedTab?: OverviewTab;
    navigationRevision?: number;
    healthIndicators?: TabHealthIndicators;
}) => {
    const styles = useStyles();
    const id = useId();
    const tabRefs = useRef(new Map<OverviewTab, HTMLButtonElement>());
    const handledNavigation = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (requestedTab === selectedTab && handledNavigation.current !== navigationRevision) {
            handledNavigation.current = navigationRevision;
            tabRefs.current.get(selectedTab)?.focus();
        }
    }, [requestedTab, selectedTab, navigationRevision]);
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
                className={styles.tabs}
                aria-label={l10n.t('Account overview sections')}
                selectedValue={selectedTab}
                onTabSelect={(_, data) => {
                    const section = sections.find(({ tab }) => tab === data.value);
                    if (section) {
                        onTabSelect(section.tab);
                    }
                }}
            >
                {sections.map(({ tab, label }) => {
                    const indicator = healthIndicators[tab];
                    const element = (
                        <Tab
                            ref={(element) => {
                                if (element) {
                                    tabRefs.current.set(tab, element);
                                } else {
                                    tabRefs.current.delete(tab);
                                }
                            }}
                            key={tab}
                            id={`${id}-${tab}`}
                            aria-controls={`${id}-${tab}-panel`}
                            value={tab}
                            className={styles.tab}
                            content={{ className: styles.tabContent }}
                            aria-description={indicator?.description}
                        >
                            <span>{label}</span>
                            {indicator && (
                                <Warning16Filled
                                    aria-hidden
                                    className={indicator.severity === 'Critical' ? styles.critical : styles.warning}
                                />
                            )}
                        </Tab>
                    );
                    return (
                        <Tooltip
                            key={tab}
                            content={indicator?.description ?? ''}
                            relationship="description"
                            visible={indicator ? undefined : false}
                        >
                            {element}
                        </Tooltip>
                    );
                })}
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
