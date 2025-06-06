/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type OptionOnSelectData } from '@fluentui/react-combobox';
import { Dropdown, Option, Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { AddFilled, DeleteRegular, EditRegular, EyeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo, useState } from 'react';
import { type CosmosDBRecordIdentifier } from '../../../../cosmosdb/types/queryResult';
import { AlertDialog } from '../../../common/AlertDialog';
import { CommandType, HotkeyScope, useCommandHotkey } from '../../../common/hotkeys';
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
    const [isOpen, setIsOpen] = useState(false);

    const isEditMode = useMemo<boolean>(() => {
        return state.isExecuting
            ? isSelectStar(state.querySelectedValue || state.queryValue || '')
            : isSelectStar(state.currentQueryResult?.query ?? '');
    }, [state.currentQueryResult, state.isExecuting, state.querySelectedValue, state.queryValue]);

    const visibility = state.isExecuting ? 'hidden' : 'visible';
    const hasSelectedRows = state.selectedRows.length > 0;
    const isEditDisabled = !isEditMode || !hasSelectedRows || state.isExecuting;

    const getSelectedDocuments = useCallback(() => {
        return state.selectedRows
            .map((rowIndex): CosmosDBRecordIdentifier | undefined => {
                const document = state.currentQueryResult?.documents[rowIndex];
                return document ? getDocumentId(document, state.partitionKey) : undefined;
            })
            .filter((document) => document !== undefined);
    }, [state]);

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

    const addNewItem = useCallback(() => dispatcher.openDocument('add'), [dispatcher]);
    const deleteSelectedItem = useCallback(() => setIsOpen(true), []);
    const viewSelectedItem = useCallback(
        () => dispatcher.openDocuments('view', getSelectedDocuments()),
        [dispatcher, getSelectedDocuments],
    );
    const editSelectedItem = useCallback(
        () => dispatcher.openDocuments('edit', getSelectedDocuments()),
        [dispatcher, getSelectedDocuments],
    );

    useCommandHotkey(HotkeyScope.ResultPanel, CommandType.NewItem, addNewItem);

    useCommandHotkey(HotkeyScope.ResultPanel, CommandType.ViewItem, viewSelectedItem, { disabled: isEditDisabled });

    useCommandHotkey(HotkeyScope.ResultPanel, CommandType.EditItem, editSelectedItem, { disabled: isEditDisabled });

    useCommandHotkey(HotkeyScope.ResultPanel, CommandType.DeleteItem, deleteSelectedItem, { disabled: isEditDisabled });

    if (selectedTab === 'stats__tab') {
        return <></>;
    }

    return (
        <>
            <AlertDialog
                isOpen={isOpen}
                onClose={handleDialogClose}
                title={l10n.t('Confirm deletion')}
                confirmButtonText={l10n.t('Delete')}
                cancelButtonText={l10n.t('Cancel')}
            >
                {l10n.t('Are you sure you want to delete selected item(s)? This action cannot be undone.')}
            </AlertDialog>
            <Toolbar size="small">
                {isEditMode && (
                    <>
                        <Tooltip content={l10n.t('Add new item in separate tab')} relationship="description" withArrow>
                            <ToolbarButton
                                aria-label={l10n.t('Add new item')}
                                icon={<AddFilled />}
                                onClick={() => void addNewItem()}
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
                                onClick={() => void viewSelectedItem()}
                                disabled={isEditDisabled}
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
                                onClick={() => void editSelectedItem()}
                                disabled={isEditDisabled}
                                style={{ visibility }}
                            />
                        </Tooltip>
                        <Tooltip content={l10n.t('Delete selected item')} relationship="description" withArrow>
                            <ToolbarButton
                                aria-label={l10n.t('Delete selected item')}
                                icon={<DeleteRegular />}
                                onClick={() => deleteSelectedItem()}
                                disabled={isEditDisabled}
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
