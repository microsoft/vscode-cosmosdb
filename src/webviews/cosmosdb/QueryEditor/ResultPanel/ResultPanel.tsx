/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Tab, TabList, type SelectTabData, type SelectTabEvent } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback, useState, type PropsWithChildren } from 'react';
import { useCommandHotkey, useHotkeyScope } from '../../../common/hotkeys';
import { ResultPanelHotkeys, type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { ResultPanelToolbarOverflow } from './ResultPanelToolbarOverflow';
import { ResultTab } from './ResultTab';
import { ResultTabToolbar } from './ResultTabToolbar';
import { StatsTab } from './StatsTab';

const useStyles = makeStyles({
    root: {
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        gap: '20px',
        width: '100%',
        height: '100%',
    },
    actionBar: {
        display: 'grid',
        /**
         * Flex should know basis size to calculate grow and shrink.
         *
         * First value is used to calculate the initial size of the tabs.
         * This is the sum of the width of both tabs: 60px + 60px
         *
         * Second value is used to calculate the initial size of the toolbar.
         * This is the width of the toolbar:
         * 4 buttons * 32px + 36px divider + 100px for the combobox + 8px padding (272px)
         *
         * Third value is used to calculate the initial size of the toolbar.
         * This is the width of the toolbar:
         * 6 buttons * 32px + 3 dividers * 24px + 100px for the combobox + 100px for status bar + 8px padding (472px)
         */
        gridTemplateColumns: 'minmax(120px, 1fr) minmax(280px, auto) minmax(0, 480px)',
        alignItems: 'center',
        gap: '20px',

        // Ensure the toolbar is aligned to the right
        '& [role="toolbar"]': {
            justifyContent: 'flex-end',
        },
    },
    tabContainer: {
        gridRow: '2',
        width: '100%',
        height: '100%',
        display: 'grid', // Create a nested grid
        gridTemplateRows: '1fr', // Single row that takes full height
        overflow: 'hidden', // Move overflow to the content
    },
    tabContent: {
        padding: '0 10px',
        overflow: 'auto',
        height: '100%',
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

    // Set up the scope for this component
    const panelRef = useHotkeyScope<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>(
        'resultPanel',
        ResultPanelHotkeys,
    );

    const switchToResultTab = useCallback(() => {
        setSelectedTab('result__tab');
    }, []);

    const switchToStatsTab = useCallback(() => {
        setSelectedTab('stats__tab');
    }, []);

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>(
        'global',
        'SwitchToResultTab',
        switchToResultTab,
    );

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('global', 'SwitchToStatsTab', switchToStatsTab);

    return (
        <section className={styles.root} ref={panelRef} tabIndex={-1} aria-label="Result Panel">
            <ActionBar>
                <TabList selectedValue={selectedTab} onTabSelect={onTabSelect}>
                    <Tab id="Result" value="result__tab">
                        {l10n.t('Result')}
                    </Tab>
                    <Tab id="Stats" value="stats__tab">
                        {l10n.t('Stats')}
                    </Tab>
                </TabList>
                <ResultTabToolbar />
                <ResultPanelToolbarOverflow selectedTab={selectedTab} />
            </ActionBar>
            <div className={styles.tabContainer}>
                <div className={styles.tabContent}>
                    {selectedTab === 'result__tab' && <ResultTab />}
                    {selectedTab === 'stats__tab' && <StatsTab />}
                </div>
            </div>
        </section>
    );
};
