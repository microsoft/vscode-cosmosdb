import { createContext } from 'react';

export enum Views {
    TABLE = 'table',
    TREE = 'tree',
    JSON = 'json',
}

export const CollectionViewContext = createContext({
    currentView: Views.TABLE,
});
