/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton } from '@fluentui/react-components';
import { ArrowClockwiseRegular, PlayRegular } from '@fluentui/react-icons';
import { useContext, type JSX } from 'react';
import { CollectionViewContext } from '../../collectionViewContext';
import { ToolbarDividerTransparent } from './ToolbarDividerTransparent';

export const ToolbarMainView = (): JSX.Element => {
    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);

    const handleExecuteQuery = () => {
        // return to the root level
        setCurrentContext((prev) => ({
            ...prev,
            currentViewState: {
                ...prev.currentViewState,
                currentPath: [],
            },
        }));

        // execute the query
        const queryContent = currentContext.queryEditor?.getCurrentContent() ?? '';
        setCurrentContext((prev) => ({
            ...prev,
            currrentQueryDefinition: { ...prev.currrentQueryDefinition, queryText: queryContent, pageNumber: 1 },
        }));
    };

    const handleRefreshResults = () => {
        // basically, do not modify the query at all, do not use the input from the editor
        setCurrentContext((prev) => ({
            ...prev,
            currrentQueryDefinition: { ...prev.currrentQueryDefinition },
        }));
    };

    return (
        <Toolbar size="small">
            <ToolbarButton
                aria-label="Execute the find query"
                disabled={currentContext.isLoading}
                icon={<PlayRegular />}
                onClick={handleExecuteQuery}
                appearance="primary"
            >
                Find Query
            </ToolbarButton>

            <ToolbarDividerTransparent />

            <ToolbarButton
                aria-label="Refresh current view"
                onClick={handleRefreshResults}
                icon={<ArrowClockwiseRegular />}
            >
                Refresh
            </ToolbarButton>
        </Toolbar>
    );
};
