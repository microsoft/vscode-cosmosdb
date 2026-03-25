/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { isNil } from 'es-toolkit';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
    DataGrid,
    type CellKeyDownArgs,
    type CellKeyboardEvent,
    type CellMouseEvent,
    type Column,
    type ColumnWidths,
    type RenderHeaderCellProps,
} from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { type CosmosDBRecordIdentifier } from '../../../../../cosmosdb/types/queryResult';
import { toStringUniversal, type TableData, type TableRecord } from '../../../../../utils/convertors';
import { useQueryEditorDispatcher, useQueryEditorState } from '../../state/QueryEditorContext';
import { ColumnHeaderCell } from './ColumnHeaderMenu';
import './vscodeTheme.scss';

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

    // Anchor row for shift-click / shift-arrow range selection (does not trigger re-render)
    const anchorRowIdRef = useRef<number | null>(null);

    // Row key getter
    const rowKeyGetter = useCallback((row: GridRow) => row.__id, []);

    // Row field getter
    const rowFieldGetter = useCallback((row: GridRow, columnKey: string) => row.__rawData[columnKey], []);

    // Create columns from headers
    const columns = useMemo((): readonly Column<GridRow>[] => {
        return headers.map((header): Column<GridRow> => {
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
                    const field = header.startsWith('/') ? header.slice(1) : header;
                    const value = rowFieldGetter(row, field);
                    const className = isNil(value) || value === '{}' ? styles.emptyCell : undefined;

                    return <span className={className}>{toStringUniversal(value)}</span>;
                },
            };
        });
    }, [headers, columnWidths, rowFieldGetter, styles.emptyCell]);

    // Create rows from dataset without modifying original data
    const rows = useMemo((): readonly GridRow[] => {
        return dataset.map((row, index) => ({
            __id: index + 1, // Start IDs from 1
            __rawData: row,
        }));
    }, [dataset]);

    // Handle row double-click
    const handleCellDoubleClick = useCallback(
        (args: { row: GridRow }) => {
            if (!state.isEditMode) return;

            globalThis.getSelection()?.removeAllRanges();

            const documentId = rowFieldGetter(args.row, '__documentId') as CosmosDBRecordIdentifier | undefined;
            if (documentId) {
                void dispatcher.openDocument('view', documentId);
            }
        },
        [state.isEditMode, rowFieldGetter, dispatcher],
    );

    // Handle cell click for row selection (click / ctrl+click / shift+click)
    const handleCellClick = useCallback(
        (args: { row: GridRow }, event: CellMouseEvent) => {
            const rowId = args.row.__id;

            if (event.shiftKey && anchorRowIdRef.current !== null) {
                // Shift+click: select range from anchor to current row
                globalThis.getSelection()?.removeAllRanges();
                const anchorId = anchorRowIdRef.current;
                const startId = Math.min(anchorId, rowId);
                const endId = Math.max(anchorId, rowId);
                const rangeIds = new Set(rows.filter((r) => r.__id >= startId && r.__id <= endId).map((r) => r.__id));

                setSelectedRows(rangeIds);
                dispatcher.setSelectedRows(Array.from(rangeIds).map((id) => id - 1));
                // Anchor stays unchanged on shift+click
            } else if (event.ctrlKey || event.metaKey) {
                // Ctrl+click: toggle selection
                anchorRowIdRef.current = rowId;
                setSelectedRows((prevSelectedRows) => {
                    const newSelectedRows = new Set(prevSelectedRows);
                    if (newSelectedRows.has(rowId)) {
                        newSelectedRows.delete(rowId);
                    } else {
                        newSelectedRows.add(rowId);
                    }
                    dispatcher.setSelectedRows(Array.from(newSelectedRows).map((id) => id - 1));
                    return newSelectedRows;
                });
            } else {
                // Regular click: select only this row
                anchorRowIdRef.current = rowId;
                const newSelectedRows = new Set([rowId]);
                setSelectedRows(newSelectedRows);
                dispatcher.setSelectedRows([rowId - 1]);
            }
        },
        [dispatcher, rows],
    );

    // Handle keyboard selection: Space toggles current row, Shift+Arrow extends range
    const handleCellKeyDown = useCallback(
        (args: CellKeyDownArgs<GridRow>, event: CellKeyboardEvent) => {
            if (args.mode !== 'SELECT') return;

            const rowId = args.row.__id;
            const rowIdx = args.rowIdx;

            if (event.key === ' ') {
                // Prevent the grid's own space-key behaviour
                event.preventGridDefault();

                if (event.shiftKey && anchorRowIdRef.current !== null) {
                    // Shift+Space: range selection from anchor to focused row
                    globalThis.getSelection()?.removeAllRanges();
                    const anchorId = anchorRowIdRef.current;
                    const startId = Math.min(anchorId, rowId);
                    const endId = Math.max(anchorId, rowId);
                    const rangeIds = new Set(
                        rows.filter((r) => r.__id >= startId && r.__id <= endId).map((r) => r.__id),
                    );
                    setSelectedRows(rangeIds);
                    dispatcher.setSelectedRows(Array.from(rangeIds).map((id) => id - 1));
                } else {
                    // Space: toggle the focused row
                    anchorRowIdRef.current = rowId;
                    setSelectedRows((prev) => {
                        const next = new Set(prev);
                        if (next.has(rowId)) {
                            next.delete(rowId);
                        } else {
                            next.add(rowId);
                        }
                        dispatcher.setSelectedRows(Array.from(next).map((id) => id - 1));
                        return next;
                    });
                }
            } else if (event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                // Shift+Arrow: extend/shrink selection; let the grid move focus normally
                globalThis.getSelection()?.removeAllRanges();
                if (anchorRowIdRef.current === null) {
                    anchorRowIdRef.current = rowId;
                }
                const anchorId = anchorRowIdRef.current;

                const nextRowIdx =
                    event.key === 'ArrowDown' ? Math.min(rowIdx + 1, rows.length - 1) : Math.max(rowIdx - 1, 0);
                const nextRowId = rows[nextRowIdx]?.__id;

                if (nextRowId !== undefined) {
                    const startId = Math.min(anchorId, nextRowId);
                    const endId = Math.max(anchorId, nextRowId);
                    const rangeIds = new Set(
                        rows.filter((r) => r.__id >= startId && r.__id <= endId).map((r) => r.__id),
                    );
                    setSelectedRows(rangeIds);
                    dispatcher.setSelectedRows(Array.from(rangeIds).map((id) => id - 1));
                }
                // Do NOT call preventGridDefault() — let the grid move focus to the next row
            }
        },
        [dispatcher, rows],
    );

    // Handle selection change from grid (required for visual selection to work)
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
                    onCellClick={handleCellClick}
                    onCellDoubleClick={handleCellDoubleClick}
                    onCellKeyDown={handleCellKeyDown}
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
