import { createContext } from 'react';

export enum Views {
    TABLE = 'Table View',
    TREE = 'Tree View',
    JSON = 'JSON View',
}

export type CollectionViewContextType = {
    currentView: Views;
    queryConfig: {
        queryText: string;
        pageNumber: number;
        pageSize: number;
    }
};

export const DefaultCollectionViewContext: CollectionViewContextType = {
    currentView: Views.TABLE,
    queryConfig: {
        queryText: '{  }',
        pageNumber: 1,
        pageSize: 10,
    },
};

export const CollectionViewContext = createContext([
    DefaultCollectionViewContext,
    (_param: CollectionViewContextType) : void => { // just a dummy placeholder for scenarios where the context is not set
        return;
    },
] as const);
