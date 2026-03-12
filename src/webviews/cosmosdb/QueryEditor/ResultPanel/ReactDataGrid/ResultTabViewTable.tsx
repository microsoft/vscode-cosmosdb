/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo, useState } from 'react';
import { DataGrid, SelectColumn, type Column, type ColumnWidths, type RenderHeaderCellProps } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { type CosmosDBRecordIdentifier } from '../../../../../cosmosdb/types/queryResult';
import { toStringUniversal, type TableData, type TableRecord } from '../../../../../utils/convertors';
import { useQueryEditorDispatcher, useQueryEditorState } from '../../state/QueryEditorContext';
import { ColumnHeaderCell } from './ColumnHeaderMenu';
import './vscodeTheme.css';

const useStyles = makeStyles({
    wrapper: {
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
    },
    gridContainer: {
        flex: 1,
        minHeight: 0,
        '& .rdg': {
            height: '100%',
            blockSize: '100%',
        },
    },
    emptyCell: {
        color: tokens.colorNeutralForeground4,
        fontStyle: 'italic',
    },
});

type ResultTabViewTableProps = TableData & {};

interface GridRow {
    __id: number;
    __rawData: TableRecord;
    [key: string]: unknown;
}

// Outer component that provides the registry
export const ResultTabViewTable = ({ headers, dataset }: ResultTabViewTableProps) => {
    const styles = useStyles();
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    // Column widths state
    const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => new Map());


    // Selected rows state
    const [selectedRows, setSelectedRows] = useState<ReadonlySet<number>>(() => new Set());

    // Create columns from headers
    const columns = useMemo((): readonly Column<GridRow>[] => {
        const dataColumns = headers.map((header): Column<GridRow> => {
            const field = header.startsWith('/') ? header.slice(1) : header;

            return {
                key: header,
                name: header,
                resizable: true,
                sortable: false,
                draggable: false,
                renderHeaderCell: (props: RenderHeaderCellProps<GridRow>) => (
                    <ColumnHeaderCell {...props} columnWidths={columnWidths} onColumnWidthsChange={setColumnWidths} />
                ),
                renderCell: ({ row }) => {
                    const value = row.__rawData[field];
                    if (value === undefined || value === null || value === '{}') {
                        const displayValue = value === undefined ? 'undefined' : value === null ? 'null' : '{}';
                        return <span className={styles.emptyCell}>{displayValue}</span>;
                    }
                    return <>{toStringUniversal(value)}</>;
                },
            };
        });

        // Add SelectColumn at the beginning for row selection
        return [SelectColumn, ...dataColumns];
    }, [headers, columnWidths, styles.emptyCell]);

    // Create rows from dataset without modifying original data
    const rows = useMemo((): readonly GridRow[] => {
        return dataset.map((row, index) => ({
            __id: index + 1, // Start IDs from 1
            __rawData: row,
        }));
    }, [dataset]);

    // Row key getter
    const rowKeyGetter = useCallback((row: GridRow) => row.__id, []);

    // Handle row double-click
    const handleCellDoubleClick = useCallback(
        (args: { row: GridRow }) => {
            if (!state.isEditMode) return;

            globalThis.getSelection()?.removeAllRanges();

            const documentId = args.row.__rawData.__documentId as CosmosDBRecordIdentifier | undefined;
            if (documentId) {
                void dispatcher.openDocument('view', documentId);
            }
        },
        [state.isEditMode, dispatcher],
    );

    // Handle selection change
    const handleSelectedRowsChange = useCallback(
        (newSelectedRows: Set<number>) => {
            setSelectedRows(newSelectedRows);
            // Convert to 0-based indexes
            dispatcher.setSelectedRows(Array.from(newSelectedRows).map((id) => id - 1));
        },
        [dispatcher],
    );

    return (
        <div className={styles.wrapper}>
            <div className={styles.gridContainer}>
                <DataGrid
                    columns={columns}
                    rows={rows}
                    rowKeyGetter={rowKeyGetter}
                    selectedRows={selectedRows}
                    onSelectedRowsChange={handleSelectedRowsChange}
                    onCellDoubleClick={handleCellDoubleClick}
                    columnWidths={columnWidths}
                    onColumnWidthsChange={setColumnWidths}
                    aria-label={l10n.t('Query results table')}
                    defaultColumnOptions={{
                        resizable: true,
                        minWidth: 50,
                    }}
                />
            </div>
        </div>
    );
};
