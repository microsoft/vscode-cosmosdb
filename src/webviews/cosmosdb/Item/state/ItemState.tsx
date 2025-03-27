/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKey, type PartitionKeyDefinition } from '@azure/cosmos';
import { parse as parseJson } from '@prantlf/jsonlint';
import { isEqual } from 'lodash';

export type OpenItemMode = 'add' | 'edit' | 'view';

export type DispatchAction =
    | {
          type: 'initState';
          mode: OpenItemMode;
          itemId: string;
          partitionKey: PartitionKey | undefined;
          databaseId: string;
          containerId: string;
      }
    | {
          type: 'setDirty';
          isDirty: boolean;
      }
    | {
          type: 'setItem';
          itemContent: string;
          partitionKey: PartitionKeyDefinition;
      }
    | {
          type: 'setCurrentItem';
          itemContent: string;
      }
    | {
          type: 'setMode';
          mode: OpenItemMode;
      }
    | {
          type: 'setValid';
          isValid: boolean;
      }
    | {
          type: 'setSaving';
          isSaving: boolean;
      }
    | {
          type: 'setRefreshing';
          isRefreshing: boolean;
      }
    | {
          type: 'setError';
          error: string | undefined;
      };

export type ItemState = {
    dbName: string; // Database which is currently selected (Readonly, only server can change it) (Value exists on both client and server)
    collectionName: string; // Collection which is currently selected (Readonly, only server can change it) (Value exists on both client and server)

    itemId: string; // Id of the item (Readonly, only server can change it)
    itemContent: string; // Content of the item (Readonly, only server can change it)
    partitionKey: PartitionKeyDefinition; // Partition key of the item (Readonly, only server can change it)

    mode: OpenItemMode; // Mode of the item (add, edit, view) (Readonly, only server can change it)

    isValid: boolean; // Item is valid
    isDirty: boolean; // Item has been modified
    isSaving: boolean; // Item is being saved
    isRefreshing: boolean; // Item is being refreshed
    isReady: boolean; // Item is being initialized

    currentItemContent: string; // Current content of the item
    error: string | undefined; // Error message
};

export const defaultState: ItemState = {
    dbName: '',
    collectionName: '',
    itemId: '',
    itemContent: '',
    partitionKey: { paths: [] },
    mode: 'view',
    isValid: true,
    isDirty: false,
    isSaving: false,
    isRefreshing: false,
    isReady: false,
    currentItemContent: '',
    error: undefined,
};

const isDirty = (content1: string, content2: string): boolean => {
    try {
        const obj1 = parseJson(content1);
        const obj2 = parseJson(content2);

        return !isEqual(obj1, obj2);
    } catch {
        return content1.replaceAll('\r', '') !== content2.replaceAll('\r', '');
    }
};

export function dispatch(state: ItemState, action: DispatchAction): ItemState {
    switch (action.type) {
        case 'initState':
            return {
                ...state,
                mode: action.mode,
                itemId: action.itemId,
                dbName: action.databaseId,
                collectionName: action.containerId,
                isReady: true,
            };
        case 'setItem':
            return {
                ...state,
                itemContent: action.itemContent,
                currentItemContent: action.itemContent,
                partitionKey: action.partitionKey,
                isDirty: false,
            };
        case 'setMode':
            return { ...state, mode: action.mode };
        case 'setValid':
            return { ...state, isValid: action.isValid };
        case 'setDirty':
            return { ...state, isDirty: action.isDirty };
        case 'setSaving':
            return { ...state, isSaving: action.isSaving };
        case 'setRefreshing':
            return { ...state, isRefreshing: action.isRefreshing };
        case 'setError':
            return { ...state, error: action.error };
        case 'setCurrentItem':
            return {
                ...state,
                currentItemContent: action.itemContent,
                isDirty: isDirty(state.itemContent, action.itemContent),
            };
        default:
            return state;
    }
}
