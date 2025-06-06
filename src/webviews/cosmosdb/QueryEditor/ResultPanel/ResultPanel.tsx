/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Tab, TabList, type SelectTabData, type SelectTabEvent } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useState, type PropsWithChildren } from 'react';
import { CommandType, HotkeyScope, useCommandHotkey, useHotkeyScope } from '../../../common/hotkeys';
import { ResultPanelToolbarOverflow } from './ResultPanelToolbarOverflow';
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

export const ResultPanel = () => {
    const styles = useStyles();

    const [selectedTab, setSelectedTab] = useState<string>('result__tab');

    const onTabSelect = (_event: SelectTabEvent, data: SelectTabData) => {
        setSelectedTab(data.value as string);
    };

    const panelRef = useHotkeyScope(HotkeyScope.ResultPanel); // Set up the scope for this component

    useCommandHotkey(HotkeyScope.Global, CommandType.SwitchToResultTab, () => setSelectedTab('result__tab'), []);

    useCommandHotkey(HotkeyScope.Global, CommandType.SwitchToStatsTab, () => setSelectedTab('stats__tab'), []);

    return (
        <section className={styles.root} ref={panelRef} tabIndex={-1}>
            <ActionBar>
                <div className={styles.tabs}>
                    <TabList selectedValue={selectedTab} onTabSelect={onTabSelect}>
                        <Tab id="Result" value="result__tab">
                            {l10n.t('Result')}
                        </Tab>
                        <Tab id="Stats" value="stats__tab">
                            {l10n.t('Stats')}
                        </Tab>
                    </TabList>
                </div>
                <div className={styles.tabToolbar}>
                    <ResultTabToolbar selectedTab={selectedTab} />
                </div>
                <div className={styles.panelToolbar}>
                    <ResultPanelToolbarOverflow selectedTab={selectedTab} />
                </div>
            </ActionBar>
            <div className={styles.tabContainer}>
                {selectedTab === 'result__tab' && <ResultTab />}
                {selectedTab === 'stats__tab' && <StatsTab />}
            </div>
        </section>
    );
};
