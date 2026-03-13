/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { isNil } from 'es-toolkit';
import { useCallback, useMemo, useReducer, useState } from 'react';
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
        flex: 1,
        minHeight: 0,
        '& .rdg': {
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
        display: 'inline-block',
        width: '32px',
        flexShrink: 0,
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

// Toggle expand/collapse and update rows
function toggleSubRow(rows: DisplayRow[], id: string): DisplayRow[] {
    const rowIndex = rows.findIndex((r) => r.id === id);
    const row = rows[rowIndex];
    if (!row.children) return rows;

    const newRows = rows.with(rowIndex, { ...row, isExpanded: !row.isExpanded });

    if (row.isExpanded) {
        // Collapse: remove all descendants
        let removeCount = 0;
        for (let i = rowIndex + 1; i < rows.length && rows[i].level > row.level; i++) {
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

export const ResultTabViewTree = ({ data }: ResultTabViewTreeProps) => {
    const styles = useStyles();
    const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => new Map());

    // Initialize with level 0 for root rows
    const initialRows = useMemo((): DisplayRow[] => data.map((row) => ({ ...row, level: 0 })), [data]);
    const [rows, dispatch] = useReducer((_rows: DisplayRow[], id: string) => toggleSubRow(_rows, id), initialRows);

    const handleToggle = useCallback((id: string) => dispatch(id), []);

    const columns = useMemo(
        (): readonly Column<DisplayRow>[] => [
            {
                key: 'field',
                name: l10n.t('Field'),
                resizable: true,
                renderHeaderCell: (props) => (
                    <ColumnHeaderCell {...props} columnWidths={columnWidths} onColumnWidthsChange={setColumnWidths} />
                ),
                renderCell: ({ row, tabIndex }) => (
                    <div className={styles.expandCell}>
                        {/* Indent spacers based on level */}
                        {Array.from({ length: row.level }).map((_, i) => (
                            <span key={i} className={styles.expandPlaceholder} />
                        ))}
                        {/* Expand button or placeholder */}
                        {row.children ? (
                            <button
                                className={styles.expandButton}
                                tabIndex={tabIndex}
                                onClick={() => handleToggle(row.id)}
                                aria-expanded={row.isExpanded}
                                aria-label={row.isExpanded ? l10n.t('Collapse') : l10n.t('Expand')}
                            >
                                {row.isExpanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
                            </button>
                        ) : (
                            <span className={styles.expandPlaceholder} />
                        )}
                        <span className={styles.fieldText}>{row.field}</span>
                    </div>
                ),
            },
            {
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
            },
            {
                key: 'type',
                name: l10n.t('Type'),
                resizable: true,
                renderHeaderCell: (props) => (
                    <ColumnHeaderCell {...props} columnWidths={columnWidths} onColumnWidthsChange={setColumnWidths} />
                ),
                renderCell: ({ row }) => toStringUniversal(row.type),
            },
        ],
        [columnWidths, styles, handleToggle],
    );

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
