/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
import { Grid, type IApi, type IColumnConfig, type IRow, Willow, WillowDark } from '@svar-ui/react-grid';
import '@svar-ui/react-grid/all.css';
import { useCallback, useMemo, useRef } from 'react';
import { type CosmosDBRecordIdentifier } from '../../../../../cosmosdb/types/queryResult';
import { type TableData, type TableRecord, toStringUniversal } from '../../../../../utils/convertors';
import { useThemeState } from '../../../../theme/state/ThemeContext';
import { useQueryEditorDispatcher, useQueryEditorState } from '../../state/QueryEditorContext';
import { ColumnHeaderCell } from './ColumnHeaderMenu';

const useStyles = makeStyles({
    wrapper: {
        height: '100%',
        width: '100%',
        '& .wx-willow-theme, & .wx-willow-dark-theme': {
            height: '100%',
        },
    },
    container: {
        height: '100%',
        width: '100%',
        '& .wx-table-box': {
            boxSizing: 'border-box',
        },
    },
});

type ResultTabViewTableProps = TableData & {};

interface GridDataItem extends IRow {
    id: number;
    __rawData: TableRecord; // Original data reference
}

export const ResultTabViewTable = ({ headers, dataset }: ResultTabViewTableProps) => {
    const styles = useStyles();
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const { themeKind } = useThemeState();
    const apiRef = useRef<IApi | null>(null);

    // Determine SVAR theme based on VS Code theme
    const isDarkTheme = themeKind === 'vscode-dark' || themeKind === 'vscode-high-contrast';
    const ThemeWrapper = isDarkTheme ? WillowDark : Willow;

    // Convert headers to SVAR column config
    const gridColumns = useMemo((): IColumnConfig[] => {
        return headers.map((header) => {
            const field = header.startsWith('/') ? header.slice(1) : header;
            const columnId = header + '_id';
            return {
                id: columnId,
                header: {
                    text: header,
                    cell: ColumnHeaderCell,
                },
                resize: true,
                sort: false,
                flexgrow: 1,
                width: 150,
                template: (value: unknown) => {
                    if (value === undefined || value === null || value === '{}') {
                        const displayValue = value === undefined ? 'undefined' : value === null ? 'null' : '{}';
                        return `<span style="color: #6e6e6e; font-style: italic;">${displayValue}</span>`;
                    }
                    return toStringUniversal(value);
                },
                getter: (obj: GridDataItem) => {
                    const value = obj.__rawData[field];
                    return toStringUniversal(value);
                },
            };
        });
    }, [headers]);

    // Convert dataset to SVAR data format with __rawData reference
    const gridData = useMemo(
        (): GridDataItem[] =>
            dataset.map((row, index) => ({
                id: index + 1, // Start IDs from 1
                __rawData: row,
            })),
        [dataset],
    );

    // Handle grid initialization
    const handleInit = useCallback(
        (api: IApi) => {
            apiRef.current = api;

            // Handle row double-click for opening documents
            api.intercept('open-editor', ({ id }) => {
                // If not in edit mode, do nothing
                if (!state.isEditMode) return false;

                // Clear the selection in the browser
                globalThis.getSelection()?.removeAllRanges();

                // Find the row and open document in view mode
                const rowData = api.getRow(id) as GridDataItem | undefined;
                const documentId = rowData?.__rawData.__documentId as CosmosDBRecordIdentifier | undefined;
                if (documentId) {
                    void dispatcher.openDocument('view', documentId);
                }

                return false;
            });

            api.on('select-row', () => {
                const selectedRows = api.getState().selectedRows ?? [];
                dispatcher.setSelectedRows(selectedRows.map((id) => Number(id) - 1)); // Convert back to 0-based index
            });

            return () => {
                api?.detach('select-row');
                api?.detach('open-editor');
            };
        },
        [dispatcher, state.isEditMode],
    );

    return (
        <div className={styles.wrapper}>
            <ThemeWrapper>
                <div className={styles.container}>
                    <Grid
                        columns={gridColumns}
                        data={gridData}
                        select={true}
                        multiselect={true}
                        reorder={false}
                        autoConfig={false}
                        header={true}
                        init={handleInit}
                    />
                </div>
            </ThemeWrapper>
        </div>
    );
};
