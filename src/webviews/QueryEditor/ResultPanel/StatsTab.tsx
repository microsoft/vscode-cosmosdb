/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Label,
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
import { queryMetricsToTable } from '../../utils';
import { useQueryEditorState } from '../state/QueryEditorContext';

const useStyles = makeStyles({
    topLabel: {
        paddingBottom: '10px',
    },
    bottomLabel: {
        paddingTop: '20px',
        paddingBottom: '10px',
    },
    pre: {
        margin: '0',
        fontFamily: 'var(--fontFamilyMonospace)',
    },
});

export const StatsTab = () => {
    const styles = useStyles();
    const state = useQueryEditorState();
    const items = queryMetricsToTable(state.currentQueryResult);
    const indexMetrics = state.currentQueryResult?.indexMetrics?.trim();

    return (
        <>
            <div className={styles.topLabel}>
                <Label size={'large'}>Query metrics</Label>
            </div>
            <Table arial-label="Stats table" style={{ minWidth: '510px' }}>
                <TableHeader>
                    <TableRow>
                        <TableHeaderCell key={'metric'}>Metric</TableHeaderCell>
                        <TableHeaderCell key={'value'}>Value</TableHeaderCell>
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
            <div className={styles.bottomLabel}>
                <Label size={'large'}>Index metrics</Label>
            </div>
            <div>
                <p className={styles.pre}>{indexMetrics}</p>
            </div>
        </>
    );
};
