/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    Tooltip,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    ArrowExportRegular,
    ArrowImportRegular,
    CommentCheckmarkRegular,
    EmojiSmileSlightRegular,
    PlayRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useContext, type JSX } from 'react';
import { ExperienceKind } from '../../../../../utils/surveyTypes';
import { useTrpcClient } from '../../../../api/webview-client/useTrpcClient';
import { CollectionViewContext } from '../../collectionViewContext';
import { ToolbarDividerTransparent } from './ToolbarDividerTransparent';

export const ToolbarMainView = (): JSX.Element => {
    const { trpcClient } = useTrpcClient();

    return (
        <>
            <ToolbarQueryOperations />
            <ToolbarDataOperations />
            <ToolbarDivider />
            <Menu>
                <MenuTrigger>
                    <Tooltip content={l10n.t('Provide Feedback')} relationship="label">
                        <ToolbarButton
                            aria-label={l10n.t('Provide Feedback')}
                            icon={<EmojiSmileSlightRegular />}
                        ></ToolbarButton>
                    </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem
                            icon={<CommentCheckmarkRegular />}
                            onClick={() => {
                                trpcClient.common.surveyOpen
                                    .mutate({
                                        experienceKind: ExperienceKind.Mongo,
                                        triggerAction: 'cosmosDB.mongo.collectionView.provideFeedback',
                                    })
                                    .catch(() => {});
                            }}
                        >
                            {l10n.t('Provide Feedback')}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </>
    );
};

const ToolbarQueryOperations = (): JSX.Element => {
    /**
     * Use the `useTrpcClient` hook to get the tRPC client
     */
    const { trpcClient } = useTrpcClient();

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
            currentQueryDefinition: { ...prev.currentQueryDefinition, queryText: queryContent, pageNumber: 1 },
        }));

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'executeQuery',
                properties: {
                    ui: 'button',
                },
                measurements: {
                    queryLength: queryContent.length,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    };

    const handleRefreshResults = () => {
        // basically, do not modify the query at all, do not use the input from the editor
        setCurrentContext((prev) => ({
            ...prev,
            currentQueryDefinition: { ...prev.currentQueryDefinition },
        }));

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'refreshResults',
                properties: {
                    ui: 'button',
                    view: currentContext.currentView,
                },
                measurements: {
                    page: currentContext.currentQueryDefinition.pageNumber,
                    pageSize: currentContext.currentQueryDefinition.pageSize,
                    queryLength: currentContext.currentQueryDefinition.queryText.length,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    };

    return (
        <Toolbar size="small">
            <ToolbarButton
                aria-label={l10n.t('Execute the find query')}
                disabled={currentContext.isLoading}
                icon={<PlayRegular />}
                onClick={handleExecuteQuery}
                appearance="primary"
            >
                {l10n.t('Find Query')}
            </ToolbarButton>

            <ToolbarDividerTransparent />

            <ToolbarButton
                aria-label={l10n.t('Refresh current view')}
                onClick={handleRefreshResults}
                icon={<ArrowClockwiseRegular />}
            >
                {l10n.t('Refresh')}
            </ToolbarButton>
        </Toolbar>
    );
};

const ToolbarDataOperations = (): JSX.Element => {
    const [currentContext] = useContext(CollectionViewContext);

    const { trpcClient } = useTrpcClient();

    const handleImportFromJson = () => {
        void trpcClient.mongoClusters.collectionView.importDocuments.query();
    };

    const handleExportEntireCollection = () => {
        void trpcClient.mongoClusters.collectionView.exportDocuments.query({ query: '{}' });
    };

    const handleExportQueryResults = () => {
        void trpcClient.mongoClusters.collectionView.exportDocuments.query({
            query: currentContext.currentQueryDefinition.queryText,
        });
    };

    return (
        <Toolbar size="small">
            <Menu>
                <MenuTrigger>
                    <ToolbarButton icon={<ArrowImportRegular />}>{l10n.t('Import')}</ToolbarButton>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem onClick={handleImportFromJson}>{l10n.t('Import From JSON…')}</MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
            <Menu>
                <MenuTrigger>
                    <ToolbarButton icon={<ArrowExportRegular />}>{l10n.t('Export')}</ToolbarButton>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem onClick={handleExportEntireCollection}>
                            {l10n.t('Export Entire Collection…')}
                        </MenuItem>
                        <MenuItem onClick={handleExportQueryResults}>
                            {l10n.t('Export Current Query Results…')}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </Toolbar>
    );
};
