/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { SettingsService } from '../services/SettingsService';
import { indexMetricsToTableItem, queryMetricsToTable, queryResultToTable } from './convertors';

export const escapeCsvValue = (value: string): string => {
    return `"${value.replace(/"/g, '""')}"`;
};

function getCsvSeparator(): string {
    return SettingsService.getSetting<string>('cosmosDB.csvSeparator') ?? ';';
}

export const queryMetricsToCsv = (queryResult: SerializedQueryResult | null): string => {
    if (!queryResult) {
        return '';
    }

    const stats = queryMetricsToTable(queryResult);

    stats.push(indexMetricsToTableItem(queryResult));

    const titles = stats.map((item) => escapeCsvValue(item.metric)).join(getCsvSeparator());
    const values = stats.map((item) => escapeCsvValue(item.value.toString())).join(getCsvSeparator());
    return `${titles}\n${values}`;
};

export const queryResultToCsv = (
    queryResult: SerializedQueryResult | null,
    partitionKey?: PartitionKeyDefinition,
    selection?: number[],
): string => {
    if (!queryResult) {
        return '';
    }

    const tableView = queryResultToTable(queryResult, partitionKey);
    const headers = tableView.headers.map((hdr) => escapeCsvValue(hdr)).join(getCsvSeparator());

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

            return rowValues.join(getCsvSeparator());
        })
        .join('\n');
    return `${headers}\n${rows}`;
};
