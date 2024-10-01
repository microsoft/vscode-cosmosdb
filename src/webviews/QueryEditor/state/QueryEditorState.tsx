/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SerializedQueryResult } from '../../../docdb/types/queryResult';

export const DEFAULT_QUERY_VALUE = `SELECT * FROM c`;
export const QUERY_HISTORY_SIZE = 10;
export const DEFAULT_PAGE_SIZE = 100;

export type TableViewMode = 'Tree' | 'JSON' | 'Table';
export type EditMode = 'View' | 'Edit';

export type DispatchAction =
    | {
        type: 'insertText';
        queryValue: string;
    }
    | {
        type: 'databaseConnected';
        dbName: string;
        collectionName: string;
    }
    | {
        type: 'databaseDisconnected';
    }
    | {
        type: 'executionStarted';
        executionId: string;
    }
    | {
        type: 'executionStopped';
        executionId: string;
    }
    | {
        type: 'appendQueryHistory';
        queryValue: string;
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
        type: 'setEditMode';
        mode: EditMode;
    };

export type QueryEditorState = {
    dbName: string; // Database which is currently selected (Readonly, only server can change it) (Value exists on both client and server)
    collectionName: string; // Collection which is currently selected (Readonly, only server can change it) (Value exists on both client and server)
    currentExecutionId: string; // Execution ID of the current query (Value exists on both client and server)
    queryHistory: string[];
    queryValue: string;
    isConnected: boolean;
    isExecuting: boolean;

    // Result state
    pageNumber: number; // Current page number (Readonly, only server can change it) (Value exists on both client and server)
    pageSize: number;

    currentQueryResult: SerializedQueryResult | null;

    tableViewMode: TableViewMode;
    editMode: EditMode;
};

export const defaultState: QueryEditorState = {
    dbName: '',
    collectionName: '',
    currentExecutionId: '',
    queryHistory: [],
    queryValue: DEFAULT_QUERY_VALUE,
    isConnected: false,
    isExecuting: false,

    // Result state
    pageNumber: 1,
    pageSize: DEFAULT_PAGE_SIZE,

    currentQueryResult: null,

    tableViewMode: 'Tree',
    editMode: 'View',
};

export function dispatch(state: QueryEditorState, action: DispatchAction): QueryEditorState {
    switch (action.type) {
        case 'insertText':
            return { ...state, queryValue: action.queryValue };
        case 'databaseConnected':
            return { ...state, isConnected: true, dbName: action.dbName, collectionName: action.collectionName };
        case 'databaseDisconnected':
            return { ...state, isConnected: false, dbName: '', collectionName: '' };
        case 'executionStarted':
            return {
                ...state,
                isExecuting: true,
                currentExecutionId: action.executionId,
                pageNumber: 1,
                currentQueryResult: null,
            };
        case 'executionStopped': {
            if (action.executionId !== state.currentExecutionId) {
                // TODO: send telemetry. It should not happen
                return state;
            }
            return { ...state, isExecuting: false };
        }
        case 'appendQueryHistory': {
            const queryHistory = [...state.queryHistory, action.queryValue].filter(
                (value, index, self) => self.indexOf(value) === index,
            );
            if (queryHistory.length > QUERY_HISTORY_SIZE) {
                queryHistory.shift();
            }
            return { ...state, queryHistory };
        }
        case 'setPageSize':
            return { ...state, pageSize: action.pageSize };
        case 'updateQueryResult':
            return { ...state, currentQueryResult: action.result, pageNumber: action.currentPage };
        case 'setTableViewMode':
            return { ...state, tableViewMode: action.mode };
        case 'setEditMode':
            return { ...state, editMode: action.mode };
    }
}
