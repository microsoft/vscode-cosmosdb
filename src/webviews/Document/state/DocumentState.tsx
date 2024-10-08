/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type DispatchAction =
    | {
          type: 'setDirty';
          isDirty: boolean;
      }
    | {
          type: 'setDocument';
          documentContent: string;
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
          error: string;
      };

export type DocumentState = {
    dbName: string; // Database which is currently selected (Readonly, only server can change it) (Value exists on both client and server)
    collectionName: string; // Collection which is currently selected (Readonly, only server can change it) (Value exists on both client and server)

    documentId: string;
    documentContent: string;

    mode: 'add' | 'edit' | 'view'; // Mode of the document (add, edit, view)

    isDirty: boolean; // Document has been modified
    isSaving: boolean; // Document is being saved
    isRefreshing: boolean; // Document is being refreshed

    error: string | undefined; // Error message
};

export const defaultState: DocumentState = {
    dbName: '',
    collectionName: '',
    documentId: '',
    documentContent: '',
    mode: 'view',
    isDirty: false,
    isSaving: false,
    isRefreshing: false,
    error: undefined,
};

export function dispatch(state: DocumentState, action: DispatchAction): DocumentState {
    switch (action.type) {
        case 'setDocument':
            return {
                ...state,
            };
        case 'setDirty':
            return { ...state, isDirty: action.isDirty };
        case 'setSaving':
            return { ...state, isSaving: action.isSaving };
        case 'setRefreshing':
            return { ...state, isRefreshing: action.isRefreshing };
        case 'setError':
            return { ...state, error: action.error };
        default:
            return state;
    }
}
