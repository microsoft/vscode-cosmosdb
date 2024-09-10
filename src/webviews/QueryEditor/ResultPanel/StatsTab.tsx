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
import { type SerializedQueryResult } from '../../../docdb/types/queryResult';
import { useQueryEditorState } from '../QueryEditorContext';

interface StatsItem {
    metric: string;
    value: string | number;
    tooltip: string;
}

const generateQueryStatsItems = (queryResult: SerializedQueryResult | null) => {
    if (!queryResult) {
        return [];
    }

    const { queryMetrics } = queryResult;
    const stats: StatsItem[] = [
        { metric: 'Request Charge', value: `${queryResult.requestCharge} RUs`, tooltip: 'Request Charge' },
        { metric: 'Showing Results', value: 0, tooltip: 'Showing Results' },
        { metric: 'Retrieved document count', value: 0, tooltip: 'Total number of retrieved documents' },
        {
            metric: 'Retrieved document size',
            value: `${queryMetrics.retrievedDocumentSize ?? 0} bytes`,
            tooltip: 'Total size of retrieved documents in bytes',
        },
        {
            metric: 'Output document count',
            value: queryMetrics.outputDocumentCount ?? '',
            tooltip: 'Number of output documents',
        },
        {
            metric: 'Output document size',
            value: `${queryMetrics.outputDocumentSize ?? 0} bytes`,
            tooltip: 'Total size of output documents in bytes',
        },
        {
            metric: 'Index hit document count',
            value: `${queryMetrics.indexHitDocumentCount ?? ''}`,
            tooltip: 'Total number of documents matched by the filter',
        },
        {
            metric: 'Index lookup time',
            value: `${queryMetrics.indexLookupTime ?? 0} ms`,
            tooltip: 'Time spent in physical index layer',
        },
        {
            metric: 'Document load time',
            value: `${queryMetrics.documentLoadTime ?? 0} ms`,
            tooltip: 'Time spent in loading documents',
        },
        {
            metric: 'Query engine execution time',
            value: `${queryMetrics.runtimeExecutionTimes.queryEngineExecutionTime ?? 0} ms`,
            tooltip:
                'Time spent by the query engine to execute the query expression (excludes other execution times like load documents or write results)',
        },
        {
            metric: 'System function execution time',
            value: `${queryMetrics.runtimeExecutionTimes.systemFunctionExecutionTime ?? 0} ms`,
            tooltip: 'Total time spent executing system (built-in) functions',
        },
        {
            metric: 'User defined function execution time',
            value: `${queryMetrics.runtimeExecutionTimes.userDefinedFunctionExecutionTime ?? 0} ms`,
            tooltip: 'Total time spent executing user-defined functions',
        },
        {
            metric: 'Document write time',
            value: `${queryMetrics.documentWriteTime ?? 0} ms`,
            tooltip: 'Time spent to write query result set to response buffer',
        },
    ];

    if (queryResult.roundTrips) {
        stats.push({
            metric: 'Round Trips',
            value: `${queryResult.roundTrips}`,
            tooltip: 'Number of round trips',
        });
    }
    if (queryResult.activityId) {
        stats.push({
            metric: 'Activity id',
            value: `${queryResult.activityId}`,
            tooltip: '',
        });
    }

    return stats;
};

export const StatsTab = () => {
    const state = useQueryEditorState();
    const items = generateQueryStatsItems(state.currentQueryResult);
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
                                        <Label>{item.value}</Label>
                                    </Tooltip>
                                )}{' '}
                                {!item.tooltip && <Label>{item.value}</Label>}
                            </TableCellLayout>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
};
