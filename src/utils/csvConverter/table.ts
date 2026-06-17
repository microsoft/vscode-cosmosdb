/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { type SerializedQueryResult } from '../../cosmosdb/types/queryResult';
import { queryResultToTable } from '../convertors';
import { escapeCsvValue, getCsvSeparator } from './escape';

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
                if (typeof value === 'string') {
                    rowValues.push(escapeCsvValue(value));
                } else {
                    rowValues.push(escapeCsvValue(JSON.stringify(value)));
                }
            });

            return rowValues.join(sep);
        })
        .join('\n');
    return `sep=,\n${headers}\n${rows}`;
};
