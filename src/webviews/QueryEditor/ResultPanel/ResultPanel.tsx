import {
    makeStyles,
    Tab,
    TabList,
    type SelectTabData,
    type SelectTabEvent,
    type TabValue,
} from '@fluentui/react-components';
import { useState } from 'react';
import { InsightsTab } from './InsightsTab';
import { ResultTab } from './ResultTab';
import { StatsTab } from './StatsTab';

const useStyles = makeStyles({
    root: {
        alignItems: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        rowGap: '20px',
    },
    panels: {
        padding: '0 10px',
    },
});

export const ResultPanel = () => {
    const styles = useStyles();

    const [selectedValue, setSelectedValue] = useState<TabValue>('result__tab');

    const onTabSelect = (_event: SelectTabEvent, data: SelectTabData) => {
        setSelectedValue(data.value);
    };

    return (
        <div className={styles.root}>
            <TabList selectedValue={selectedValue} onTabSelect={onTabSelect}>
                <Tab id="Result" value="result__tab">
                    Result
                </Tab>
                <Tab id="Stats" value="stats__tab">
                    Stats
                </Tab>
                <Tab id="Insights" value="insights__tab">
                    Advisor/Insights
                </Tab>
            </TabList>
            <div className={styles.panels}>
                {selectedValue === 'result__tab' && <ResultTab />}
                {selectedValue === 'stats__tab' && <StatsTab />}
                {selectedValue === 'insights__tab' && <InsightsTab />}
            </div>
        </div>
    );
};
