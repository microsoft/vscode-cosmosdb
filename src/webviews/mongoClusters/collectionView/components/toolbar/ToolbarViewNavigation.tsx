/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Label, Option, Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowLeftFilled, ArrowPreviousFilled, ArrowRightFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useContext } from 'react';
import { ExperienceKind, UsageImpact } from '../../../../../utils/surveyTypes';
import { useTrpcClient } from '../../../../api/webview-client/useTrpcClient';
import { CollectionViewContext } from '../../collectionViewContext';
import { ToolbarDividerTransparent } from './ToolbarDividerTransparent';

export const ToolbarViewNavigation = (): JSX.Element => {
    /**
     * Use the `useTrpcClient` hook to get the tRPC client
     */
    const { trpcClient } = useTrpcClient();

    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);

    function goToNextPage() {
        const newPage = currentContext.currentQueryDefinition.pageNumber + 1;

        setCurrentContext({
            ...currentContext,
            currentQueryDefinition: {
                ...currentContext.currentQueryDefinition,
                pageNumber: newPage,
            },
        });

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'pagination',
                properties: {
                    source: 'next-page',
                    ui: 'button',
                    view: currentContext.currentView,
                },
                measurements: {
                    page: newPage,
                    pageSize: currentContext.currentQueryDefinition.pageSize,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });

        trpcClient.common.surveyPing
            .mutate({ experienceKind: ExperienceKind.Mongo, usageImpact: UsageImpact.Medium })
            .catch(() => {});
    }

    function goToPreviousPage() {
        const newPage = Math.max(1, currentContext.currentQueryDefinition.pageNumber - 1);

        setCurrentContext({
            ...currentContext,
            currentQueryDefinition: {
                ...currentContext.currentQueryDefinition,
                pageNumber: newPage,
            },
        });

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'pagination',
                properties: {
                    source: 'prev-page',
                    ui: 'button',
                    view: currentContext.currentView,
                },
                measurements: {
                    page: newPage,
                    pageSize: currentContext.currentQueryDefinition.pageSize,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });

        trpcClient.common.surveyPing
            .mutate({ experienceKind: ExperienceKind.Mongo, usageImpact: UsageImpact.Medium })
            .catch(() => {});
    }

    function goToFirstPage() {
        setCurrentContext({
            ...currentContext,
            currentQueryDefinition: { ...currentContext.currentQueryDefinition, pageNumber: 1 },
        });

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'pagination',
                properties: {
                    source: 'first-page',
                    ui: 'button',
                    view: currentContext.currentView,
                },
                measurements: {
                    page: 1,
                    pageSize: currentContext.currentQueryDefinition.pageSize,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    }

    function setPageSize(pageSize: number) {
        setCurrentContext({
            ...currentContext,
            currentQueryDefinition: {
                ...currentContext.currentQueryDefinition,
                pageSize: pageSize,
                pageNumber: 1,
            },
        });

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'pagination',
                properties: {
                    source: 'page-size',
                    ui: 'button',
                    view: currentContext.currentView,
                },
                measurements: {
                    page: currentContext.currentQueryDefinition.pageNumber,
                    pageSize: pageSize,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    }

    return (
        <Toolbar aria-label="with Popover" size="small">
            <Tooltip content={l10n.t('Go to first page')} relationship="description" withArrow>
                <ToolbarButton
                    onClick={goToFirstPage}
                    aria-label={l10n.t('Go to start')}
                    icon={<ArrowPreviousFilled />}
                    disabled={currentContext.isLoading}
                />
            </Tooltip>

            <Tooltip content={l10n.t('Go to previous page')} relationship="description" withArrow>
                <ToolbarButton
                    onClick={goToPreviousPage}
                    aria-label={l10n.t('Go to previous page')}
                    icon={<ArrowLeftFilled />}
                    disabled={currentContext.isLoading}
                />
            </Tooltip>

            <Tooltip content={l10n.t('Go to next page')} relationship="description" withArrow>
                <ToolbarButton
                    onClick={goToNextPage}
                    aria-label={l10n.t('Go to next page')}
                    icon={<ArrowRightFilled />}
                    disabled={currentContext.isLoading}
                />
            </Tooltip>

            <ToolbarDividerTransparent />

            <Tooltip content={l10n.t('Change page size')} relationship="description" withArrow>
                <Dropdown
                    disabled={currentContext.isLoading}
                    onOptionSelect={(_e, data) => {
                        setPageSize(parseInt(data.optionText ?? '10'));
                    }}
                    style={{ minWidth: '100px', maxWidth: '100px' }}
                    defaultValue="10"
                    defaultSelectedOptions={['10']}
                >
                    <Option key="10">10</Option>
                    <Option key="10">50</Option>
                    <Option key="100">100</Option>
                    <Option key="500">500</Option>
                </Dropdown>
            </Tooltip>

            <ToolbarDividerTransparent />

            <Label weight="semibold" className="lblPageNumber">
                <pre>Page {currentContext.currentQueryDefinition.pageNumber}</pre>
            </Label>
        </Toolbar>
    );
};
