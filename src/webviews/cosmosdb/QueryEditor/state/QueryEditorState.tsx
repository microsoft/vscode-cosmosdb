/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { DEFAULT_PAGE_SIZE, type SerializedQueryResult } from '../../../../cosmosdb/types/queryResult';

export const DEFAULT_QUERY_VALUE = `SELECT * FROM c`;
export const QUERY_HISTORY_SIZE = 10;

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
    startExecutionTime: number; // Time when the query execution started
    endExecutionTime: number; // Time when the query execution ended

    isSurveyCandidate: boolean; // Whether the user is a survey candidate

    // Result state
    pageNumber: number; // Current page number (Readonly, only server can change it) (Value exists on both client and server)
    pageSize: number;

    currentQueryResult: SerializedQueryResult | null;
    selectedRows: number[];

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
    startExecutionTime: 0,
    endExecutionTime: 0,

    isSurveyCandidate: false,

    // Result state
    pageNumber: 1,
    pageSize: DEFAULT_PAGE_SIZE,

    currentQueryResult: null,
    selectedRows: [],

    tableViewMode: 'Table',
};

export function dispatch(state: QueryEditorState, action: DispatchAction): QueryEditorState {
    switch (action.type) {
        case 'insertText':
            return { ...state, queryValue: action.queryValue };
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
            return { ...state, currentQueryResult: action.result, pageNumber: action.currentPage };
        case 'setTableViewMode':
            return { ...state, tableViewMode: action.mode };
        case 'setSelectedRows':
            return { ...state, selectedRows: action.selectedRows };
        case 'setQuerySelectedValue':
            return { ...state, querySelectedValue: action.selectedValue };
        case 'setIsSurveyCandidate':
            return { ...state, isSurveyCandidate: action.isSurveyCandidate };
    }
}
