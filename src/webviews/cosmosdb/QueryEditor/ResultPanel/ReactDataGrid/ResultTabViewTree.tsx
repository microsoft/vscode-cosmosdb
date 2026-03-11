/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo, useState } from 'react';
import {
    DataGrid,
    type Column,
    type ColumnWidths,
    type RenderCellProps,
    type RenderHeaderCellProps,
} from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { useThemeState } from '../../../../theme/state/ThemeContext';
import { ColumnHeaderCell } from './ColumnHeaderMenu';

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
    treeCell: {
        display: 'flex',
        alignItems: 'center',
        height: '100%',
        cursor: 'pointer',
    },
    toggleIcon: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        marginRight: '4px',
        flexShrink: 0,
    },
    togglePlaceholder: {
        width: '16px',
        height: '16px',
        marginRight: '4px',
        flexShrink: 0,
    },
    fieldText: {
        fontWeight: 600,
    },
});

type ResultTabViewTreeProps = {
    data: TreeData[];
};

// Input data type from SlickGrid format (flat with parentId)
interface TreeData {
    id: string;
    documentId?: unknown;
    parentId: string | null;
    field: string;
    value: string;
    type: string;
}

interface TreeRow {
    __id: number;
    __originalId: string;
    __rawData: TreeData;
    __parentId: string | null;
    __level: number;
    __hasChildren: boolean;
    __isExpanded: boolean;
    field: string;
    value: string;
    type: string;
}

// Build a map of children for each node
function buildChildrenMap(data: TreeData[]): Map<string | null, TreeData[]> {
    const childrenMap = new Map<string | null, TreeData[]>();
    for (const item of data) {
        const parentId = item.parentId;
        if (!childrenMap.has(parentId)) {
            childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)!.push(item);
    }
    return childrenMap;
}

// Flatten tree data for display, respecting expanded/collapsed state
function flattenTreeData(childrenMap: Map<string | null, TreeData[]>, expandedIds: Set<string>): TreeRow[] {
    const result: TreeRow[] = [];
    let idCounter = 1;

    function traverse(parentId: string | null, level: number) {
        const children = childrenMap.get(parentId) || [];
        for (const item of children) {
            const hasChildren = childrenMap.has(item.id) && (childrenMap.get(item.id)?.length ?? 0) > 0;
            const isExpanded = expandedIds.has(item.id);

            result.push({
                __id: idCounter++,
                __originalId: item.id,
                __rawData: item,
                __parentId: item.parentId,
                __level: level,
                __hasChildren: hasChildren,
                __isExpanded: isExpanded,
                field: item.field,
                value: item.value,
                type: item.type,
            });

            // Only traverse children if expanded
            if (hasChildren && isExpanded) {
                traverse(item.id, level + 1);
            }
        }
    }

    // Start traversal from root nodes (parentId === null)
    traverse(null, 0);
    return result;
}

// Header renderer props type with column widths
type HeaderRendererProps = RenderHeaderCellProps<TreeRow> & {
    columnWidths: ColumnWidths;
    onColumnWidthsChange: (columnWidths: ColumnWidths) => void;
    columnKey: string;
    columnName: string;
};

// Reusable header renderer component
function TreeHeaderRenderer({
    column,
    columnWidths,
    onColumnWidthsChange,
    columnKey,
    columnName,
    ...props
}: HeaderRendererProps) {
    return (
        <ColumnHeaderCell
            {...props}
            column={{ ...column, key: columnKey, name: columnName }}
            columnWidths={columnWidths}
            onColumnWidthsChange={onColumnWidthsChange}
        />
    );
}

export const ResultTabViewTree = ({ data }: ResultTabViewTreeProps) => {
    const styles = useStyles();
    const { themeKind } = useThemeState();

    // Column widths state
    const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => new Map());

    // Expanded node IDs
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

    // Determine theme class based on VS Code theme
    const isDarkTheme = themeKind === 'vscode-dark' || themeKind === 'vscode-high-contrast';
    const themeClass = isDarkTheme ? 'rdg-dark' : 'rdg-light';

    // Build children map once
    const childrenMap = useMemo(() => buildChildrenMap(data), [data]);

    // Convert flat data to tree rows with proper flattening
    const rows = useMemo((): readonly TreeRow[] => {
        return flattenTreeData(childrenMap, expandedIds);
    }, [childrenMap, expandedIds]);

    // Toggle expand/collapse handler
    const toggleExpand = useCallback((originalId: string) => {
        setExpandedIds((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(originalId)) {
                newSet.delete(originalId);
            } else {
                newSet.add(originalId);
            }
            return newSet;
        });
    }, []);

    // Tree cell renderer component
    const TreeCellRenderer = useCallback(
        ({ row }: RenderCellProps<TreeRow>) => {
            const indentWidth = row.__level * 16;

            return (
                <div
                    className={styles.treeCell}
                    style={{ paddingLeft: `${indentWidth}px` }}
                    onClick={() => {
                        if (row.__hasChildren) {
                            toggleExpand(row.__originalId);
                        }
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (row.__hasChildren && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            toggleExpand(row.__originalId);
                        }
                    }}
                    aria-expanded={row.__hasChildren ? row.__isExpanded : undefined}
                    aria-label={
                        row.__hasChildren
                            ? l10n.t('{field}, {state}', {
                                  field: row.field,
                                  state: row.__isExpanded ? 'expanded' : 'collapsed',
                              })
                            : row.field
                    }
                >
                    {row.__hasChildren ? (
                        <span className={styles.toggleIcon}>
                            {row.__isExpanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
                        </span>
                    ) : (
                        <span className={styles.togglePlaceholder} />
                    )}
                    <span className={styles.fieldText}>{row.field}</span>
                </div>
            );
        },
        [styles, toggleExpand],
    );

    // Define columns
    const columns = useMemo((): readonly Column<TreeRow>[] => {
        return [
            {
                key: 'field',
                name: l10n.t('Field'),
                resizable: true,
                sortable: false,
                renderHeaderCell: (props: RenderHeaderCellProps<TreeRow>) => (
                    <TreeHeaderRenderer
                        {...props}
                        columnWidths={columnWidths}
                        onColumnWidthsChange={setColumnWidths}
                        columnKey="field"
                        columnName={l10n.t('Field')}
                    />
                ),
                renderCell: TreeCellRenderer,
            },
            {
                key: 'value',
                name: l10n.t('Value'),
                resizable: true,
                sortable: false,
                renderHeaderCell: (props: RenderHeaderCellProps<TreeRow>) => (
                    <TreeHeaderRenderer
                        {...props}
                        columnWidths={columnWidths}
                        onColumnWidthsChange={setColumnWidths}
                        columnKey="value"
                        columnName={l10n.t('Value')}
                    />
                ),
                renderCell: ({ row }) => {
                    const value = row.value;
                    if (!value || value === '{}' || value === '[]') {
                        return <span className={styles.emptyValue}>{value || ''}</span>;
                    }
                    return <>{value}</>;
                },
            },
            {
                key: 'type',
                name: l10n.t('Type'),
                resizable: true,
                sortable: false,
                renderHeaderCell: (props: RenderHeaderCellProps<TreeRow>) => (
                    <TreeHeaderRenderer
                        {...props}
                        columnWidths={columnWidths}
                        onColumnWidthsChange={setColumnWidths}
                        columnKey="type"
                        columnName={l10n.t('Type')}
                    />
                ),
            },
        ];
    }, [columnWidths, styles.emptyValue, TreeCellRenderer]);

    // Row key getter
    const rowKeyGetter = useCallback((row: TreeRow) => row.__id, []);

    return (
        <div className={styles.wrapper}>
            <div className={styles.gridContainer}>
                <DataGrid
                    columns={columns}
                    rows={rows}
                    rowKeyGetter={rowKeyGetter}
                    columnWidths={columnWidths}
                    onColumnWidthsChange={setColumnWidths}
                    className={themeClass}
                    aria-label={l10n.t('Query results tree')}
                    defaultColumnOptions={{
                        resizable: true,
                        minWidth: 50,
                    }}
                />
            </div>
        </div>
    );
};
