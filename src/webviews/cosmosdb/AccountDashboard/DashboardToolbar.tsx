/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuDivider,
    MenuItem,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Overflow,
    OverflowItem,
    Toolbar,
    ToolbarButton,
    Tooltip,
    useIsOverflowItemVisible,
    useOverflowMenu,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowClockwiseRegular,
    BracesRegular,
    CalendarClockRegular,
    DeleteRegular,
    FolderAddRegular,
    MoneyRegular,
    MoreHorizontalRegular,
    PauseRegular,
    PlayRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type TimeRange } from '../../api/types';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { TIME_RANGE_LABELS, TIME_RANGES } from './dashboardModel';

/**
 * The action bar below the identity band. Creation and hand-off actions on the left collapse into the overflow menu
 * first; the view controls (window, live updates, refresh) are pinned to the right edge.
 */
export function DashboardToolbar({
    overview,
    currentDatabase,
}: {
    overview: AccountOverviewState;
    /** The database the inventory has stepped into; enables New Container. */
    currentDatabase?: string;
}) {
    const busy = overview.accountActionBusy;
    const supported = overview.inventory?.supported === true;
    const newDatabase = () => void overview.runAccountAction({ action: 'createDatabase' });
    const newContainer = () =>
        currentDatabase && void overview.runAccountAction({ action: 'createContainer', databaseId: currentDatabase });
    const viewCost = () => void overview.runAccountAction({ action: 'openCosts' });

    return (
        <Overflow padding={40} hasHiddenItems>
            <Toolbar size="small" className="primaryActionBar dashboardToolbar" aria-label={l10n.t('Account actions')}>
                <OverflowItem id="newDatabase" priority={3}>
                    <ToolbarButton icon={<AddRegular />} disabled={busy || !supported} onClick={newDatabase}>
                        {l10n.t('New Database')}
                    </ToolbarButton>
                </OverflowItem>
                <OverflowItem id="newContainer" priority={2}>
                    <Tooltip
                        content={
                            currentDatabase
                                ? l10n.t('Create a container in database {database}', { database: currentDatabase })
                                : l10n.t('Open a database in the inventory below to add a container to it')
                        }
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton
                            icon={<FolderAddRegular />}
                            disabledFocusable={busy || !supported || !currentDatabase}
                            onClick={newContainer}
                        >
                            {l10n.t('New Container')}
                        </ToolbarButton>
                    </Tooltip>
                </OverflowItem>
                <OverflowItem id="viewCost" priority={1}>
                    <ToolbarButton icon={<MoneyRegular />} disabled={busy} onClick={viewCost}>
                        {l10n.t('View Cost')}
                    </ToolbarButton>
                </OverflowItem>

                <OverflowItem id="timeRange" pinned>
                    <Menu
                        checkedValues={{ timeRange: [overview.timeRange] }}
                        onCheckedValueChange={(_, data) => overview.setTimeRange(data.checkedItems[0] as TimeRange)}
                    >
                        <MenuTrigger disableButtonEnhancement>
                            <Tooltip
                                content={l10n.t('Time window for metrics, peaks and throttling')}
                                relationship="description"
                                withArrow
                            >
                                <ToolbarButton className="toolbarRightGroupStart" icon={<CalendarClockRegular />}>
                                    {TIME_RANGE_LABELS[overview.timeRange]}
                                </ToolbarButton>
                            </Tooltip>
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                {TIME_RANGES.map((range) => (
                                    <MenuItemRadio key={range} name="timeRange" value={range}>
                                        {TIME_RANGE_LABELS[range]}
                                    </MenuItemRadio>
                                ))}
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                </OverflowItem>
                <OverflowItem id="pause" pinned>
                    <Tooltip
                        content={
                            overview.paused
                                ? l10n.t('Resume automatic refresh')
                                : l10n.t('Pause automatic refresh; the numbers stay as they are')
                        }
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton
                            icon={overview.paused ? <PlayRegular /> : <PauseRegular />}
                            aria-pressed={overview.paused}
                            onClick={() => overview.setPaused(!overview.paused)}
                        >
                            {overview.paused ? l10n.t('Resume') : l10n.t('Pause')}
                        </ToolbarButton>
                    </Tooltip>
                </OverflowItem>
                <OverflowItem id="refresh" pinned>
                    <Tooltip
                        content={l10n.t('Re-read metrics, alerts and recommendations now')}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton icon={<ArrowClockwiseRegular />} onClick={overview.refresh}>
                            {l10n.t('Refresh')}
                        </ToolbarButton>
                    </Tooltip>
                </OverflowItem>
                <MoreActionsMenu
                    busy={busy}
                    supported={supported}
                    canCreateContainer={currentDatabase !== undefined}
                    onNewDatabase={newDatabase}
                    onNewContainer={newContainer}
                    onViewCost={viewCost}
                    onViewJson={() => void overview.runAccountAction({ action: 'openJson' })}
                    onDelete={() => void overview.runAccountAction({ action: 'deleteAccount' })}
                />
            </Toolbar>
        </Overflow>
    );
}

function MoreActionsMenu(props: {
    busy: boolean;
    supported: boolean;
    canCreateContainer: boolean;
    onNewDatabase: () => void;
    onNewContainer: () => void;
    onViewCost: () => void;
    onViewJson: () => void;
    onDelete: () => void;
}) {
    const { ref } = useOverflowMenu<HTMLButtonElement>();
    const newDatabaseVisible = useIsOverflowItemVisible('newDatabase');
    const newContainerVisible = useIsOverflowItemVisible('newContainer');
    const viewCostVisible = useIsOverflowItemVisible('viewCost');
    const anyHidden = !newDatabaseVisible || !newContainerVisible || !viewCostVisible;

    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <Tooltip content={l10n.t('More account actions')} relationship="label" withArrow>
                    <ToolbarButton
                        ref={ref}
                        icon={<MoreHorizontalRegular />}
                        aria-label={l10n.t('More account actions')}
                    />
                </Tooltip>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {!newDatabaseVisible && (
                        <MenuItem
                            icon={<AddRegular />}
                            disabled={props.busy || !props.supported}
                            onClick={props.onNewDatabase}
                        >
                            {l10n.t('New Database')}
                        </MenuItem>
                    )}
                    {!newContainerVisible && (
                        <MenuItem
                            icon={<FolderAddRegular />}
                            disabled={props.busy || !props.supported || !props.canCreateContainer}
                            onClick={props.onNewContainer}
                        >
                            {l10n.t('New Container')}
                        </MenuItem>
                    )}
                    {!viewCostVisible && (
                        <MenuItem icon={<MoneyRegular />} disabled={props.busy} onClick={props.onViewCost}>
                            {l10n.t('View Cost')}
                        </MenuItem>
                    )}
                    {anyHidden && <MenuDivider />}
                    <MenuItem icon={<BracesRegular />} disabled={props.busy} onClick={props.onViewJson}>
                        {l10n.t('View Account JSON')}
                    </MenuItem>
                    <MenuItem disabled>{l10n.t('Data Modeler (coming soon)')}</MenuItem>
                    <MenuDivider />
                    <MenuItem icon={<DeleteRegular />} disabled={props.busy} onClick={props.onDelete}>
                        {l10n.t('Delete Account…')}
                    </MenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
}
