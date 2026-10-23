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
    useAnnounce,
} from '@fluentui/react-components';
import { Code16Regular, Open16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { memo, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { summarizeStorage } from '../../../panels/accountOverview/metrics/storage';
import { rowHealth } from '../../../panels/accountOverview/overviewHealthModel';
import {
    type ContainerMetrics,
    type HealthState,
    type InventoryContainerRow,
    type MetricApplicability,
    type StorageMeasurement,
    type ThroughputMode,
    type UnavailableReason,
} from '../../api/types';
import { EmptyState } from './DashboardChrome';
import { type ContainerRef, storageDescription } from './metrics/descriptors';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        minWidth: 0,
        ':focus-visible': {
            outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
        },
    },
    toolbar: {
        display: 'flex',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
        alignItems: 'center',
    },
    search: {
        minWidth: 0,
        width: '220px',
        flexGrow: 1,
        maxWidth: '360px',
    },
    filter: {
        minWidth: 0,
        maxWidth: '100%',
    },
    scrollArea: {
        overflowX: 'auto',
        overflowY: 'auto',
        maxWidth: '100%',
        position: 'relative',
    },
    stickyHeader: {
        position: 'sticky',
        top: 0,
        zIndex: 1,
        backgroundColor: tokens.colorNeutralBackground1,
    },
    table: {
        minWidth: '1040px',
    },
    emptyState: {
        padding: tokens.spacingVerticalXL,
        textAlign: 'center',
        color: tokens.colorNeutralForeground2,
    },
    monospace: {
        fontFamily: tokens.fontFamilyMonospace,
    },
    metricExplanation: {
        ':focus-visible': {
            outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: tokens.strokeWidthThin,
        },
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

const HEALTH_BADGE: Record<
    HealthState | 'Unknown',
    { color: 'success' | 'warning' | 'danger' | 'subtle'; label: string }
> = {
    Unknown: { color: 'subtle', label: l10n.t('Unknown') },
    Healthy: { color: 'success', label: l10n.t('Healthy') },
    'Needs Attention': { color: 'warning', label: l10n.t('Needs Attention') },
    Critical: { color: 'danger', label: l10n.t('Critical') },
};

const HEALTH_ORDER: Record<HealthState | 'Unknown', number> = {
    Unknown: -1,
    Healthy: 0,
    'Needs Attention': 1,
    Critical: 2,
};

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
        <TableHeaderCell
            sortable
            sortDirection={activeSortKey === columnKey ? sortDirection : undefined}
            onClick={handleClick}
        >
            {children}
        </TableHeaderCell>
    );
});

const InventoryRow = memo(function InventoryRow({
    row,
    metric,
    storageFallback,
    normalizedRuApplicability,
    dataIndex,
    onRevealInTree,
    onOpenQueryEditor,
    selected,
    onSelectContainer,
}: {
    row: InventoryContainerRow;
    metric: ContainerMetrics | undefined;
    storageFallback?: StorageMeasurement;
    normalizedRuApplicability?: MetricApplicability;
    dataIndex: number;
    onRevealInTree: (databaseId: string, containerId: string) => void;
    onOpenQueryEditor: (databaseId: string, containerId: string) => void;
    selected?: boolean;
    onSelectContainer?: (container: ContainerRef) => void;
}) {
    const styles = useStyles();
    const storage = metric?.storage ?? storageFallback;
    const storageSummary = storage ? summarizeStorage(storage) : undefined;
    const health = HEALTH_BADGE[rowHealth(row, metric, normalizedRuApplicability)];
    const showProvisionedMetrics = normalizedRuApplicability?.status !== 'notApplicable';
    const resourceDescription = l10n.t('Container {container} in database {database}', {
        container: row.containerId,
        database: row.databaseId,
    });

    const handleReveal = useCallback(
        () => onRevealInTree(row.databaseId, row.containerId),
        [onRevealInTree, row.databaseId, row.containerId],
    );
    const handleOpenQuery = useCallback(
        () => onOpenQueryEditor(row.databaseId, row.containerId),
        [onOpenQueryEditor, row.databaseId, row.containerId],
    );

    return (
        <TableRow aria-rowindex={dataIndex + 2}>
            <TableCell>
                <TableCellLayout>
                    {onSelectContainer ? (
                        <Button
                            appearance={selected ? 'primary' : 'subtle'}
                            size="small"
                            aria-pressed={selected}
                            aria-label={l10n.t('{container}: show partition health in {database}', {
                                container: row.containerId,
                                database: row.databaseId,
                            })}
                            onClick={() =>
                                onSelectContainer({ databaseId: row.databaseId, containerId: row.containerId })
                            }
                        >
                            <span aria-hidden="true">{row.containerId}</span>
                        </Button>
                    ) : (
                        row.containerId
                    )}
                </TableCellLayout>
            </TableCell>
            <TableCell>{row.databaseId}</TableCell>
            {showProvisionedMetrics && (
                <TableCell>
                    <TableCellLayout description={formatRU(row)}>
                        {THROUGHPUT_MODE_LABELS[row.throughputMode]}
                    </TableCellLayout>
                </TableCell>
            )}
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
                {storage ? (
                    <TableCellLayout
                        description={
                            metric?.storageGrowthBytes !== undefined && Number.isFinite(metric.storageGrowthBytes)
                                ? l10n.t('Data growth: {delta} / 7 days', {
                                      delta: formatGrowth(metric.storageGrowthBytes),
                                  })
                                : undefined
                        }
                    >
                        <Tooltip content={storageDescription(storage)} relationship="description">
                            <Text tabIndex={0} className={styles.metricExplanation}>
                                {storageSummary?.bytes !== undefined ? formatBytes(storageSummary.bytes) : '—'}
                                {storageSummary?.status === 'partial' && <> · {l10n.t('Partial data')}</>}
                            </Text>
                        </Tooltip>
                        <Sparkline values={metric?.storageSparkline} />
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
            {showProvisionedMetrics && (
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
            )}
            <TableCell>
                <Badge appearance="tint" color={health.color}>
                    {health.label}
                </Badge>
            </TableCell>
            <TableCell>
                <Tooltip content={l10n.t('Reveal in tree')} relationship="label">
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={REVEAL_ICON}
                        aria-label={l10n.t('Reveal in tree')}
                        aria-description={resourceDescription}
                        onClick={handleReveal}
                    />
                </Tooltip>
                <Tooltip content={l10n.t('Open Query Editor')} relationship="label">
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={QUERY_ICON}
                        aria-label={l10n.t('Open Query Editor')}
                        aria-description={resourceDescription}
                        onClick={handleOpenQuery}
                    />
                </Tooltip>
            </TableCell>
        </TableRow>
    );
});

export const InventoryTable = ({
    navigationRevision = 0,
    rows,
    supported,
    available,
    reason,
    metrics,
    storageFallback,
    normalizedRuApplicability,
    onRevealInTree,
    onOpenQueryEditor,
    selectedContainer,
    onSelectContainer,
    active = true,
}: {
    navigationRevision?: number;
    rows: InventoryContainerRow[];
    supported: boolean;
    available: boolean;
    reason?: UnavailableReason;
    metrics?: Record<string, ContainerMetrics>;
    storageFallback?: StorageMeasurement;
    normalizedRuApplicability?: MetricApplicability;
    onRevealInTree: (databaseId: string, containerId: string) => void;
    onOpenQueryEditor: (databaseId: string, containerId: string) => void;
    selectedContainer?: ContainerRef;
    onSelectContainer?: (container: ContainerRef) => void;
    active?: boolean;
}) => {
    const styles = useStyles();
    const { announce } = useAnnounce();
    const filterChangePending = useRef(false);
    const rootRef = useRef<HTMLElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<HTMLTableElement>(null);
    const focusedElement = useRef<HTMLElement | null>(null);
    const previousNavigationRevision = useRef(navigationRevision);
    useLayoutEffect(() => {
        const navigating = previousNavigationRevision.current !== navigationRevision;
        previousNavigationRevision.current = navigationRevision;
        if (focusedElement.current && !focusedElement.current.isConnected) {
            focusedElement.current = null;
            const root = rootRef.current;
            if (
                active &&
                !navigating &&
                root &&
                root.ownerDocument.hasFocus() &&
                root.ownerDocument.activeElement === root.ownerDocument.body
            ) {
                root.focus({ preventScroll: true });
            }
        }
    });
    const [page, setPage] = useState(0);
    const [search, setSearch] = useState('');
    const [databaseFilter, setDatabaseFilter] = useState<string>('all');
    const [throughputFilter, setThroughputFilter] = useState<string>('all');
    const [sortKey, setSortKey] = useState<SortKey>('containerId');
    const [sortDirection, setSortDirection] = useState<SortDirection>('ascending');
    const showProvisionedMetrics = normalizedRuApplicability?.status !== 'notApplicable';

    useEffect(() => {
        if (!showProvisionedMetrics) {
            setThroughputFilter('all');
            if (sortKey === 'throughputMode' || sortKey === 'throughputRU' || sortKey === 'peakRuPercent') {
                setSortKey('containerId');
                setSortDirection('ascending');
                setPage(0);
            }
        }
    }, [showProvisionedMetrics, sortKey]);

    const databases = useMemo(() => [...new Set(rows.map((r) => r.databaseId))].sort(), [rows]);

    const filteredRows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return rows.filter((row) => {
            if (databaseFilter !== 'all' && row.databaseId !== databaseFilter) {
                return false;
            }
            if (showProvisionedMetrics && throughputFilter !== 'all' && row.throughputMode !== throughputFilter) {
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
    }, [rows, search, databaseFilter, throughputFilter, showProvisionedMetrics]);

    const sortedRows = useMemo(() => {
        const factor = sortDirection === 'ascending' ? 1 : -1;
        const metricOf = (row: InventoryContainerRow) => metrics?.[containerKey(row)];
        return [...filteredRows].sort((a, b) => {
            const criticalFirst =
                Number(rowHealth(b, metricOf(b), normalizedRuApplicability) === 'Critical') -
                Number(rowHealth(a, metricOf(a), normalizedRuApplicability) === 'Critical');
            if (criticalFirst !== 0) {
                return criticalFirst;
            }
            switch (sortKey) {
                case 'throughputRU':
                    return factor * ((a.throughputRU ?? -1) - (b.throughputRU ?? -1));
                case 'storageBytes': {
                    const aStorage = metricOf(a)?.storage;
                    const bStorage = metricOf(b)?.storage;
                    return (
                        factor *
                        ((aStorage ? (summarizeStorage(aStorage).bytes ?? -1) : -1) -
                            (bStorage ? (summarizeStorage(bStorage).bytes ?? -1) : -1))
                    );
                }
                case 'documentCount':
                    return factor * ((metricOf(a)?.documentCount ?? -1) - (metricOf(b)?.documentCount ?? -1));
                case 'peakRuPercent':
                    return factor * ((metricOf(a)?.peakRuPercent ?? -1) - (metricOf(b)?.peakRuPercent ?? -1));
                case 'health':
                    return (
                        factor *
                        (HEALTH_ORDER[rowHealth(a, metricOf(a), normalizedRuApplicability)] -
                            HEALTH_ORDER[rowHealth(b, metricOf(b), normalizedRuApplicability)])
                    );
                case 'containerId':
                case 'databaseId':
                case 'throughputMode':
                    return factor * String(a[sortKey]).localeCompare(String(b[sortKey]));
                default:
                    return 0;
            }
        });
    }, [filteredRows, sortKey, sortDirection, metrics, normalizedRuApplicability]);

    const toggleSort = useCallback(
        (key: SortKey) => {
            setPage(0);
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
    const databaseText = databaseFilter === 'all' ? l10n.t('All databases') : databaseFilter;
    const throughputText =
        throughputFilter === 'all'
            ? l10n.t('All throughput modes')
            : THROUGHPUT_MODE_LABELS[throughputFilter as ThroughputMode];

    useEffect(() => {
        if (!active || !available || !supported) {
            filterChangePending.current = false;
        }
        if (!filterChangePending.current) {
            return;
        }
        const timeout = setTimeout(() => {
            filterChangePending.current = false;
            announce(
                filteredRows.length === 0
                    ? l10n.t('No containers match the current filters.')
                    : l10n.t('Containers matching the current filters: {count}', { count: filteredRows.length }),
                { polite: true },
            );
        }, 300);
        return () => clearTimeout(timeout);
    }, [active, available, supported, search, databaseFilter, throughputFilter, filteredRows.length, announce]);

    const handleSearchChange = useCallback((_event: unknown, data: InputOnChangeData) => {
        filterChangePending.current = true;
        setPage(0);
        setSearch(data.value);
    }, []);
    const handleDatabaseSelect = useCallback(
        (_event: unknown, data: OptionOnSelectData) => {
            if (data.optionValue && data.optionValue !== databaseFilter) {
                filterChangePending.current = true;
                setPage(0);
                setDatabaseFilter(data.optionValue);
            }
        },
        [databaseFilter],
    );
    const handleThroughputSelect = useCallback(
        (_event: unknown, data: OptionOnSelectData) => {
            if (data.optionValue && data.optionValue !== throughputFilter) {
                filterChangePending.current = true;
                setPage(0);
                setThroughputFilter(data.optionValue);
            }
        },
        [throughputFilter],
    );

    // Bound the expensive sparklines without unmounting rows during keyboard or screen-reader navigation.
    const pageSize = 25;
    const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
    const currentPage = Math.min(page, pageCount - 1);
    const start = currentPage * pageSize;
    const pageRows = sortedRows.slice(start, start + pageSize);
    const pageLabel = (index: number) =>
        l10n.t('Page {page} of {pages}. Containers {start} to {end} of {total}.', {
            page: index + 1,
            pages: pageCount,
            start: index * pageSize + 1,
            end: Math.min((index + 1) * pageSize, sortedRows.length),
            total: sortedRows.length,
        });
    const changePage = (next: number) => {
        setPage(next);
        announce(pageLabel(next), { polite: true });
    };
    useEffect(() => {
        setPage(currentPage);
    }, [currentPage]);
    useLayoutEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = 0;
        }
    }, [currentPage, search, databaseFilter, throughputFilter, sortKey, sortDirection]);

    useLayoutEffect(() => {
        const scrollArea = scrollRef.current;
        const table = tableRef.current;
        if (!active || !scrollArea || !table) {
            return;
        }
        const visibleRowCount = 5;
        const visibleRows = Array.from(table.rows).slice(0, visibleRowCount + 1);
        if (table.rows.length <= visibleRowCount + 1) {
            scrollArea.style.removeProperty('max-height');
            return;
        }
        const updateHeight = () => {
            const rowsHeight = visibleRows.reduce((height, row) => height + row.getBoundingClientRect().height, 0);
            // Keep all five rows visible even when a horizontal scrollbar occupies part of the viewport.
            const scrollbarHeight = scrollArea.offsetHeight - scrollArea.clientHeight;
            scrollArea.style.maxHeight = `${rowsHeight + scrollbarHeight}px`;
        };
        updateHeight();
        const observer = new ResizeObserver(() => {
            updateHeight();
        });
        visibleRows.forEach((row) => observer.observe(row));
        observer.observe(scrollArea);
        return () => observer.disconnect();
    }, [active, available, supported, currentPage, sortedRows]);

    const emptyContent = !available ? (
        <EmptyState reason={reason ?? 'noData'} requiredRole={l10n.t('Reader on the Cosmos DB account')} />
    ) : !supported ? (
        <Text className={styles.emptyState}>
            {l10n.t('Databases and containers inventory is only available for NoSQL (Core) API accounts.')}
        </Text>
    ) : rows.length === 0 ? (
        <Text className={styles.emptyState}>{l10n.t('This account has no databases or containers yet.')}</Text>
    ) : undefined;

    return (
        <section
            ref={rootRef}
            className={styles.root}
            tabIndex={-1}
            aria-label={l10n.t('Container inventory')}
            onFocusCapture={(event) => {
                focusedElement.current = event.target;
            }}
        >
            {emptyContent ?? (
                <>
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
                            key={`database-${active}-${navigationRevision}`}
                            className={styles.filter}
                            aria-label={l10n.t('Filter by database: {selection}', { selection: databaseText })}
                            value={databaseText}
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
                        {showProvisionedMetrics && (
                            <Dropdown
                                key={`throughput-${active}-${navigationRevision}`}
                                className={styles.filter}
                                aria-label={l10n.t('Filter by throughput mode: {selection}', {
                                    selection: throughputText,
                                })}
                                value={throughputText}
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
                        )}
                    </div>
                    {sortedRows.length > 0 && (
                        <nav className={styles.toolbar} aria-label={l10n.t('Container inventory pages')}>
                            <Button
                                size="small"
                                disabledFocusable={currentPage === 0}
                                onClick={currentPage > 0 ? () => changePage(currentPage - 1) : undefined}
                            >
                                {l10n.t('Previous page')}
                            </Button>
                            <Text>{pageLabel(currentPage)}</Text>
                            <Button
                                size="small"
                                disabledFocusable={currentPage === pageCount - 1}
                                onClick={currentPage < pageCount - 1 ? () => changePage(currentPage + 1) : undefined}
                            >
                                {l10n.t('Next page')}
                            </Button>
                        </nav>
                    )}

                    {sortedRows.length === 0 ? (
                        <Text className={styles.emptyState}>{l10n.t('No containers match the current filters.')}</Text>
                    ) : (
                        <div className={styles.scrollArea} ref={scrollRef}>
                            <Table
                                ref={tableRef}
                                className={styles.table}
                                aria-label={l10n.t('Containers')}
                                aria-description={l10n.t(
                                    'Critical containers appear first. Column sorting applies within critical and other containers separately.',
                                )}
                                aria-rowcount={sortedRows.length + 1}
                            >
                                <TableHeader className={styles.stickyHeader}>
                                    <TableRow aria-rowindex={1}>
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
                                        {showProvisionedMetrics && (
                                            <SortableHeaderCell
                                                columnKey="throughputMode"
                                                activeSortKey={sortKey}
                                                sortDirection={sortDirection}
                                                onSort={toggleSort}
                                            >
                                                {l10n.t('Throughput')}
                                            </SortableHeaderCell>
                                        )}
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
                                        {showProvisionedMetrics && (
                                            <SortableHeaderCell
                                                columnKey="peakRuPercent"
                                                activeSortKey={sortKey}
                                                sortDirection={sortDirection}
                                                onSort={toggleSort}
                                            >
                                                {l10n.t('Peak normalized RU')}
                                            </SortableHeaderCell>
                                        )}
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
                                    {pageRows.map((row, index) => (
                                        <InventoryRow
                                            key={containerKey(row)}
                                            dataIndex={start + index}
                                            row={row}
                                            metric={metrics?.[containerKey(row)]}
                                            storageFallback={storageFallback}
                                            normalizedRuApplicability={normalizedRuApplicability}
                                            onRevealInTree={onRevealInTree}
                                            onOpenQueryEditor={onOpenQueryEditor}
                                            selected={
                                                selectedContainer?.databaseId === row.databaseId &&
                                                selectedContainer?.containerId === row.containerId
                                            }
                                            onSelectContainer={onSelectContainer}
                                        />
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </>
            )}
        </section>
    );
};
