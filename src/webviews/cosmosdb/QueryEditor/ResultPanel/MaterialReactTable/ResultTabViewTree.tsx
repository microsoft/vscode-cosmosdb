/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import { AutoFixHigh, WidthFull } from '@mui/icons-material';
import { ListItemIcon, ListItemText, MenuItem, ThemeProvider } from '@mui/material';
import * as l10n from '@vscode/l10n';
import { MaterialReactTable, useMaterialReactTable, type MRT_ColumnDef, type MRT_Row } from 'material-react-table';
import { useCallback, useMemo, useState } from 'react';
import { useThemeState } from '../../../../theme/state/ThemeContext';
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
    emptyValue: { color: tokens.colorNeutralForeground4, fontStyle: 'italic' },
    fieldText: { fontWeight: 600 },
});

type ResultTabViewTreeProps = { data: TreeData[] };

interface TreeData {
    id: string;
    documentId?: unknown;
    parentId: string | null;
    field: string;
    value: string;
    type: string;
}

interface TreeRow {
    __id: string;
    __rawData: TreeData;
    field: string;
    value: string;
    type: string;
    subRows?: TreeRow[];
}

function buildNestedTreeData(data: TreeData[]): TreeRow[] {
    // Build a map of parentId -> children
    const childrenMap = new Map<string | null, TreeData[]>();
    for (const item of data) {
        const parentId = item.parentId;
        if (!childrenMap.has(parentId)) {
            childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)!.push(item);
    }

    // Recursively build nested structure
    function buildNode(item: TreeData): TreeRow {
        const children = childrenMap.get(item.id) || [];
        const subRows = children.length > 0 ? children.map(buildNode) : undefined;

        return {
            __id: item.id,
            __rawData: item,
            field: item.field,
            value: item.value,
            type: item.type,
            subRows,
        };
    }

    // Start with root items (parentId === null)
    const rootItems = childrenMap.get(null) || [];
    return rootItems.map(buildNode);
}

export const ResultTabViewTree = ({ data }: ResultTabViewTreeProps) => {
    const styles = useStyles();
    const { themeKind } = useThemeState();

    // Create MUI theme based on VS Code theme
    // Use both themeKind and fingerprint to detect actual theme changes (e.g., dark to different dark)
    const themeFingerprint = getVSCodeThemeFingerprint();
    const muiTheme = useMemo(() => createVSCodeMuiTheme(themeKind), [themeKind, themeFingerprint]);

    // Column resize dialog state
    const [resizeDialogOpen, setResizeDialogOpen] = useState(false);
    const [resizeColumnId, setResizeColumnId] = useState<string | null>(null);
    const [resizeColumnWidth, setResizeColumnWidth] = useState<number>(150);

    // Build nested tree data for MRT expanding
    const rows = useMemo((): TreeRow[] => buildNestedTreeData(data), [data]);

    const columns = useMemo(
        (): MRT_ColumnDef<TreeRow>[] => [
            {
                accessorKey: 'field',
                header: l10n.t('Field'),
                enableSorting: false,
                enableColumnFilter: false,
                Cell: ({ row }: { row: MRT_Row<TreeRow> }) => (
                    <span className={styles.fieldText}>{row.original.field}</span>
                ),
            },
            {
                accessorKey: 'value',
                header: l10n.t('Value'),
                enableSorting: false,
                enableColumnFilter: false,
                Cell: ({ row }: { row: MRT_Row<TreeRow> }) => {
                    const value = row.original.value;
                    if (!value || value === '{}' || value === '[]') {
                        return <span className={styles.emptyValue}>{value || ''}</span>;
                    }
                    return <>{value}</>;
                },
            },
            { accessorKey: 'type', header: l10n.t('Type'), enableSorting: false, enableColumnFilter: false },
        ],
        [styles],
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
        enableRowSelection: false,
        enableDensityToggle: false,
        enableColumnResizing: true,
        enableExpanding: true,
        // eslint-disable-next-line react/prop-types
        getSubRows: (row) => row.subRows,
        layoutMode: 'semantic',
        initialState: {
            density: 'compact',
        },
        // eslint-disable-next-line react/prop-types
        getRowId: (row) => row.__id,
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
            sx: {
                tableLayout: 'auto',
                width: 'auto',
            },
            'aria-label': l10n.t('Query results tree'),
        },
        muiTableBodyCellProps: {
            sx: {
                whiteSpace: 'nowrap',
            },
        },
        muiTableHeadCellProps: {
            sx: {
                whiteSpace: 'nowrap',
            },
        },
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
