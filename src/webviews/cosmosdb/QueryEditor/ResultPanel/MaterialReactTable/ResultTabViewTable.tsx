/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import { AutoFixHigh, WidthFull } from '@mui/icons-material';
import { ListItemIcon, ListItemText, MenuItem, ThemeProvider } from '@mui/material';
import * as l10n from '@vscode/l10n';
import {
    MaterialReactTable,
    useMaterialReactTable,
    type MRT_ColumnDef,
    type MRT_Row,
    type MRT_RowSelectionState,
} from 'material-react-table';
import { useCallback, useMemo, useState } from 'react';
import { type CosmosDBRecordIdentifier } from '../../../../../cosmosdb/types/queryResult';
import { toStringUniversal, type TableData, type TableRecord } from '../../../../../utils/convertors';
import { useThemeState } from '../../../../theme/state/ThemeContext';
import { useQueryEditorDispatcher, useQueryEditorState } from '../../state/QueryEditorContext';
import { ColumnResizeDialog } from '../ColumnResizeDialog';
import { createVSCodeMuiTheme, getVSCodeThemeFingerprint } from './muiTheme';

const useStyles = makeStyles({
    wrapper: {
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
    },
    gridContainer: {
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        '& > div': {
            height: '100%',
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

export const ResultTabViewTable = ({ headers, dataset }: ResultTabViewTableProps) => {
    const styles = useStyles();
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const { themeKind } = useThemeState();

    // Create MUI theme based on VS Code theme
    // Use both themeKind and fingerprint to detect actual theme changes (e.g., dark to different dark)
    const themeFingerprint = getVSCodeThemeFingerprint();
    const muiTheme = useMemo(() => createVSCodeMuiTheme(themeKind), [themeKind, themeFingerprint]);

    // Row selection state
    const [rowSelection, setRowSelection] = useState<MRT_RowSelectionState>({});

    // Column resize dialog state
    const [resizeDialogOpen, setResizeDialogOpen] = useState(false);
    const [resizeColumnId, setResizeColumnId] = useState<string | null>(null);
    const [resizeColumnWidth, setResizeColumnWidth] = useState<number>(150);

    // Create columns from headers
    const columns = useMemo((): MRT_ColumnDef<GridRow>[] => {
        return headers.map((header): MRT_ColumnDef<GridRow> => {
            const field = header.startsWith('/') ? header.slice(1) : header;

            return {
                id: header,
                accessorFn: (row) => row.__rawData[field],
                header: header,
                enableSorting: false,
                enableColumnFilter: false,
                Cell: ({ row }: { row: MRT_Row<GridRow> }) => {
                    const value = row.original.__rawData[field];
                    if (value === undefined || value === null || value === '{}') {
                        const displayValue = value === undefined ? 'undefined' : value === null ? 'null' : '{}';
                        return <span className={styles.emptyCell}>{displayValue}</span>;
                    }
                    return <>{toStringUniversal(value)}</>;
                },
            };
        });
    }, [headers, styles.emptyCell]);

    // Create rows from dataset without modifying original data
    const rows = useMemo((): GridRow[] => {
        return dataset.map((row, index) => ({
            __id: index + 1,
            __rawData: row,
        }));
    }, [dataset]);

    // Handle selection change
    const handleRowSelectionChange = useCallback(
        (updater: MRT_RowSelectionState | ((old: MRT_RowSelectionState) => MRT_RowSelectionState)) => {
            const newSelection = typeof updater === 'function' ? updater(rowSelection) : updater;
            setRowSelection(newSelection);

            // Convert selection to row indexes (0-based)
            const selectedIndexes = Object.keys(newSelection)
                .filter((key) => newSelection[key])
                .map((key) => parseInt(key, 10));

            dispatcher.setSelectedRows(selectedIndexes);
        },
        [dispatcher, rowSelection],
    );

    // Handle row double-click
    const handleRowDoubleClick = useCallback(
        (rowIndex: number) => {
            if (!state.isEditMode) return;

            const row = rows[rowIndex];
            if (!row) return;

            const documentId = row.__rawData.__documentId as CosmosDBRecordIdentifier | undefined;
            if (documentId) {
                void dispatcher.openDocument('view', documentId);
            }
        },
        [state.isEditMode, dispatcher, rows],
    );

    const table = useMaterialReactTable({
        columns,
        data: rows,
        enableColumnActions: true,
        enableColumnFilters: false,
        enablePagination: false,
        enableSorting: false,
        enableTopToolbar: false,
        enableBottomToolbar: false,
        enableRowSelection: true,
        enableMultiRowSelection: true,
        enableSelectAll: true,
        enableDensityToggle: false,
        enableColumnResizing: true,
        layoutMode: 'semantic',
        initialState: {
            density: 'compact',
        },
        getRowId: (row) => String(row.__id - 1),
        onRowSelectionChange: handleRowSelectionChange,
        state: {
            rowSelection,
        },
        // Custom column actions menu with only two options
        renderColumnActionsMenuItems: ({ column, closeMenu }) => [
            <MenuItem
                key="resize-by-content"
                onClick={() => {
                    // Remove column from sizing to let browser auto-size based on content
                    table.setColumnSizing((prev) => {
                        const newSizing = { ...prev };
                        delete newSizing[column.id];
                        return newSizing;
                    });
                    closeMenu();
                }}
            >
                <ListItemIcon>
                    <AutoFixHigh fontSize="small" />
                </ListItemIcon>
                <ListItemText>{l10n.t('Resize by Content')}</ListItemText>
            </MenuItem>,
            <MenuItem
                key="resize"
                onClick={() => {
                    setResizeColumnId(column.id);
                    setResizeColumnWidth(column.getSize());
                    setResizeDialogOpen(true);
                    closeMenu();
                }}
            >
                <ListItemIcon>
                    <WidthFull fontSize="small" />
                </ListItemIcon>
                <ListItemText>{l10n.t('Resize')}</ListItemText>
            </MenuItem>,
        ],
        muiTableContainerProps: {
            sx: {
                maxHeight: '100%',
            },
        },
        muiTableProps: {
            'aria-label': l10n.t('Query results table'),
        },
        muiTableBodyRowProps: ({ row }) => ({
            onDoubleClick: () => handleRowDoubleClick(row.index),
        }),
    });

    // Handle dialog apply
    const handleApplyResize = useCallback(
        (newWidth: number) => {
            if (resizeColumnId) {
                table.setColumnSizing((prev) => ({
                    ...prev,
                    [resizeColumnId]: newWidth,
                }));
            }
            setResizeDialogOpen(false);
            setResizeColumnId(null);
        },
        [resizeColumnId, table],
    );

    return (
        <ThemeProvider theme={muiTheme}>
            <div className={styles.wrapper}>
                <div className={styles.gridContainer}>
                    <MaterialReactTable table={table} />
                </div>
                <ColumnResizeDialog
                    isOpen={resizeDialogOpen}
                    defaultWidth={resizeColumnWidth}
                    onClose={() => {
                        setResizeDialogOpen(false);
                        setResizeColumnId(null);
                    }}
                    onApply={handleApplyResize}
                />
            </div>
        </ThemeProvider>
    );
};
