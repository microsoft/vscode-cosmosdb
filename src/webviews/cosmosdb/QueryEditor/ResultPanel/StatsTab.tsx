/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Label,
    Link,
    makeStyles,
    Table,
    TableBody,
    TableCell,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Tooltip,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect, useState } from 'react';
import { queryMetricsToTable, type StatsItem } from '../../../utils';
import { useQueryEditorState } from '../state/QueryEditorContext';
import { IndexMetricsView } from './IndexMetricsView';

const useStyles = makeStyles({
    topLabel: {
        paddingBottom: '10px',
    },
    bottomLabel: {
        paddingBottom: '10px',
    },
    pre: {
        marginTop: '0',
        fontFamily: 'var(--fontFamilyMonospace)',
    },
    container: {
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: '20px',
    },
    panel1: {
        flexGrow: '1',
        flexShrink: '1',
        flexBasis: '49%',
    },
    panel2: {
        flexGrow: '1',
        flexShrink: '1',
        flexBasis: '49%',
    },
});

export const StatsTab = () => {
    const styles = useStyles();
    const { currentQueryResult } = useQueryEditorState();
    const [items, setItems] = useState<StatsItem[]>([]);
    const indexMetrics = currentQueryResult?.indexMetrics?.trim();
    const QUERY_METRICS_DOC_URL = 'https://learn.microsoft.com/azure/cosmos-db/nosql/query-metrics';

    // Load query metrics asynchronously
    useEffect(() => {
        async function loadQueryMetrics() {
            if (currentQueryResult) {
                const metricsItems = await queryMetricsToTable(currentQueryResult);
                setItems(metricsItems);
            } else {
                setItems([]);
            }
        }

        void loadQueryMetrics();
    }, [currentQueryResult]);

    return (
        <>
            <div className={styles.container}>
                <div className={styles.panel1}>
                    <div className={styles.topLabel}>
                        <Label size={'large'}>{l10n.t('Query metrics')}</Label> (
                        <Link href={QUERY_METRICS_DOC_URL}>{l10n.t('Learn more…')}</Link>)
                    </div>
                    <Table arial-label={l10n.t('Stats table')} style={{ minWidth: '510px' }}>
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell key={'metric'}>{l10n.t('Metric')}</TableHeaderCell>
                                <TableHeaderCell key={'value'}>{l10n.t('Value')}</TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((item) => (
                                <TableRow key={item.metric}>
                                    <TableCell>
                                        <TableCellLayout>{item.metric}</TableCellLayout>
                                    </TableCell>
                                    <TableCell>
                                        <TableCellLayout>
                                            {!!item.tooltip && (
                                                <Tooltip content={item.tooltip} relationship="description" withArrow>
                                                    <Label>{item.formattedValue}</Label>
                                                </Tooltip>
                                            )}{' '}
                                            {!item.tooltip && <Label>{item.formattedValue}</Label>}
                                        </TableCellLayout>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                {indexMetrics && (
                    <div className={styles.panel2}>
                        <IndexMetricsView indexMetricsStr={indexMetrics} topLabelStyle={styles.topLabel} />
                    </div>
                )}
            </div>
        </>
    );
};
