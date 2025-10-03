/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { DEFAULT_PAGE_SIZE, type SerializedQueryResult } from '../../../../cosmosdb/types/queryResult';
import { isSelectStar } from '../../../../utils/convertors';

export const DEFAULT_QUERY_VALUE = `SELECT * FROM c`;

export type TableViewMode = 'Tree' | 'JSON' | 'Table';

export type DispatchAction =
    | {
          type: 'insertText';
          queryValue: string;
      }
    | {
          type: 'databaseConnected';
          dbName: string;
          collectionName: string;
          partitionKey?: PartitionKeyDefinition;
      }
    | {
          type: 'databaseDisconnected';
      }
    | {
          type: 'executionStarted';
          executionId: string;
          startExecutionTime: number;
      }
    | {
          type: 'executionStopped';
          executionId: string;
          endExecutionTime: number;
      }
    | {
          type: 'updateHistory';
          queryHistory: string[];
      }
    | {
          type: 'setPageSize';
          pageSize: number;
      }
    | {
          type: 'updateQueryResult';
          executionId: string;
          result: SerializedQueryResult;
          currentPage: number;
      }
    | {
          type: 'setTableViewMode';
          mode: TableViewMode;
      }
    | {
          type: 'setSelectedRows';
          selectedRows: number[];
      }
    | {
          type: 'setQuerySelectedValue';
          selectedValue: string;
      }
    | {
          type: 'setIsSurveyCandidate';
          isSurveyCandidate: boolean;
      }
    | {
          type: 'selectBucket';
          throughputBucket?: number;
      }
    | {
          type: 'updateThroughputBuckets';
          throughputBuckets?: boolean[];
      };
export type QueryEditorState = {
    dbName: string; // Database which is currently selected (Readonly, only server can change it) (Value exists on both client and server)
    collectionName: string; // Collection which is currently selected (Readonly, only server can change it) (Value exists on both client and server)
    partitionKey?: PartitionKeyDefinition; // Partition key of the collection (Readonly, only server can change it)
    currentExecutionId: string; // Execution ID of the current query (Value exists on both client and server)
    queryHistory: string[];
    queryValue: string;
    querySelectedValue: string;
    isConnected: boolean;
    isExecuting: boolean;
    isEditMode: boolean; // Query or selected query is start select (select * from c)
    startExecutionTime: number; // Time when the query execution started
    endExecutionTime: number; // Time when the query execution ended

    isSurveyCandidate: boolean; // Whether the user is a survey candidate

    // Result state
    pageNumber: number; // Current page number (Readonly, only server can change it) (Value exists on both client and server)
    pageSize: number;

    currentQueryResult: SerializedQueryResult | null;
    selectedRows: number[];

    throughputBuckets?: boolean[];
    selectedThroughputBucket?: number;

    tableViewMode: TableViewMode;
};

export const defaultState: QueryEditorState = {
    dbName: '',
    collectionName: '',
    partitionKey: undefined,
    currentExecutionId: '',
    queryHistory: [],
    queryValue: DEFAULT_QUERY_VALUE,
    querySelectedValue: '',
    isConnected: false,
    isExecuting: false,
    isEditMode: false,
    startExecutionTime: 0,
    endExecutionTime: 0,

    isSurveyCandidate: false,

    // Result state
    pageNumber: 1,
    pageSize: DEFAULT_PAGE_SIZE,

    currentQueryResult: null,
    selectedRows: [],

    throughputBuckets: [true, true, true, true, true],
    selectedThroughputBucket: undefined,

    tableViewMode: 'Table',
};

export function dispatch(state: QueryEditorState, action: DispatchAction): QueryEditorState {
    switch (action.type) {
        case 'insertText':
            return {
                ...state,
                queryValue: action.queryValue,
                isEditMode: isSelectStar(state.currentQueryResult?.query || action.queryValue || ''),
            };
        case 'databaseConnected':
            return {
                ...state,
                isConnected: true,
                dbName: action.dbName,
                collectionName: action.collectionName,
                partitionKey: action.partitionKey,
            };
        case 'databaseDisconnected':
            return { ...state, isConnected: false, dbName: '', collectionName: '' };
        case 'executionStarted':
            return {
                ...state,
                isExecuting: true,
                currentExecutionId: action.executionId,
                pageNumber: 1,
                currentQueryResult: null,
                startExecutionTime: action.startExecutionTime,
                isEditMode: isSelectStar(state.querySelectedValue || state.queryValue || ''),
            };
        case 'executionStopped': {
            if (action.executionId !== state.currentExecutionId) {
                // TODO: send telemetry. It should not happen
                return state;
            }
            return { ...state, isExecuting: false, endExecutionTime: action.endExecutionTime };
        }
        case 'updateHistory':
            return { ...state, queryHistory: action.queryHistory };
        case 'setPageSize':
            return { ...state, pageSize: action.pageSize };
        case 'updateQueryResult':
            return {
                ...state,
                currentQueryResult: action.result,
                pageNumber: action.currentPage,
                pageSize: action.result.metadata.countPerPage || DEFAULT_PAGE_SIZE,
                isEditMode: isSelectStar(action.result?.query || state.queryValue || ''),
            };
        case 'setTableViewMode':
            return { ...state, tableViewMode: action.mode };
        case 'setSelectedRows':
            return { ...state, selectedRows: action.selectedRows };
        case 'setQuerySelectedValue':
            return { ...state, querySelectedValue: action.selectedValue };
        case 'setIsSurveyCandidate':
            return { ...state, isSurveyCandidate: action.isSurveyCandidate };
        case 'selectBucket':
            return { ...state, selectedThroughputBucket: action.throughputBucket };
        case 'updateThroughputBuckets':
            return { ...state, throughputBuckets: action.throughputBuckets };
    }
}
