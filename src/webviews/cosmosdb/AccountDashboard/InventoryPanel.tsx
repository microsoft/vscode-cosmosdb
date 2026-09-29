/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Breadcrumb,
    BreadcrumbButton,
    BreadcrumbDivider,
    BreadcrumbItem,
    Button,
    SearchBox,
    Skeleton,
    SkeletonItem,
    Table,
    TableBody,
    TableCell,
    TableCellActions,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    Tooltip,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowLeftRegular,
    ChevronRightRegular,
    DatabaseMultipleRegular,
    DatabaseRegular,
    DataHistogramRegular,
    DocumentSearchRegular,
    FolderAddRegular,
    TableSimpleRegular,
    TextBulletListTreeRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX, useMemo, useState } from 'react';
import { EmptyState } from '../AccountOverview/DashboardChrome';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import {
    containerRows,
    databaseRows,
    formatBytes,
    formatCount,
    formatPercent,
    type InventoryRow,
    peakTone,
} from './dashboardModel';
import { HealthIndicator, RelativeBar } from './DashboardParts';

type SortColumn = 'name' | 'storageBytes' | 'documents' | 'childCount' | 'peakRuPercent';
type SortState = { column: SortColumn; direction: 'ascending' | 'descending' };

function arrange(rows: InventoryRow[], filter: string, sort: SortState): InventoryRow[] {
    const needle = filter.trim().toLowerCase();
    const matching = needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;
    return [...matching].sort((a, b) => {
        if (sort.column === 'name') {
            const byName = a.name.localeCompare(b.name);
            return sort.direction === 'ascending' ? byName : -byName;
        }
        const left = a[sort.column];
        const right = b[sort.column];
        if (left === undefined || right === undefined) {
            return left === right ? a.name.localeCompare(b.name) : left === undefined ? 1 : -1;
        }
        const byValue = left - right;
        return byValue === 0 ? a.name.localeCompare(b.name) : sort.direction === 'ascending' ? byValue : -byValue;
    });
}

function SortableHeader({
    column,
    label,
    sort,
    onToggle,
}: {
    column: SortColumn;
    label: string;
    sort: SortState;
    onToggle: (column: SortColumn) => void;
}): JSX.Element {
    const active = sort.column === column;
    return (
        <TableHeaderCell
            sortable
            sortDirection={active ? sort.direction : undefined}
            aria-sort={active ? sort.direction : 'none'}
            onClick={() => onToggle(column)}
        >
            {label}
        </TableHeaderCell>
    );
}

export interface InventoryPanelProps {
    overview: AccountOverviewState;
    currentDatabase: string | undefined;
    onCurrentDatabaseChange: (databaseId: string | undefined) => void;
    /** Adds a row action that opens the container's partition distribution. */
    onInspectPartitions?: (databaseId: string, containerId: string) => void;
    /** Initial sort: data-first variants sort by name, triage-first variants by peak RU. */
    defaultSort?: SortState;
}

/**
 * The account's inventory: databases, and the containers of the one being read. One table geometry at both levels,
 * so stepping into a database changes the rows and nothing else. Stepping in also scopes the metrics above.
 */
export function InventoryPanel({
    overview,
    currentDatabase,
    onCurrentDatabaseChange,
    onInspectPartitions,
    defaultSort = { column: 'name', direction: 'ascending' },
}: InventoryPanelProps) {
    const [filter, setFilter] = useState('');
    const [sort, setSort] = useState<SortState>(defaultSort);
    const atDatabases = currentDatabase === undefined;

    const allRows = useMemo(
        () => (atDatabases ? databaseRows(overview) : containerRows(overview, currentDatabase)),
        [atDatabases, currentDatabase, overview],
    );
    const rows = useMemo(() => arrange(allRows, filter, sort), [allRows, filter, sort]);
    const largest = rows.reduce((max, row) => Math.max(max, row.storageBytes ?? 0), 0);

    const toggleSort = (column: SortColumn) =>
        setSort((current) =>
            current.column === column
                ? { column, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
                : { column, direction: column === 'name' ? 'ascending' : 'descending' },
        );
    const goTo = (databaseId: string | undefined) => {
        setFilter('');
        onCurrentDatabaseChange(databaseId);
    };

    const inventory = overview.inventory;
    const updated = overview.inventoryMetrics?.generatedAt;
    const createLabel = atDatabases ? l10n.t('New Database') : l10n.t('New Container');
    const create = () =>
        atDatabases
            ? void overview.runAccountAction({ action: 'createDatabase' })
            : void overview.runAccountAction({ action: 'createContainer', databaseId: currentDatabase });

    let body: JSX.Element;
    if (!inventory) {
        body = (
            <Skeleton aria-label={l10n.t('Loading inventory…')}>
                {Array.from({ length: 4 }, (_, index) => (
                    <SkeletonItem key={index} size={24} style={{ marginBlock: 8 }} />
                ))}
            </Skeleton>
        );
    } else if (!inventory.supported) {
        body = (
            <div className="emptyState" aria-live="polite">
                <p className="emptyStateDescription">
                    {l10n.t('Databases and containers inventory is only available for NoSQL (Core) API accounts.')}
                </p>
            </div>
        );
    } else if (!inventory.available) {
        body = (
            <EmptyState
                reason={inventory.reason ?? 'noData'}
                requiredRole={l10n.t('Reader on the Cosmos DB account')}
            />
        );
    } else if (allRows.length === 0) {
        body = (
            <div className="emptyState" aria-live="polite">
                <h3 className="emptyStateHeading">
                    {atDatabases
                        ? l10n.t('No databases in this account')
                        : l10n.t('No containers in "{database}"', { database: currentDatabase })}
                </h3>
                <p className="emptyStateDescription">{l10n.t('Create one to start storing documents.')}</p>
                <Button
                    appearance="primary"
                    icon={<AddRegular />}
                    disabled={overview.accountActionBusy}
                    onClick={create}
                >
                    {createLabel}
                </Button>
            </div>
        );
    } else {
        body = (
            <div className="tableScroller">
                <Table
                    size="small"
                    className="dataTable"
                    aria-label={
                        atDatabases
                            ? l10n.t('Databases in this account')
                            : l10n.t('Containers in database {database}', { database: currentDatabase })
                    }
                >
                    <colgroup>
                        <col className="colName" />
                        <col className="colSize" />
                        <col className="colNumber" />
                        <col className={atDatabases ? 'colNumber' : 'colWide'} />
                        <col className="colThroughput" />
                        <col className="colBar" />
                        <col className="colNarrow" />
                    </colgroup>
                    <TableHeader>
                        <TableRow>
                            <SortableHeader
                                column="name"
                                label={atDatabases ? l10n.t('Database') : l10n.t('Container')}
                                sort={sort}
                                onToggle={toggleSort}
                            />
                            <SortableHeader
                                column="storageBytes"
                                label={l10n.t('Storage')}
                                sort={sort}
                                onToggle={toggleSort}
                            />
                            <SortableHeader
                                column="documents"
                                label={l10n.t('Documents')}
                                sort={sort}
                                onToggle={toggleSort}
                            />
                            {atDatabases ? (
                                <SortableHeader
                                    column="childCount"
                                    label={l10n.t('Containers')}
                                    sort={sort}
                                    onToggle={toggleSort}
                                />
                            ) : (
                                <TableHeaderCell>{l10n.t('Partition key')}</TableHeaderCell>
                            )}
                            <TableHeaderCell>{l10n.t('Throughput')}</TableHeaderCell>
                            <SortableHeader
                                column="peakRuPercent"
                                label={l10n.t('Peak RU')}
                                sort={sort}
                                onToggle={toggleSort}
                            />
                            <TableHeaderCell>{l10n.t('Health')}</TableHeaderCell>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow
                                key={row.name}
                                className={atDatabases ? 'dataRow dataRowClickable' : 'dataRow'}
                                onClick={atDatabases ? () => goTo(row.databaseId) : undefined}
                            >
                                <TableCell>
                                    <TableCellLayout
                                        truncate
                                        title={row.name}
                                        media={
                                            atDatabases ? (
                                                <DatabaseRegular className="nameIcon" aria-hidden />
                                            ) : (
                                                <TableSimpleRegular className="nameIcon" aria-hidden />
                                            )
                                        }
                                    >
                                        {row.name}
                                    </TableCellLayout>
                                    <TableCellActions>
                                        <RowActions
                                            row={row}
                                            atDatabases={atDatabases}
                                            onShow={() => goTo(row.databaseId)}
                                            overview={overview}
                                            onInspectPartitions={onInspectPartitions}
                                        />
                                    </TableCellActions>
                                </TableCell>
                                <TableCell>
                                    <RelativeBar
                                        text={formatBytes(row.storageBytes)}
                                        value={row.storageBytes}
                                        maximum={largest}
                                    />
                                </TableCell>
                                <TableCell>
                                    <span className="numberCell" title={row.documents?.toLocaleString()}>
                                        {formatCount(row.documents)}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    {atDatabases ? (
                                        <span className="numberCell">{formatCount(row.childCount)}</span>
                                    ) : (
                                        <span className="monoCell" title={row.partitionKey}>
                                            {row.partitionKey || l10n.t('N/A')}
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <span className="numberCell mutedCell" title={row.throughput}>
                                        {row.throughput}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <RelativeBar
                                        text={formatPercent(row.peakRuPercent)}
                                        value={row.peakRuPercent}
                                        maximum={100}
                                        tone={peakTone(row.peakRuPercent)}
                                    />
                                </TableCell>
                                <TableCell>
                                    <HealthIndicator health={row.health} throttled={row.throttled} />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        );
    }

    return (
        <div className="inventoryPanel">
            <Toolbar className="inventoryToolbar" size="small" aria-label={l10n.t('Inventory controls')}>
                <Breadcrumb aria-label={l10n.t('Inventory level')} size="medium">
                    <BreadcrumbItem>
                        <BreadcrumbButton
                            current={atDatabases}
                            icon={<DatabaseMultipleRegular />}
                            onClick={atDatabases ? undefined : () => goTo(undefined)}
                        >
                            {l10n.t('Databases')}
                        </BreadcrumbButton>
                    </BreadcrumbItem>
                    {!atDatabases && (
                        <>
                            <BreadcrumbDivider />
                            <BreadcrumbItem>
                                <BreadcrumbButton current icon={<DatabaseRegular />} title={currentDatabase}>
                                    {currentDatabase}
                                </BreadcrumbButton>
                            </BreadcrumbItem>
                        </>
                    )}
                </Breadcrumb>
                <ToolbarDivider />
                <ToolbarButton
                    icon={atDatabases ? <AddRegular /> : <FolderAddRegular />}
                    disabled={overview.accountActionBusy || inventory?.supported !== true}
                    onClick={create}
                >
                    {createLabel}
                </ToolbarButton>
                <SearchBox
                    className="inventoryFilterInput"
                    size="small"
                    value={filter}
                    placeholder={atDatabases ? l10n.t('Filter databases…') : l10n.t('Filter containers…')}
                    aria-label={atDatabases ? l10n.t('Filter databases by name') : l10n.t('Filter containers by name')}
                    onChange={(_, data) => setFilter(data.value)}
                />
            </Toolbar>

            {body}

            {inventory?.available && allRows.length > 0 && (
                <div className="listFooter">
                    <div className="listFooterStart">
                        {!atDatabases && (
                            <Button
                                size="small"
                                appearance="outline"
                                icon={<ArrowLeftRegular />}
                                onClick={() => goTo(undefined)}
                            >
                                {l10n.t('Back to Databases')}
                            </Button>
                        )}
                    </div>
                    <div className="listCount">
                        <span aria-live="polite">
                            {atDatabases
                                ? l10n.t('Showing {0} of {1} databases', rows.length, allRows.length)
                                : l10n.t('Showing {0} of {1} containers', rows.length, allRows.length)}
                        </span>
                        {updated !== undefined && (
                            <>
                                <span aria-hidden="true"> · </span>
                                <span>
                                    {l10n.t('Telemetry updated {time}', {
                                        time: new Date(updated).toLocaleTimeString(undefined, {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        }),
                                    })}
                                </span>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function RowActions({
    row,
    atDatabases,
    onShow,
    overview,
    onInspectPartitions,
}: {
    row: InventoryRow;
    atDatabases: boolean;
    onShow: () => void;
    overview: AccountOverviewState;
    onInspectPartitions?: (databaseId: string, containerId: string) => void;
}) {
    if (atDatabases) {
        return (
            <Tooltip content={l10n.t('Show containers')} relationship="label" withArrow>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<ChevronRightRegular />}
                    onClick={(event) => {
                        event.stopPropagation();
                        onShow();
                    }}
                />
            </Tooltip>
        );
    }
    const containerId = row.containerId!;
    return (
        <span className="rowActions">
            <Tooltip content={l10n.t('Open Query Editor')} relationship="label" withArrow>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<DocumentSearchRegular />}
                    onClick={() => overview.handleOpenQueryEditor(row.databaseId, containerId)}
                />
            </Tooltip>
            {onInspectPartitions && (
                <Tooltip content={l10n.t('Inspect partitions')} relationship="label" withArrow>
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<DataHistogramRegular />}
                        onClick={() => onInspectPartitions(row.databaseId, containerId)}
                    />
                </Tooltip>
            )}
            <Tooltip content={l10n.t('Reveal in tree')} relationship="label" withArrow>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<TextBulletListTreeRegular />}
                    onClick={() => overview.handleRevealInTree(row.databaseId, containerId)}
                />
            </Tooltip>
        </span>
    );
}
