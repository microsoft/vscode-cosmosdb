/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Tab, TabList, type SelectTabData, type SelectTabEvent } from '@fluentui/react-components';
import { useState, type PropsWithChildren } from 'react';
import { ResultPanelToolbar } from './ResultPanelToolbar';
import { ResultTab } from './ResultTab';
import { ResultTabToolbar } from './ResultTabToolbar';
import { StatsTab } from './StatsTab';

const useStyles = makeStyles({
    root: {
        alignItems: 'stretch',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'stretch',
        rowGap: '20px',
        width: '100%',
        height: '100%',
    },
    tabs: {
        flexGrow: 1,
    },
    tabContainer: {
        padding: '0 10px',
        height: '100%',
        overflow: 'auto',
    },
    actionBar: {
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '20px',
    },
});

const ActionBar = (props: PropsWithChildren) => {
    const styles = useStyles();

    return <div className={styles.actionBar}>{props.children}</div>;
};

export const ResultPanel = () => {
    const styles = useStyles();

    const [selectedTab, setSelectedTab] = useState<string>('result__tab');

    const onTabSelect = (_event: SelectTabEvent, data: SelectTabData) => {
        setSelectedTab(data.value as string);
    };

    return (
        <section className={styles.root}>
            <ActionBar>
                <div className={styles.tabs}>
                    <TabList selectedValue={selectedTab} onTabSelect={onTabSelect}>
                        <Tab id="Result" value="result__tab">
                            Result
                        </Tab>
                        <Tab id="Stats" value="stats__tab">
                            Stats
                        </Tab>
                    </TabList>
                </div>
                <ResultTabToolbar selectedTab={selectedTab} />
                <ResultPanelToolbar selectedTab={selectedTab} />
            </ActionBar>
            <div className={styles.tabContainer}>
                {selectedTab === 'result__tab' && <ResultTab />}
                {selectedTab === 'stats__tab' && <StatsTab />}
            </div>
        </section>
    );
};
