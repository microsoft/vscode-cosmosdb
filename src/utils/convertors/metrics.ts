/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query-metrics conversion: turn a SerializedQueryResult's metrics into StatsItem[] / JSON.
 *
 * NOTE: Mostly of these functions are async to be able to move them to backend in the future.
 */

import * as l10n from '@vscode/l10n';
import { type SerializedQueryResult } from '../../cosmosdb/types/queryResult';
import { type StatsItem } from './types';

export const queryMetricsToTable = (queryResult: SerializedQueryResult | null): Promise<StatsItem[]> => {
    if (!queryResult || queryResult?.queryMetrics === undefined) {
        return Promise.resolve([]);
    }

    const { queryMetrics, iteration, metadata } = queryResult;
    const documentsCount = queryResult.documents?.length ?? 0;
    const countPerPage = metadata.countPerPage ?? 100;

    const recordsCount =
        countPerPage === -1
            ? documentsCount
                ? `0 - ${documentsCount}`
                : l10n.t('All')
            : `${(iteration - 1) * countPerPage} - ${iteration * countPerPage}`;

    const stats: StatsItem[] = [
        {
            metric: l10n.t('Request Charge', { comment: 'Cosmos DB metrics' }),
            value: queryResult.requestCharge,
            formattedValue: `${queryResult.requestCharge} RUs`,
            tooltip: l10n.t('Request Charge', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Showing Results', { comment: 'Cosmos DB metrics' }),
            value: recordsCount,
            formattedValue: recordsCount,
            tooltip: l10n.t('Showing Results', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Retrieved document count', { comment: 'Cosmos DB metrics' }),
            value: queryResult.documents?.length ?? 0,
            formattedValue: `${queryResult.documents?.length ?? 0}`,
            tooltip: l10n.t('Total number of retrieved documents', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Retrieved document size', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.retrievedDocumentSize ?? 0,
            formattedValue: `${queryMetrics.retrievedDocumentSize ?? 0} bytes`,
            tooltip: l10n.t('Total size of retrieved documents in bytes', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Output document count', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.outputDocumentCount ?? 0,
            formattedValue: `${queryMetrics.outputDocumentCount ?? ''}`,
            tooltip: l10n.t('Number of output documents', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Output document size', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.outputDocumentSize ?? 0,
            formattedValue: `${queryMetrics.outputDocumentSize ?? 0} bytes`,
            tooltip: l10n.t('Total size of output documents in bytes', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Index hit document count', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.indexHitDocumentCount ?? 0,
            formattedValue: `${queryMetrics.indexHitDocumentCount ?? ''}`,
            tooltip: l10n.t('Total number of documents matched by the filter', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Index lookup time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.indexLookupTime ?? 0,
            formattedValue: `${queryMetrics.indexLookupTime ?? 0} ms`,
            tooltip: l10n.t('Time spent in physical index layer', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Document load time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.documentLoadTime ?? 0,
            formattedValue: `${queryMetrics.documentLoadTime ?? 0} ms`,
            tooltip: l10n.t('Time spent in loading documents', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Query engine execution time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.runtimeExecutionTimes.queryEngineExecutionTime ?? 0,
            formattedValue: `${queryMetrics.runtimeExecutionTimes.queryEngineExecutionTime ?? 0} ms`,
            tooltip: l10n.t(
                'Time spent by the query engine to execute the query expression (excludes other execution times like load documents or write results)',
                { comment: 'Cosmos DB metrics' },
            ),
        },
        {
            metric: l10n.t('System function execution time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.runtimeExecutionTimes.systemFunctionExecutionTime ?? 0,
            formattedValue: `${queryMetrics.runtimeExecutionTimes.systemFunctionExecutionTime ?? 0} ms`,
            tooltip: l10n.t('Total time spent executing system (built-in) functions', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('User defined function execution time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.runtimeExecutionTimes.userDefinedFunctionExecutionTime ?? 0,
            formattedValue: `${queryMetrics.runtimeExecutionTimes.userDefinedFunctionExecutionTime ?? 0} ms`,
            tooltip: l10n.t('Total time spent executing user-defined functions', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Document write time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.documentWriteTime ?? 0,
            formattedValue: `${queryMetrics.documentWriteTime ?? 0} ms`,
            tooltip: l10n.t('Time spent to write query result set to response buffer', {
                comment: 'Cosmos DB metrics',
            }),
        },
    ];

    if (queryResult.roundTrips) {
        stats.push({
            metric: l10n.t('Round Trips'),
            value: queryResult.roundTrips,
            formattedValue: `${queryResult.roundTrips}`,
            tooltip: l10n.t('Number of round trips'),
        });
    }
    if (queryResult.activityId) {
        stats.push({
            metric: l10n.t('Activity id'),
            value: queryResult.activityId,
            formattedValue: `${queryResult.activityId}`,
            tooltip: '',
        });
    }

    return Promise.resolve(stats);
};

export const indexMetricsToTableItem = (queryResult: SerializedQueryResult): StatsItem => {
    return {
        metric: l10n.t('Index Metrics'),
        value: queryResult.indexMetrics.trim(),
        formattedValue: queryResult.indexMetrics.trim(),
        tooltip: '',
    };
};

export const queryMetricsToJSON = async (queryResult: SerializedQueryResult | null): Promise<string> => {
    if (!queryResult) {
        return '';
    }

    const stats = await queryMetricsToTable(queryResult);

    stats.push(indexMetricsToTableItem(queryResult));

    return JSON.stringify(stats, null, 4);
};
