/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Toolbar, ToolbarButton } from '@fluentui/react-components';
import { ArrowClockwiseRegular, ArrowExportRegular, ArrowImportRegular, PlayRegular } from '@fluentui/react-icons';
import { useContext, type JSX } from 'react';
import { useTrpcClient } from '../../../../api/webview-client/useTrpcClient';
import { CollectionViewContext } from '../../collectionViewContext';
import { ToolbarDividerTransparent } from './ToolbarDividerTransparent';

export const ToolbarMainView = (): JSX.Element => {
    return (
        <>
            <ToolbarQueryOperations />
            <ToolbarDataOperations />
        </>
    );
};

const ToolbarQueryOperations = (): JSX.Element => {
    /**
     * Use the `useTrpcClient` hook to get the tRPC client and an event target
     * for handling notifications from the extension.
     */
    const { trpcClient /** , vscodeEventTarget */ } = useTrpcClient();

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

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'executeQuery',
                properties: {
                    ui: 'button',
                },
                measurements: {
                    queryLenth: queryContent.length,
                },
            })
            .catch((error) => {
                console.debug('Failed to report query event:', error);
            });
    };

    const handleRefreshResults = () => {
        // basically, do not modify the query at all, do not use the input from the editor
        setCurrentContext((prev) => ({
            ...prev,
            currrentQueryDefinition: { ...prev.currrentQueryDefinition },
        }));

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'refreshResults',
                properties: {
                    ui: 'button',
                    view: currentContext.currentView,
                },
                measurements: {
                    page: currentContext.currrentQueryDefinition.pageNumber,
                    pageSize: currentContext.currrentQueryDefinition.pageSize,
                    queryLength: currentContext.currrentQueryDefinition.queryText.length,
                },
            })
            .catch((error) => {
                console.debug('Failed to report query event:', error);
            });
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

const ToolbarDataOperations = (): JSX.Element => {
    const [currentContext] = useContext(CollectionViewContext);

    const { trpcClient /** , vscodeEventTarget */ } = useTrpcClient();

    const handleImportFromJson = () => {
        void trpcClient.mongoClusters.collectionView.importDocuments.query();
    };

    const handleExportEntireCollection = () => {
        void trpcClient.mongoClusters.collectionView.exportDocuments.query({ query: '{}' });
    };

    const handleExportQueryResults = () => {
        void trpcClient.mongoClusters.collectionView.exportDocuments.query({
            query: currentContext.currrentQueryDefinition.queryText,
        });
    };

    return (
        <Toolbar size="small">
            <Menu>
                <MenuTrigger>
                    <ToolbarButton icon={<ArrowImportRegular />}>Import</ToolbarButton>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem onClick={handleImportFromJson}>Import From JSON...</MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
            <Menu>
                <MenuTrigger>
                    <ToolbarButton icon={<ArrowExportRegular />}>Export</ToolbarButton>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem onClick={handleExportEntireCollection}>Export Entire Collection...</MenuItem>
                        <MenuItem onClick={handleExportQueryResults}>Export Current Query Results...</MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </Toolbar>
    );
};
