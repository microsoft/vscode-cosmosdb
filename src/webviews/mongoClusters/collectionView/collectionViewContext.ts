import { createContext } from 'react';

export enum Views {
    TABLE = 'Table View',
    TREE = 'Tree View',
    JSON = 'JSON View',
}

export type CollectionViewContextType = {
    isLoading: boolean; // this is a concious decision to use 'isLoading' instead of <Suspense> tags. It's not only the data display component that is supposed to react to the lading state but also some input fields, buttons, etc.
    currentView: Views;
    queryConfig: {
        queryText: string;
        pageNumber: number;
        pageSize: number;
    };
};

export const DefaultCollectionViewContext: CollectionViewContextType = {
    isLoading: false,
    currentView: Views.TABLE,
    queryConfig: {
        queryText: '{  }',
        pageNumber: 1,
        pageSize: 10,
    },
};

export const CollectionViewContext = createContext([
    DefaultCollectionViewContext,
    (_param: CollectionViewContextType): void => {
        // just a dummy placeholder for scenarios where the context is not set
        return;
    },
] as const);
