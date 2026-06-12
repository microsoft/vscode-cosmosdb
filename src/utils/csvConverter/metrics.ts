/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SerializedQueryResult } from '../../cosmosdb/types/queryResult';
import { indexMetricsToTableItem, queryMetricsToTable } from '../convertors';
import { escapeCsvValue } from './escape';

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
