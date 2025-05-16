/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type OptionOnSelectData } from '@fluentui/react-combobox';
import { Dropdown, Option, Toolbar, ToolbarButton, Tooltip, useRestoreFocusTarget } from '@fluentui/react-components';
import { AddFilled, DeleteRegular, EditRegular, EyeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo, useState } from 'react';
import { type CosmosDBRecordIdentifier } from '../../../../cosmosdb/types/queryResult';
import { AlertDialog } from '../../../common/AlertDialog';
import { getDocumentId, isSelectStar } from '../../../utils';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { type TableViewMode } from '../state/QueryEditorState';

export type ResultToolbarProps = { selectedTab: string };

const ToolbarDividerTransparent = () => {
    return <div style={{ padding: '18px' }} />;
};

export const ResultTabToolbar = ({ selectedTab }: ResultToolbarProps) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const restoreFocusTargetAttribute = useRestoreFocusTarget();
    const [isOpen, setIsOpen] = useState(false);

    const isEditMode = useMemo<boolean>(() => {
        return state.isExecuting
            ? isSelectStar(state.querySelectedValue || state.queryValue || '')
            : isSelectStar(state.currentQueryResult?.query ?? '');
    }, [state.currentQueryResult, state.isExecuting, state.querySelectedValue, state.queryValue]);

    const visibility = state.isExecuting ? 'hidden' : 'visible';
    const hasSelectedRows = state.selectedRows.length > 0;

    const getSelectedDocuments = useCallback(() => {
        return state.selectedRows
            .map((rowIndex): CosmosDBRecordIdentifier | undefined => {
                const document = state.currentQueryResult?.documents[rowIndex];
                return document ? getDocumentId(document, state.partitionKey) : undefined;
            })
            .filter((document) => document !== undefined);
    }, [state.selectedRows, state.currentQueryResult?.documents, state.partitionKey]);

    const onOptionSelect = useCallback(
        (data: OptionOnSelectData) => {
            if (data.optionValue) dispatcher.setTableViewMode(data.optionValue as TableViewMode);
        },
        [dispatcher],
    );

    const handleDialogClose = useCallback(
        (confirmed: boolean) => {
            if (confirmed) {
                const selectedDocuments = getSelectedDocuments();
                void dispatcher.deleteDocuments(selectedDocuments);
            }
            setIsOpen(false);
        },
        [dispatcher, getSelectedDocuments],
    );

    const handleDeleteClick = useCallback(() => {
        setIsOpen(true);
    }, []);

    if (selectedTab === 'stats__tab') {
        return <></>;
    }

    return (
        <>
            <AlertDialog
                isOpen={isOpen}
                onClose={handleDialogClose}
                title={l10n.t('Confirm deletion')}
                content={l10n.t('Are you sure you want to delete selected item(s)? This action cannot be undone.')}
                confirmButtonText={l10n.t('Delete')}
                cancelButtonText={l10n.t('Cancel')}
            />
            <Toolbar size="small">
                {isEditMode && (
                    <>
                        <Tooltip content={l10n.t('Add new item in separate tab')} relationship="description" withArrow>
                            <ToolbarButton
                                aria-label={l10n.t('Add new item')}
                                icon={<AddFilled />}
                                onClick={() => void dispatcher.openDocument('add')}
                                style={{ visibility }}
                            />
                        </Tooltip>
                        <Tooltip
                            content={l10n.t('View selected item in separate tab')}
                            relationship="description"
                            withArrow
                        >
                            <ToolbarButton
                                aria-label={l10n.t('View selected item')}
                                icon={<EyeRegular />}
                                onClick={() => void dispatcher.openDocuments('view', getSelectedDocuments())}
                                disabled={!hasSelectedRows}
                                style={{ visibility }}
                            />
                        </Tooltip>
                        <Tooltip
                            content={l10n.t('Edit selected item in separate tab')}
                            relationship="description"
                            withArrow
                        >
                            <ToolbarButton
                                aria-label={l10n.t('Edit selected item')}
                                icon={<EditRegular />}
                                onClick={() => void dispatcher.openDocuments('edit', getSelectedDocuments())}
                                disabled={!hasSelectedRows}
                                style={{ visibility }}
                            />
                        </Tooltip>
                        <Tooltip content={l10n.t('Delete selected item')} relationship="description" withArrow>
                            <ToolbarButton
                                aria-label={l10n.t('Delete selected item')}
                                icon={<DeleteRegular />}
                                onClick={handleDeleteClick}
                                disabled={!hasSelectedRows}
                                style={{ visibility }}
                            />
                        </Tooltip>

                        <ToolbarDividerTransparent />
                    </>
                )}

                <Tooltip content={l10n.t('Change view mode')} relationship="description" withArrow>
                    <Dropdown
                        onOptionSelect={(_event, data) => onOptionSelect(data)}
                        style={{ minWidth: '100px', maxWidth: '100px' }}
                        // The value is always set "as is"
                        value={
                            state.tableViewMode === 'Tree'
                                ? l10n.t('Tree')
                                : state.tableViewMode === 'JSON'
                                  ? l10n.t('JSON')
                                  : l10n.t('Table')
                        }
                        defaultSelectedOptions={[state.tableViewMode]}
                        {...restoreFocusTargetAttribute}
                    >
                        <Option key="Tree" value="Tree">
                            {l10n.t('Tree')}
                        </Option>
                        <Option key="JSON" value="JSON">
                            {l10n.t('JSON')}
                        </Option>
                        <Option key="Table" value="Table">
                            {l10n.t('Table')}
                        </Option>
                    </Dropdown>
                </Tooltip>
            </Toolbar>
        </>
    );
};
