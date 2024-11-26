/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKey, type PartitionKeyDefinition } from '@azure/cosmos';
import { parse as parseJson } from '@prantlf/jsonlint';
import { isEqual } from 'lodash';

export type OpenDocumentMode = 'add' | 'edit' | 'view';

export type DispatchAction =
    | {
          type: 'initState';
          mode: OpenDocumentMode;
          documentId: string;
          partitionKey: PartitionKey | undefined;
          databaseId: string;
          containerId: string;
      }
    | {
          type: 'setDirty';
          isDirty: boolean;
      }
    | {
          type: 'setDocument';
          documentContent: string;
          partitionKey: PartitionKeyDefinition;
      }
    | {
          type: 'setCurrentDocument';
          documentContent: string;
      }
    | {
          type: 'setMode';
          mode: OpenDocumentMode;
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

export type DocumentState = {
    dbName: string; // Database which is currently selected (Readonly, only server can change it) (Value exists on both client and server)
    collectionName: string; // Collection which is currently selected (Readonly, only server can change it) (Value exists on both client and server)

    documentId: string; // Id of the document (Readonly, only server can change it)
    documentContent: string; // Content of the document (Readonly, only server can change it)
    partitionKey: PartitionKeyDefinition; // Partition key of the document (Readonly, only server can change it)

    mode: OpenDocumentMode; // Mode of the document (add, edit, view) (Readonly, only server can change it)

    isValid: boolean; // Document is valid
    isDirty: boolean; // Document has been modified
    isSaving: boolean; // Document is being saved
    isRefreshing: boolean; // Document is being refreshed
    isInit: boolean; // Document is being initialized

    currentDocumentContent: string; // Current content of the document
    error: string | undefined; // Error message
};

export const defaultState: DocumentState = {
    dbName: '',
    collectionName: '',
    documentId: '',
    documentContent: '',
    partitionKey: { paths: [] },
    mode: 'view',
    isValid: true,
    isDirty: false,
    isSaving: false,
    isRefreshing: false,
    isInit: false,
    currentDocumentContent: '',
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

export function dispatch(state: DocumentState, action: DispatchAction): DocumentState {
    switch (action.type) {
        case 'initState':
            return {
                ...state,
                mode: action.mode,
                documentId: action.documentId,
                dbName: action.databaseId,
                collectionName: action.containerId,
                isInit: true,
            };
        case 'setDocument':
            return {
                ...state,
                documentContent: action.documentContent,
                currentDocumentContent: action.documentContent,
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
        case 'setCurrentDocument':
            return {
                ...state,
                currentDocumentContent: action.documentContent,
                isDirty: isDirty(state.documentContent, action.documentContent),
            };
        default:
            return state;
    }
}
