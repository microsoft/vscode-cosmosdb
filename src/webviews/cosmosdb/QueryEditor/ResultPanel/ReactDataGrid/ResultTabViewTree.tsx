/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { isNil } from 'es-toolkit';
import { useMemo, useReducer, useState } from 'react';
import { DataGrid, type Column, type ColumnWidths } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { toStringUniversal, type TreeRow } from '../../../../utils';
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
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'hidden',
        '& .rdg': {
            flex: '1 1 auto',
            height: '100%',
            blockSize: '100%',
        },
    },
    emptyValue: {
        color: tokens.colorNeutralForeground4,
        fontStyle: 'italic',
    },
    expandCell: {
        display: 'flex',
        alignItems: 'center',
        height: '100%',
    },
    expandButton: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        height: '32px',
        cursor: 'pointer',
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        fontSize: '16px',
    },
    expandPlaceholder: {
        width: '32px',
    },
    fieldText: {
        fontWeight: 600,
    },
});

type ResultTabViewTreeProps = {
    data: TreeRow[];
};

// Display row with level for indentation
interface DisplayRow extends TreeRow {
    level: number;
}

type Action = { type: 'toggleSubRow'; id: string };

// Toggle expand/collapse
function toggleSubRow(rows: DisplayRow[], id: string): DisplayRow[] {
    const rowIndex = rows.findIndex((r) => r.id === id);
    const row = rows[rowIndex];
    if (!row.children) return rows;

    const newRows = rows.with(rowIndex, { ...row, isExpanded: !row.isExpanded });

    if (row.isExpanded) {
        // Collapse: remove all descendants
        let removeCount = 0;
        for (let i = rowIndex + 1; i < rows.length; i++) {
            if (rows[i].level <= row.level) break;
            removeCount++;
        }
        newRows.splice(rowIndex + 1, removeCount);
    } else {
        // Expand: insert children with level
        const childRows = row.children.map((child) => ({ ...child, level: row.level + 1 }));
        newRows.splice(rowIndex + 1, 0, ...childRows);
    }

    return newRows;
}

function reducer(rows: DisplayRow[], action: Action): DisplayRow[] {
    switch (action.type) {
        case 'toggleSubRow':
            return toggleSubRow(rows, action.id);
        default:
            return rows;
    }
}

// Expand button component
interface CellExpanderProps {
    tabIndex: number;
    expanded: boolean;
    onExpand: () => void;
    className: string;
}

function CellExpander({ tabIndex, expanded, onExpand, className }: CellExpanderProps) {
    return (
        <button
            className={className}
            tabIndex={tabIndex}
            onClick={onExpand}
            aria-expanded={expanded}
            aria-label={expanded ? l10n.t('Collapse') : l10n.t('Expand')}
        >
            {expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        </button>
    );
}

export const ResultTabViewTree = ({ data }: ResultTabViewTreeProps) => {
    const styles = useStyles();

    // Initialize with level 0 for root rows
    const initialRows = useMemo((): DisplayRow[] => data.map((row) => ({ ...row, level: 0 })), [data]);
    const [rows, dispatch] = useReducer(reducer, initialRows);
    const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => new Map());

    const columns = useMemo((): readonly Column<DisplayRow>[] => {
        const fieldColumn: Column<DisplayRow> = {
            key: 'field',
            name: l10n.t('Field'),
            resizable: true,
            renderHeaderCell: (props) => (
                <ColumnHeaderCell {...props} columnWidths={columnWidths} onColumnWidthsChange={setColumnWidths} />
            ),
            renderCell: ({ row, tabIndex }) => {
                const hasChildren = row.children !== undefined;
                return (
                    <div className={styles.expandCell} style={{ paddingLeft: `${row.level * 16}px` }}>
                        {hasChildren ? (
                            <CellExpander
                                tabIndex={tabIndex}
                                expanded={row.isExpanded === true}
                                onExpand={() => dispatch({ type: 'toggleSubRow', id: row.id })}
                                className={styles.expandButton}
                            />
                        ) : (
                            <span className={styles.expandPlaceholder} />
                        )}
                        <span className={styles.fieldText}>{row.field}</span>
                    </div>
                );
            },
        };

        const valueColumn: Column<DisplayRow> = {
            key: 'value',
            name: l10n.t('Value'),
            resizable: true,
            renderHeaderCell: (props) => (
                <ColumnHeaderCell {...props} columnWidths={columnWidths} onColumnWidthsChange={setColumnWidths} />
            ),
            renderCell: ({ row }) => {
                const className = isNil(row.value) || row.value === '{}' ? styles.emptyValue : undefined;
                return <span className={className}>{toStringUniversal(row.value)}</span>;
            },
        };

        const typeColumn: Column<DisplayRow> = {
            key: 'type',
            name: l10n.t('Type'),
            resizable: true,
            renderHeaderCell: (props) => (
                <ColumnHeaderCell {...props} columnWidths={columnWidths} onColumnWidthsChange={setColumnWidths} />
            ),
            renderCell: ({ row }) => toStringUniversal(row.type),
        };

        return [fieldColumn, valueColumn, typeColumn];
    }, [columnWidths, styles]);

    return (
        <div className={styles.wrapper}>
            <div className={styles.gridContainer}>
                <DataGrid
                    columns={columns}
                    rows={rows}
                    rowKeyGetter={(row) => row.id}
                    columnWidths={columnWidths}
                    onColumnWidthsChange={setColumnWidths}
                    aria-label={l10n.t('Query results tree')}
                    defaultColumnOptions={{ resizable: true, minWidth: 50 }}
                />
            </div>
        </div>
    );
};
