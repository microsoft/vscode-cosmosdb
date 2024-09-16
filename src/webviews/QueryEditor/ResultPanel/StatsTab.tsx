import {
    Label,
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
import { useQueryEditorState } from '../QueryEditorContext';

export const StatsTab = () => {
    const state = useQueryEditorState();
    const items = queryMetricsToTable(state.currentQueryResult);
    return (
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
    );
};
