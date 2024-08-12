import { useContext } from 'react';
import { CollectionViewContext } from './collectionViewContext';

export const DataViewPanelTable = (): JSX.Element => {
    const { currentView } = useContext(CollectionViewContext);
    return <div className="resultsDisplayArea">..placeholder table.. {currentView}</div>;
};
