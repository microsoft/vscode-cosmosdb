/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState, type JSX } from 'react';

import { makeStyles, Tab, TabList, type SelectTabData, type SelectTabEvent } from '@fluentui/react-components';
import { type PropsWithChildren } from 'react';
import { MigrationDashboardTab } from './MigrationDashboardTab';
import { ViewAllAssessmentsTab } from './ViewAllAssessmentsTab';

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
        /**
         * Flex should know basis size to calculate grow and shrink.
         * This value is used to calculate the initial size of the tabs.
         * This is the sum of the width of both tabs: 60px + 60px
         */
        flexBasis: '120px',
        /**
         * To prevent tabs from shrinking, we set flexBasis to 120px.
         * This is the sum of the width of both tabs: 60px + 60px
         */
        minWidth: '120px',
    },
    tabToolbar: {
        /**
         * Flex should know basis size to calculate grow and shrink.
         * This value is used to calculate the initial size of the toolbar.
         * This is the width of the toolbar:
         * 4 buttons * 32px + 36px divider + 100px for the combobox + 8px padding (272px)
         */
        flexBasis: '280px',
        '& [role="toolbar"]': {
            justifyContent: 'flex-end',
        },
    },
    panelToolbar: {
        /**
         * Allow the toolbar to shrink to 0 if there is not enough space.
         */
        minWidth: '0',
        /**
         * Flex should know basis size to calculate grow and shrink.
         * This value is used to calculate the initial size of the toolbar.
         * This is the width of the toolbar:
         * 6 buttons * 32px + 3 dividers * 24px + 100px for the combobox + 100px for status bar + 8px padding (472px)
         */
        flexBasis: '480px',
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

export const MigrationPanel = (): JSX.Element => {
    /**
     * Use the configuration object to access the data passed to the webview at its creation.
     * Feel free to update the content of the object. It won't be synced back to the extension though.
     */
    //  const configuration = useConfiguration<DemoViewWebviewConfigurationType>();

    /**
     * Use the `useTrpcClient` hook to get the tRPC client and an event target
     * for handling notifications from the extension.
     */
    const styles = useStyles();

    const [selectedTab, setSelectedTab] = useState<string>('dashboard__tab');

    const onTabSelect = (_event: SelectTabEvent, data: SelectTabData) => {
        setSelectedTab(data.value as string);
    };

    useEffect(() => {
        const switchTab = (e: Event) => {
            const customEvent = e as CustomEvent<string>;
            if (customEvent.detail === 'assessments__tab') {
                setSelectedTab('assessments__tab');
            }
        };

        window.addEventListener('switch-tab', switchTab);
        return () => window.removeEventListener('switch-tab', switchTab);
    }, []);

    return (
        <div className="documentView">
            <section className={styles.root}>
                <ActionBar>
                    <div className={styles.tabs}>
                        <TabList selectedValue={selectedTab} onTabSelect={onTabSelect}>
                            <Tab id="Dashboard" value="dashboard__tab">
                                Dashboard
                            </Tab>
                            <Tab id="Assessments" value="assessments__tab">
                                Assessments
                            </Tab>
                        </TabList>
                    </div>
                    <div className={styles.tabToolbar}></div>
                    <div className={styles.panelToolbar}></div>
                </ActionBar>
                <div className={styles.tabContainer}>
                    {selectedTab === 'dashboard__tab' && <MigrationDashboardTab />}
                    {selectedTab === 'assessments__tab' && <ViewAllAssessmentsTab />}
                </div>
            </section>
        </div>
    );
};
