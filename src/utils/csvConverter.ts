/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { SettingsService } from '../services/SettingsService';
import { indexMetricsToTableItem, queryMetricsToTable, queryResultToTable } from './convertors';

function getCsvSeparator(): string {
    return SettingsService.getSetting<string>('cosmosDB.csvSeparator') ?? ';';
}

export const escapeCsvValue = (value: string): string => {
    return `"${value.replace(/"/g, '""')}"`;
};

export const queryMetricsToCsv = async (queryResult: SerializedQueryResult | null): Promise<string> => {
    if (!queryResult) {
        return '';
    }

    const stats = await queryMetricsToTable(queryResult);

    stats.push(indexMetricsToTableItem(queryResult));

    const titles = stats.map((item) => escapeCsvValue(item.metric)).join(',');
    const values = stats.map((item) => escapeCsvValue(item.value.toString())).join(',');
    return `sep=,\n${titles}\n${values}`;
};

export const queryResultToCsv = async (
    queryResult: SerializedQueryResult | null,
    partitionKey?: PartitionKeyDefinition,
    selection?: number[],
): Promise<string> => {
    if (!queryResult) {
        return '';
    }

    const tableView = await queryResultToTable(queryResult, partitionKey, {
        ShowPartitionKey: 'none',
        ShowServiceColumns: 'last',
        Sorting: 'none',
        TruncateValues: 0,
    });
    const sep = getCsvSeparator();
    const headers = tableView.headers.map((hdr) => escapeCsvValue(hdr)).join(sep);

    if (selection) {
        tableView.dataset = tableView.dataset.filter((_, index) => selection.includes(index));
    }

    const rows = tableView.dataset
        .map((row) => {
            const rowValues: string[] = [];

            tableView.headers.forEach((header) => {
                if (header.startsWith('/')) {
                    header = header.slice(1);
                }

                const value = row[header] ?? '';
                rowValues.push(escapeCsvValue(value));
            });

            return rowValues.join(sep);
        })
        .join('\n');
    return `sep=,\n${headers}\n${rows}`;
};
