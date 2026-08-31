/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Dropdown,
    Input,
    type InputOnChangeData,
    makeStyles,
    Option,
    type OptionOnSelectData,
    Table,
    TableBody,
    TableCell,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    tokens,
    Tooltip,
} from '@fluentui/react-components';
import { Code16Regular, Open16Regular } from '@fluentui/react-icons';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as l10n from '@vscode/l10n';
import { memo, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import {
    type ContainerMetrics,
    type HealthState,
    type InventoryContainerRow,
    type ThroughputMode,
    type UnavailableReason,
} from '../../api/types';
import { EmptyState } from './DashboardChrome';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    toolbar: {
        display: 'flex',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
        alignItems: 'center',
    },
    search: {
        minWidth: '220px',
        flexGrow: 1,
        maxWidth: '360px',
    },
    scrollArea: {
        overflowX: 'auto',
        overflowY: 'auto',
        maxWidth: '100%',
        maxHeight: '640px',
        position: 'relative',
    },
    stickyHeader: {
        position: 'sticky',
        top: 0,
        zIndex: 1,
        backgroundColor: 'var(--vscode-editor-background)',
    },
    spacerCell: {
        padding: 0,
        border: 0,
    },
    table: {
        minWidth: '1040px',
    },
    emptyState: {
        padding: tokens.spacingVerticalXL,
        textAlign: 'center',
        color: 'var(--vscode-descriptionForeground)',
    },
    monospace: {
        fontFamily: 'var(--vscode-editor-font-family)',
    },
    sparkline: {
        width: '96px',
        height: '24px',
        '& .recharts-surface:focus': {
            outline: 'none',
        },
        '& .recharts-wrapper:focus': {
            outline: 'none',
        },
    },
});

const THROUGHPUT_MODE_LABELS: Record<ThroughputMode, string> = {
    dedicated: l10n.t('Dedicated'),
    shared: l10n.t('Shared (database)'),
    autoscale: l10n.t('Autoscale'),
    serverless: l10n.t('Serverless'),
    unknown: l10n.t('Unknown'),
};

const HEALTH_BADGE: Record<HealthState, { color: 'success' | 'warning' | 'danger'; label: string }> = {
    Healthy: { color: 'success', label: l10n.t('Healthy') },
    'Needs Attention': { color: 'warning', label: l10n.t('Needs Attention') },
    Critical: { color: 'danger', label: l10n.t('Critical') },
};

const HEALTH_ORDER: Record<HealthState, number> = { Healthy: 0, 'Needs Attention': 1, Critical: 2 };

type SortKey =
    | 'containerId'
    | 'databaseId'
    | 'throughputMode'
    | 'throughputRU'
    | 'storageBytes'
    | 'documentCount'
    | 'peakRuPercent'
    | 'health';
type SortDirection = 'ascending' | 'descending';

function containerKey(row: InventoryContainerRow): string {
    return `${row.databaseId}/${row.containerId}`;
}

const SPARK_COLOR = 'var(--vscode-charts-blue, var(--vscode-textLink-foreground))';

/**
 * A tiny axis-less trend line for an inline table cell. Hidden when there is nothing to draw.
 * Purely decorative — the cell already shows the scalar value — so it is hidden from assistive tech.
 */
const Sparkline = memo(function Sparkline({ values }: { values?: number[] }) {
    const styles = useStyles();
    const data = useMemo(() => (values ?? []).map((value, index) => ({ index, value })), [values]);
    if (data.length < 2) {
        return null;
    }
    return (
        <div className={styles.sparkline} aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }} accessibilityLayer={false}>
                    <Line
                        type="monotone"
                        dataKey="value"
                        stroke={SPARK_COLOR}
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={false}
                        isAnimationActive={false}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
});

/** Formats a document count compactly (e.g. 1234 → "1.2K", 5_000_000 → "5M"). */
function formatCount(value: number): string {
    if (value < 1000) {
        return String(Math.round(value));
    }
    const units = ['K', 'M', 'B', 'T'];
    let scaled = value / 1000;
    let unitIndex = 0;
    while (scaled >= 1000 && unitIndex < units.length - 1) {
        scaled /= 1000;
        unitIndex++;
    }
    return `${Math.round(scaled * 10) / 10}${units[unitIndex]}`;
}

/** Formats a byte count compactly (e.g. 1610612736 → "1.5 GB"). */
function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return l10n.t('{value} B', { value: Math.round(bytes) });
    }
    const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    const rounded = Math.round(value * 10) / 10;
    switch (units[unitIndex]) {
        case 'KB':
            return l10n.t('{value} KB', { value: rounded });
        case 'MB':
            return l10n.t('{value} MB', { value: rounded });
        case 'GB':
            return l10n.t('{value} GB', { value: rounded });
        case 'TB':
            return l10n.t('{value} TB', { value: rounded });
        default:
            return l10n.t('{value} PB', { value: rounded });
    }
}

/** Formats a signed 7-day storage delta, e.g. "+120 MB" / "−4 MB" / "0 B". */
function formatGrowth(bytes: number): string {
    if (bytes === 0) {
        return l10n.t('No change');
    }
    const sign = bytes > 0 ? '+' : '−';
    return `${sign}${formatBytes(Math.abs(bytes))}`;
}

function rowHealth(row: InventoryContainerRow, metric: ContainerMetrics | undefined): HealthState {
    return metric?.health ?? row.health;
}

function formatRU(row: InventoryContainerRow): string {
    if (row.throughputMode === 'serverless') {
        return l10n.t('N/A');
    }
    if (row.throughputRU === undefined) {
        return l10n.t('Unknown');
    }
    return row.throughputMode === 'autoscale'
        ? l10n.t('{ru} RU/s (max)', { ru: row.throughputRU })
        : l10n.t('{ru} RU/s', { ru: row.throughputRU });
}

const REVEAL_ICON = <Open16Regular />;
const QUERY_ICON = <Code16Regular />;

const SortableHeaderCell = memo(function SortableHeaderCell({
    columnKey,
    activeSortKey,
    sortDirection,
    onSort,
    children,
}: {
    columnKey: SortKey;
    activeSortKey: SortKey;
    sortDirection: SortDirection;
    onSort: (key: SortKey) => void;
    children: ReactNode;
}) {
    const handleClick = useCallback(() => onSort(columnKey), [onSort, columnKey]);
    return (
        <TableHeaderCell sortDirection={activeSortKey === columnKey ? sortDirection : undefined} onClick={handleClick}>
            {children}
        </TableHeaderCell>
    );
});

const COLUMN_COUNT = 10;

const InventoryRow = memo(function InventoryRow({
    row,
    metric,
    dataIndex,
    measureRef,
    onRevealInTree,
    onOpenQueryEditor,
}: {
    row: InventoryContainerRow;
    metric: ContainerMetrics | undefined;
    dataIndex: number;
    measureRef: (node: HTMLTableRowElement | null) => void;
    onRevealInTree: (databaseId: string, containerId: string) => void;
    onOpenQueryEditor: (databaseId: string, containerId: string) => void;
}) {
    const styles = useStyles();
    const health = HEALTH_BADGE[rowHealth(row, metric)];

    const handleReveal = useCallback(
        () => onRevealInTree(row.databaseId, row.containerId),
        [onRevealInTree, row.databaseId, row.containerId],
    );
    const handleOpenQuery = useCallback(
        () => onOpenQueryEditor(row.databaseId, row.containerId),
        [onOpenQueryEditor, row.databaseId, row.containerId],
    );

    return (
        <TableRow ref={measureRef} data-index={dataIndex}>
            <TableCell>
                <TableCellLayout>{row.containerId}</TableCellLayout>
            </TableCell>
            <TableCell>{row.databaseId}</TableCell>
            <TableCell>
                <TableCellLayout description={formatRU(row)}>
                    {THROUGHPUT_MODE_LABELS[row.throughputMode]}
                </TableCellLayout>
            </TableCell>
            <TableCell>
                <Text className={styles.monospace}>{row.partitionKeyPaths.join(', ') || l10n.t('N/A')}</Text>
            </TableCell>
            <TableCell>
                {l10n.t('{mode} · {excluded} excluded · {composite} composite', {
                    mode: row.indexingMode,
                    excluded: row.excludedPathCount,
                    composite: row.compositeIndexCount,
                })}
            </TableCell>
            <TableCell>
                {metric?.storageBytes !== undefined && Number.isFinite(metric.storageBytes) ? (
                    <TableCellLayout
                        description={
                            metric.storageGrowthBytes !== undefined && Number.isFinite(metric.storageGrowthBytes)
                                ? l10n.t('{delta} / 7 days', {
                                      delta: formatGrowth(metric.storageGrowthBytes),
                                  })
                                : undefined
                        }
                    >
                        {formatBytes(metric.storageBytes)}
                        <Sparkline values={metric.storageSparkline} />
                    </TableCellLayout>
                ) : (
                    <Text className={styles.monospace}>{'—'}</Text>
                )}
            </TableCell>
            <TableCell>
                {metric?.documentCount !== undefined && Number.isFinite(metric.documentCount)
                    ? formatCount(metric.documentCount)
                    : '—'}
            </TableCell>
            <TableCell>
                {metric?.peakRuPercent !== undefined && Number.isFinite(metric.peakRuPercent) ? (
                    <TableCellLayout>
                        {`${Math.round(metric.peakRuPercent)}%`}
                        <Sparkline values={metric.ruSparkline} />
                    </TableCellLayout>
                ) : (
                    '—'
                )}
            </TableCell>
            <TableCell>
                <Badge appearance="tint" color={health.color}>
                    {health.label}
                </Badge>
            </TableCell>
            <TableCell>
                <Tooltip content={l10n.t('Reveal in tree')} relationship="description">
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={REVEAL_ICON}
                        aria-label={l10n.t('Reveal in tree')}
                        onClick={handleReveal}
                    />
                </Tooltip>
                <Tooltip content={l10n.t('Open Query Editor')} relationship="description">
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={QUERY_ICON}
                        aria-label={l10n.t('Open Query Editor')}
                        onClick={handleOpenQuery}
                    />
                </Tooltip>
            </TableCell>
        </TableRow>
    );
});

export const InventoryTable = ({
    rows,
    supported,
    available,
    reason,
    metrics,
    onRevealInTree,
    onOpenQueryEditor,
}: {
    rows: InventoryContainerRow[];
    supported: boolean;
    available: boolean;
    reason?: UnavailableReason;
    metrics?: Record<string, ContainerMetrics>;
    onRevealInTree: (databaseId: string, containerId: string) => void;
    onOpenQueryEditor: (databaseId: string, containerId: string) => void;
}) => {
    const styles = useStyles();
    const [search, setSearch] = useState('');
    const [databaseFilter, setDatabaseFilter] = useState<string>('all');
    const [throughputFilter, setThroughputFilter] = useState<string>('all');
    const [sortKey, setSortKey] = useState<SortKey>('containerId');
    const [sortDirection, setSortDirection] = useState<SortDirection>('ascending');

    const databases = useMemo(() => [...new Set(rows.map((r) => r.databaseId))].sort(), [rows]);

    const filteredRows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return rows.filter((row) => {
            if (databaseFilter !== 'all' && row.databaseId !== databaseFilter) {
                return false;
            }
            if (throughputFilter !== 'all' && row.throughputMode !== throughputFilter) {
                return false;
            }
            if (
                needle &&
                !row.containerId.toLowerCase().includes(needle) &&
                !row.databaseId.toLowerCase().includes(needle)
            ) {
                return false;
            }
            return true;
        });
    }, [rows, search, databaseFilter, throughputFilter]);

    const sortedRows = useMemo(() => {
        const factor = sortDirection === 'ascending' ? 1 : -1;
        const metricOf = (row: InventoryContainerRow) => metrics?.[containerKey(row)];
        return [...filteredRows].sort((a, b) => {
            switch (sortKey) {
                case 'throughputRU':
                    return factor * ((a.throughputRU ?? -1) - (b.throughputRU ?? -1));
                case 'storageBytes':
                    return factor * ((metricOf(a)?.storageBytes ?? -1) - (metricOf(b)?.storageBytes ?? -1));
                case 'documentCount':
                    return factor * ((metricOf(a)?.documentCount ?? -1) - (metricOf(b)?.documentCount ?? -1));
                case 'peakRuPercent':
                    return factor * ((metricOf(a)?.peakRuPercent ?? -1) - (metricOf(b)?.peakRuPercent ?? -1));
                case 'health':
                    return factor * (HEALTH_ORDER[rowHealth(a, metricOf(a))] - HEALTH_ORDER[rowHealth(b, metricOf(b))]);
                case 'containerId':
                case 'databaseId':
                case 'throughputMode':
                    return factor * String(a[sortKey]).localeCompare(String(b[sortKey]));
                default:
                    return 0;
            }
        });
    }, [filteredRows, sortKey, sortDirection, metrics]);

    const toggleSort = useCallback(
        (key: SortKey) => {
            if (sortKey === key) {
                setSortDirection((d) => (d === 'ascending' ? 'descending' : 'ascending'));
            } else {
                setSortKey(key);
                setSortDirection('ascending');
            }
        },
        [sortKey],
    );

    const databaseSelectedOptions = useMemo(() => [databaseFilter], [databaseFilter]);
    const throughputSelectedOptions = useMemo(() => [throughputFilter], [throughputFilter]);

    const handleSearchChange = useCallback((_event: unknown, data: InputOnChangeData) => setSearch(data.value), []);
    const handleDatabaseSelect = useCallback(
        (_event: unknown, data: OptionOnSelectData) => setDatabaseFilter(data.optionValue ?? 'all'),
        [],
    );
    const handleThroughputSelect = useCallback(
        (_event: unknown, data: OptionOnSelectData) => setThroughputFilter(data.optionValue ?? 'all'),
        [],
    );

    // Virtualize the row list so an account with thousands of collections renders only the visible
    // rows (each row mounts two recharts sparklines, so a full render would be prohibitively heavy).
    const scrollRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: sortedRows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 48,
        overscan: 12,
    });
    const virtualItems = rowVirtualizer.getVirtualItems();
    const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
    const paddingBottom =
        virtualItems.length > 0 ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;

    if (!available) {
        return <EmptyState reason={reason ?? 'noData'} requiredRole={l10n.t('Reader on the Cosmos DB account')} />;
    }

    if (!supported) {
        return (
            <Text className={styles.emptyState}>
                {l10n.t('Databases and containers inventory is only available for NoSQL (Core) API accounts.')}
            </Text>
        );
    }

    if (rows.length === 0) {
        return <Text className={styles.emptyState}>{l10n.t('This account has no databases or containers yet.')}</Text>;
    }

    return (
        <div className={styles.root}>
            <div className={styles.toolbar}>
                <Input
                    className={styles.search}
                    contentBefore={undefined}
                    placeholder={l10n.t('Search containers or databases…')}
                    value={search}
                    onChange={handleSearchChange}
                    aria-label={l10n.t('Search containers or databases')}
                />
                <Dropdown
                    aria-label={l10n.t('Filter by database')}
                    value={databaseFilter === 'all' ? l10n.t('All databases') : databaseFilter}
                    selectedOptions={databaseSelectedOptions}
                    onOptionSelect={handleDatabaseSelect}
                >
                    <Option value="all">{l10n.t('All databases')}</Option>
                    {databases.map((db) => (
                        <Option key={db} value={db}>
                            {db}
                        </Option>
                    ))}
                </Dropdown>
                <Dropdown
                    aria-label={l10n.t('Filter by throughput mode')}
                    value={
                        throughputFilter === 'all'
                            ? l10n.t('All throughput modes')
                            : THROUGHPUT_MODE_LABELS[throughputFilter as ThroughputMode]
                    }
                    selectedOptions={throughputSelectedOptions}
                    onOptionSelect={handleThroughputSelect}
                >
                    <Option value="all">{l10n.t('All throughput modes')}</Option>
                    {(Object.keys(THROUGHPUT_MODE_LABELS) as ThroughputMode[]).map((mode) => (
                        <Option key={mode} value={mode}>
                            {THROUGHPUT_MODE_LABELS[mode]}
                        </Option>
                    ))}
                </Dropdown>
            </div>

            {sortedRows.length === 0 ? (
                <Text className={styles.emptyState}>{l10n.t('No containers match the current filters.')}</Text>
            ) : (
                <div className={styles.scrollArea} ref={scrollRef}>
                    <Table className={styles.table} aria-label={l10n.t('Containers')}>
                        <TableHeader className={styles.stickyHeader}>
                            <TableRow>
                                <SortableHeaderCell
                                    columnKey="containerId"
                                    activeSortKey={sortKey}
                                    sortDirection={sortDirection}
                                    onSort={toggleSort}
                                >
                                    {l10n.t('Container')}
                                </SortableHeaderCell>
                                <SortableHeaderCell
                                    columnKey="databaseId"
                                    activeSortKey={sortKey}
                                    sortDirection={sortDirection}
                                    onSort={toggleSort}
                                >
                                    {l10n.t('Database')}
                                </SortableHeaderCell>
                                <SortableHeaderCell
                                    columnKey="throughputMode"
                                    activeSortKey={sortKey}
                                    sortDirection={sortDirection}
                                    onSort={toggleSort}
                                >
                                    {l10n.t('Throughput')}
                                </SortableHeaderCell>
                                <TableHeaderCell>{l10n.t('Partition key')}</TableHeaderCell>
                                <TableHeaderCell>{l10n.t('Indexing')}</TableHeaderCell>
                                <SortableHeaderCell
                                    columnKey="storageBytes"
                                    activeSortKey={sortKey}
                                    sortDirection={sortDirection}
                                    onSort={toggleSort}
                                >
                                    {l10n.t('Storage')}
                                </SortableHeaderCell>
                                <SortableHeaderCell
                                    columnKey="documentCount"
                                    activeSortKey={sortKey}
                                    sortDirection={sortDirection}
                                    onSort={toggleSort}
                                >
                                    {l10n.t('Documents')}
                                </SortableHeaderCell>
                                <SortableHeaderCell
                                    columnKey="peakRuPercent"
                                    activeSortKey={sortKey}
                                    sortDirection={sortDirection}
                                    onSort={toggleSort}
                                >
                                    {l10n.t('Peak RU')}
                                </SortableHeaderCell>
                                <SortableHeaderCell
                                    columnKey="health"
                                    activeSortKey={sortKey}
                                    sortDirection={sortDirection}
                                    onSort={toggleSort}
                                >
                                    {l10n.t('Health')}
                                </SortableHeaderCell>
                                <TableHeaderCell>{l10n.t('Actions')}</TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paddingTop > 0 && (
                                <tr aria-hidden="true">
                                    <td
                                        className={styles.spacerCell}
                                        colSpan={COLUMN_COUNT}
                                        style={{ height: paddingTop }}
                                    />
                                </tr>
                            )}
                            {virtualItems.map((virtualRow) => {
                                const row = sortedRows[virtualRow.index];
                                return (
                                    <InventoryRow
                                        key={`${row.databaseId}/${row.containerId}`}
                                        dataIndex={virtualRow.index}
                                        measureRef={rowVirtualizer.measureElement}
                                        row={row}
                                        metric={metrics?.[containerKey(row)]}
                                        onRevealInTree={onRevealInTree}
                                        onOpenQueryEditor={onOpenQueryEditor}
                                    />
                                );
                            })}
                            {paddingBottom > 0 && (
                                <tr aria-hidden="true">
                                    <td
                                        className={styles.spacerCell}
                                        colSpan={COLUMN_COUNT}
                                        style={{ height: paddingBottom }}
                                    />
                                </tr>
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
};
