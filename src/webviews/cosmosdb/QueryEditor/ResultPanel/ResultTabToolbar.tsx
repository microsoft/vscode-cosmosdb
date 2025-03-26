/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type OptionOnSelectData } from '@fluentui/react-combobox';
import { Dropdown, Option, Toolbar, ToolbarButton, Tooltip, useRestoreFocusTarget } from '@fluentui/react-components';
import { AddFilled, DeleteRegular, EditRegular, EyeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useMemo } from 'react';
import { type CosmosRecordIdentifier } from '../../../../cosmosdb/types/queryResult';
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

    const isEditMode = useMemo<boolean>(() => {
        return state.isExecuting
            ? isSelectStar(state.querySelectedValue || state.queryValue || '')
            : isSelectStar(state.currentQueryResult?.query ?? '');
    }, [state.currentQueryResult, state.isExecuting]);

    const visibility = state.isExecuting ? 'hidden' : 'visible';
    const hasSelectedRows = state.selectedRows.length > 0;

    const getSelectedDocuments = () => {
        return state.selectedRows
            .map((rowIndex): CosmosRecordIdentifier | undefined => {
                const document = state.currentQueryResult?.documents[rowIndex];
                return document ? getDocumentId(document, state.partitionKey) : undefined;
            })
            .filter((document) => document !== undefined);
    };

    const onOptionSelect = (data: OptionOnSelectData) => {
        if (data.optionValue) dispatcher.setTableViewMode(data.optionValue as TableViewMode);
    };

    if (selectedTab === 'stats__tab') {
        return <></>;
    }

    return (
        <Toolbar aria-label={l10n.t('Result view toolbar')} size="small">
            {isEditMode && (
                <>
                    <Tooltip content={l10n.t('Add new document in separate tab')} relationship="description" withArrow>
                        <ToolbarButton
                            aria-label={l10n.t('Add new document')}
                            icon={<AddFilled />}
                            onClick={() => void dispatcher.openDocument('add')}
                            style={{ visibility }}
                        />
                    </Tooltip>
                    <Tooltip
                        content={l10n.t('View selected document in separate tab')}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton
                            aria-label={l10n.t('View selected document')}
                            icon={<EyeRegular />}
                            onClick={() => void dispatcher.openDocuments('view', getSelectedDocuments())}
                            disabled={!hasSelectedRows}
                            style={{ visibility }}
                        />
                    </Tooltip>
                    <Tooltip
                        content={l10n.t('Edit selected document in separate tab')}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton
                            aria-label={l10n.t('Edit selected document')}
                            icon={<EditRegular />}
                            onClick={() => void dispatcher.openDocuments('edit', getSelectedDocuments())}
                            disabled={!hasSelectedRows}
                            style={{ visibility }}
                        />
                    </Tooltip>
                    <Tooltip content={l10n.t('Delete selected document')} relationship="description" withArrow>
                        <ToolbarButton
                            aria-label={l10n.t('Delete selected document')}
                            icon={<DeleteRegular />}
                            onClick={() => void dispatcher.deleteDocuments(getSelectedDocuments())}
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
    );
};
