/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type OptionOnSelectData } from '@fluentui/react-combobox';
import {
    Button,
    Dropdown,
    Label,
    Menu,
    MenuDivider,
    MenuItem,
    type MenuItemProps,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Option,
    Overflow,
    OverflowItem,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    Tooltip,
    useIsOverflowGroupVisible,
    useIsOverflowItemVisible,
    useOverflowMenu,
    useRestoreFocusSource,
    useRestoreFocusTarget,
} from '@fluentui/react-components';
import {
    ArrowClockwiseFilled,
    ArrowDownloadRegular,
    ArrowLeftFilled,
    ArrowPreviousFilled,
    ArrowRightFilled,
    Checkmark16Filled,
    DocumentCopyRegular,
    MoreHorizontal20Filled,
    NumberSymbolSquareRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import type React from 'react';
import { type ForwardedRef, forwardRef, type PropsWithChildren, useCallback, useEffect, useState } from 'react';
import { queryMetricsToJSON, queryResultToJSON } from '../../../../utils/convertors';
import { AlertDialog } from '../../../common/AlertDialog';
import { CommandType, HotkeyScope, useCommandHotkey } from '../../../common/hotkeys';
import { Timer } from '../../../Timer';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export type OpenAlertDialogProps = {
    setIsOpen: (isOpen: boolean) => void;
    setAction: (action: () => () => Promise<void>) => void;
};

type OverflowToolbarItemProps = {
    type: 'button' | 'menuitem';
};

type ToolbarOverflowButtonProps = {
    type: 'button' | 'menuitem';
    refs: ForwardedRef<HTMLButtonElement>;
    content: string;
    onClick: () => Promise<void> | void;
    icon: React.ReactElement;
    ariaLabel: string;
    disabled?: boolean;
};

const ToolbarOverflowButton = (props: ToolbarOverflowButtonProps) => {
    const { type, refs, content, onClick, icon, ariaLabel, disabled } = props;

    const restoreFocusTargetAttribute = useRestoreFocusTarget();
    const restoreFocusSourceAttribute = useRestoreFocusSource();

    return (
        <>
            {type === 'button' && (
                <Tooltip content={content} relationship="description" withArrow>
                    <ToolbarButton
                        ref={refs}
                        onClick={() => void onClick()}
                        aria-label={ariaLabel}
                        icon={icon}
                        disabled={disabled}
                        {...restoreFocusTargetAttribute}
                    />
                </Tooltip>
            )}
            {type === 'menuitem' && (
                <MenuItem
                    onClick={() => void onClick()}
                    aria-label={ariaLabel}
                    icon={icon}
                    disabled={disabled}
                    {...restoreFocusSourceAttribute}
                >
                    {content}
                </MenuItem>
            )}
        </>
    );
};

const ReloadQueryButton = forwardRef(
    (props: OverflowToolbarItemProps & OpenAlertDialogProps, ref: ForwardedRef<HTMLButtonElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const { setIsOpen, setAction } = props;
        const isDisabled = !state.isConnected || !state.currentExecutionId;

        const reloadData = useCallback(() => {
            setIsOpen(true);
            setAction(() => async () => {
                await dispatcher.runQuery(state.queryHistory[state.queryHistory.length - 1], {
                    countPerPage: state.pageSize,
                });
            });
        }, [dispatcher, state, setAction, setIsOpen]);

        useCommandHotkey(HotkeyScope.ResultPanel, CommandType.Refresh, reloadData, { disabled: isDisabled });

        return (
            <ToolbarOverflowButton
                type={props.type}
                refs={ref}
                onClick={reloadData}
                icon={<ArrowClockwiseFilled />}
                ariaLabel={l10n.t('Refresh')}
                content={l10n.t('Reload query results')}
                disabled={isDisabled}
            />
        );
    },
);
ReloadQueryButton.displayName = 'ReloadQueryButton';

const GoToFirstPageButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const isDisabled = state.pageNumber === 1 || !state.isConnected || state.isExecuting || !state.currentExecutionId;

    const firstPage = useCallback(() => dispatcher.firstPage(state.currentExecutionId), [dispatcher, state]);

    useCommandHotkey(HotkeyScope.ResultPanel, CommandType.SwitchToFirstPage, firstPage, { disabled: isDisabled });

    return (
        <ToolbarOverflowButton
            type={props.type}
            refs={ref}
            onClick={firstPage}
            icon={<ArrowPreviousFilled />}
            ariaLabel={l10n.t('Go to first page')}
            content={l10n.t('Go to first page')}
            disabled={isDisabled}
        />
    );
});
GoToFirstPageButton.displayName = 'GoToFirstPageButton';

const GoToPrevPageButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const isDisabled = state.pageNumber === 1 || !state.isConnected || state.isExecuting || !state.currentExecutionId;

    const prevPage = useCallback(() => dispatcher.prevPage(state.currentExecutionId), [dispatcher, state]);

    useCommandHotkey(HotkeyScope.ResultPanel, CommandType.SwitchToPreviousPage, prevPage, { disabled: isDisabled });

    return (
        <ToolbarOverflowButton
            type={props.type}
            refs={ref}
            onClick={prevPage}
            icon={<ArrowLeftFilled />}
            ariaLabel={l10n.t('Go to previous page')}
            content={l10n.t('Go to previous page')}
            disabled={isDisabled}
        />
    );
});
GoToPrevPageButton.displayName = 'GoToPrevPageButton';

const GoToNextPageButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const hasMoreResults = state.currentQueryResult?.hasMoreResults ?? false;
    const isDisabled =
        state.pageSize === -1 || // Disable if page size is set to 'All'
        !state.isConnected ||
        state.isExecuting ||
        !state.currentExecutionId ||
        !hasMoreResults;

    const nextPage = useCallback(() => dispatcher.nextPage(state.currentExecutionId), [dispatcher, state]);

    useCommandHotkey(HotkeyScope.ResultPanel, CommandType.SwitchToNextPage, nextPage, { disabled: isDisabled });

    return (
        <ToolbarOverflowButton
            type={props.type}
            refs={ref}
            onClick={nextPage}
            icon={<ArrowRightFilled />}
            ariaLabel={l10n.t('Go to next page')}
            content={l10n.t('Go to next page (Load more)')}
            disabled={isDisabled}
        />
    );
});
GoToNextPageButton.displayName = 'GoToNextPageButton';

const ChangePageSizeButton = forwardRef(
    (props: OverflowToolbarItemProps & OpenAlertDialogProps, ref: ForwardedRef<HTMLDivElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();

        const pageSize = state.pageSize;
        const { setIsOpen, setAction } = props;

        const changePageSize = useCallback(
            (countPerPage: number) => {
                if (!state.currentExecutionId) {
                    // The result is not loaded yet, just set the page size
                    dispatcher.setPageSize(countPerPage);
                    return;
                }

                setIsOpen(true);
                setAction(() => async () => {
                    dispatcher.setPageSize(countPerPage);
                    await dispatcher.runQuery(state.queryHistory[state.queryHistory.length - 1], { countPerPage });
                });
            },
            [dispatcher, state, setAction, setIsOpen],
        );

        const onOptionSelect = useCallback(
            (data: OptionOnSelectData) => {
                const parsedValue = parseInt(data.optionValue ?? '', 10);
                const countPerPage = isFinite(parsedValue) ? parsedValue : -1;
                changePageSize(countPerPage);
            },
            [changePageSize],
        );

        if (props.type === 'button') {
            return (
                <div ref={ref} style={{ paddingLeft: '8px' }}>
                    <Tooltip content={l10n.t('Change page size')} relationship="description" withArrow>
                        <Dropdown
                            onOptionSelect={(_event, data) => onOptionSelect(data)}
                            style={{ minWidth: '100px', maxWidth: '100px' }}
                            value={pageSize === -1 ? l10n.t('All') : pageSize.toString()}
                            selectedOptions={[pageSize.toString()]}
                        >
                            <Option key="10" value={'10'}>
                                10
                            </Option>
                            <Option key="50" value={'50'}>
                                50
                            </Option>
                            <Option key="100" value={'100'}>
                                100
                            </Option>
                            <Option key="500" value={'500'}>
                                500
                            </Option>
                            <Option key="All" value={'-1'}>
                                {l10n.t('All')}
                            </Option>
                        </Dropdown>
                    </Tooltip>
                </div>
            );
        }

        return (
            <>
                <Menu>
                    <MenuTrigger>
                        <MenuItem aria-label={l10n.t('Change page size')} icon={<NumberSymbolSquareRegular />}>
                            {l10n.t('Change page size')}
                        </MenuItem>
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem
                                onClick={() => changePageSize(10)}
                                icon={
                                    <Checkmark16Filled style={{ visibility: pageSize === 10 ? 'visible' : 'hidden' }} />
                                }
                            >
                                10
                            </MenuItem>
                            <MenuItem
                                onClick={() => changePageSize(50)}
                                icon={
                                    <Checkmark16Filled style={{ visibility: pageSize === 50 ? 'visible' : 'hidden' }} />
                                }
                            >
                                50
                            </MenuItem>
                            <MenuItem
                                onClick={() => changePageSize(100)}
                                icon={
                                    <Checkmark16Filled
                                        style={{ visibility: pageSize === 100 ? 'visible' : 'hidden' }}
                                    />
                                }
                            >
                                100
                            </MenuItem>
                            <MenuItem
                                onClick={() => changePageSize(500)}
                                icon={
                                    <Checkmark16Filled
                                        style={{ visibility: pageSize === 500 ? 'visible' : 'hidden' }}
                                    />
                                }
                            >
                                500
                            </MenuItem>
                            <MenuItem
                                onClick={() => changePageSize(-1)}
                                icon={
                                    <Checkmark16Filled style={{ visibility: pageSize === -1 ? 'visible' : 'hidden' }} />
                                }
                            >
                                {l10n.t('All')}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            </>
        );
    },
);
ChangePageSizeButton.displayName = 'ChangePageSizeButton';

const StatusBar = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLDivElement>) => {
    const state = useQueryEditorState();

    const [time, setTime] = useState(0);

    const recordRange = state.currentExecutionId
        ? state.pageSize === -1
            ? state.currentQueryResult?.documents?.length
                ? `0 - ${state.currentQueryResult?.documents?.length}`
                : l10n.t('All')
            : `${(state.pageNumber - 1) * state.pageSize} - ${state.pageNumber * state.pageSize}`
        : `0 - 0`;

    useEffect(() => {
        let interval: NodeJS.Timeout | undefined = undefined;
        let now: number;

        if (state.isExecuting) {
            now = Date.now();
            interval = setInterval(() => {
                setTime(Date.now() - now);
            }, 10);
        } else {
            now = 0;
            setTime(0);
            clearInterval(interval);
        }
        return () => clearInterval(interval);
    }, [state.isExecuting]);

    if (props.type === 'button') {
        return (
            <div ref={ref} style={{ minWidth: '100px', maxWidth: '100px', textAlign: 'center' }}>
                {state.isExecuting && <Timer time={time} />}
                {!state.isExecuting && <Label weight="semibold">{recordRange}</Label>}
            </div>
        );
    }

    return (
        <MenuItem>
            {state.isExecuting && <Timer time={time} />}
            {!state.isExecuting && <Label weight="semibold">{recordRange}</Label>}
        </MenuItem>
    );
});
StatusBar.displayName = 'StatusBar';

const CopyToClipboardButton = forwardRef(
    (props: OverflowToolbarItemProps & ResultToolbarProps, ref: ForwardedRef<HTMLButtonElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();

        const { selectedTab } = props;
        const hasSelection = state.selectedRows.length > 1; // If one document selected, it's not a selection
        const tooltipClipboardContent = hasSelection
            ? l10n.t('Copy selected items to clipboard')
            : l10n.t('Copy all results from the current page to clipboard');

        const onSaveToClipboardAsCSV = useCallback(() => {
            if (selectedTab === 'result__tab') {
                return dispatcher.copyCSVToClipboard(
                    state.currentQueryResult,
                    state.partitionKey,
                    hasSelection ? state.selectedRows : undefined,
                );
            }

            if (selectedTab === 'stats__tab') {
                return dispatcher.copyMetricsCSVToClipboard(state.currentQueryResult);
            }

            return Promise.resolve();
        }, [dispatcher, state, selectedTab, hasSelection]);

        const onSaveToClipboardAsJSON = useCallback(async () => {
            if (selectedTab === 'result__tab') {
                const selectedRows = hasSelection ? state.selectedRows : undefined;
                const json = queryResultToJSON(state.currentQueryResult, selectedRows);
                return dispatcher.copyToClipboard(json);
            }

            if (selectedTab === 'stats__tab') {
                const json = await queryMetricsToJSON(state.currentQueryResult);
                return await dispatcher.copyToClipboard(json);
            }

            return Promise.resolve();
        }, [dispatcher, state, selectedTab, hasSelection]);

        useCommandHotkey(HotkeyScope.ResultPanel, CommandType.CopyToClipboard, onSaveToClipboardAsJSON, {
            disabled: !state.isConnected,
        });

        return (
            <Menu>
                <MenuTrigger>
                    {props.type === 'button' ? (
                        <Tooltip content={tooltipClipboardContent} relationship="description" withArrow>
                            <ToolbarButton
                                ref={ref}
                                aria-label={l10n.t('Copy to clipboard')}
                                icon={<DocumentCopyRegular />}
                                disabled={!state.isConnected}
                            />
                        </Tooltip>
                    ) : (
                        <MenuItem
                            aria-label={l10n.t('Copy to clipboard')}
                            icon={<DocumentCopyRegular />}
                            disabled={!state.isConnected}
                        >
                            {l10n.t('Copy to clipboard')}
                        </MenuItem>
                    )}
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem onClick={() => void onSaveToClipboardAsCSV()}>CSV</MenuItem>
                        <MenuItem onClick={() => void onSaveToClipboardAsJSON()}>JSON</MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        );
    },
);
CopyToClipboardButton.displayName = 'CopyToClipboardButton';

const ExportButton = forwardRef(
    (props: OverflowToolbarItemProps & ResultToolbarProps, ref: ForwardedRef<HTMLButtonElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const { selectedTab } = props;
        const hasSelection = state.selectedRows.length > 1; // If one document selected, it's not a selection
        const tooltipExportContent = hasSelection
            ? l10n.t('Export selected items')
            : l10n.t('Export all results from the current page');

        const onSaveAsCSV = useCallback(async () => {
            const filename = `${state.dbName}_${state.collectionName}_${state.currentQueryResult?.activityId ?? 'query'}`;
            if (selectedTab === 'result__tab') {
                const selectedRows = hasSelection ? state.selectedRows : undefined;
                return dispatcher.saveCSV(
                    `${filename}_result`,
                    state.currentQueryResult,
                    state.partitionKey,
                    selectedRows,
                );
            }

            if (selectedTab === 'stats__tab') {
                return dispatcher.saveMetricsCSV(`${filename}_stats`, state.currentQueryResult);
            }

            return Promise.resolve();
        }, [dispatcher, state, selectedTab, hasSelection]);

        const onSaveAsJSON = useCallback(async () => {
            const filename = `${state.dbName}_${state.collectionName}_${state.currentQueryResult?.activityId ?? 'query'}`;
            if (selectedTab === 'result__tab') {
                const selectedRows = hasSelection ? state.selectedRows : undefined;
                const json = queryResultToJSON(state.currentQueryResult, selectedRows);
                return dispatcher.saveToFile(json, `${filename}_result`, 'json');
            }

            if (selectedTab === 'stats__tab') {
                const json = await queryMetricsToJSON(state.currentQueryResult);
                return dispatcher.saveToFile(json, `${filename}_stats`, 'json');
            }

            return Promise.resolve();
        }, [dispatcher, state, selectedTab, hasSelection]);

        useCommandHotkey(HotkeyScope.ResultPanel, CommandType.SaveToDisk, onSaveAsJSON, {
            disabled: !state.isConnected,
        });

        return (
            <Menu>
                <MenuTrigger>
                    {props.type === 'button' ? (
                        <Tooltip content={tooltipExportContent} relationship="description" withArrow>
                            <ToolbarButton
                                ref={ref}
                                aria-label={l10n.t('Export')}
                                icon={<ArrowDownloadRegular />}
                                disabled={!state.isConnected}
                            />
                        </Tooltip>
                    ) : (
                        <MenuItem aria-label="Export" icon={<ArrowDownloadRegular />} disabled={!state.isConnected}>
                            {l10n.t('Export')}
                        </MenuItem>
                    )}
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem onClick={() => void onSaveAsCSV()}>CSV</MenuItem>
                        <MenuItem onClick={() => void onSaveAsJSON()}>JSON</MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        );
    },
);
ExportButton.displayName = 'ExportButton';

interface ToolbarOverflowMenuItemProps extends Omit<MenuItemProps, 'id'> {
    id: string;
}

const ToolbarOverflowMenuItem = (props: PropsWithChildren<ToolbarOverflowMenuItemProps>) => {
    const { id, children } = props;
    const isVisible = useIsOverflowItemVisible(id);

    if (isVisible) {
        return null;
    }

    return children;
};

type ToolbarMenuOverflowDividerProps = {
    id: string;
};

const ToolbarMenuOverflowDivider = (props: ToolbarMenuOverflowDividerProps) => {
    const isGroupVisible = useIsOverflowGroupVisible(props.id);

    if (isGroupVisible === 'visible') {
        return null;
    }

    return <MenuDivider />;
};

const OverflowMenu = ({ selectedTab, setIsOpen, setAction }: ResultToolbarProps & OpenAlertDialogProps) => {
    const { ref, isOverflowing } = useOverflowMenu<HTMLButtonElement>();

    if (!isOverflowing) {
        return null;
    }

    return (
        <>
            <Menu>
                <MenuTrigger disableButtonEnhancement>
                    <Button
                        ref={ref}
                        icon={<MoreHorizontal20Filled />}
                        aria-label={l10n.t('More items')}
                        appearance="subtle"
                    />
                </MenuTrigger>

                <MenuPopover>
                    <MenuList>
                        <ToolbarOverflowMenuItem id={'1'}>
                            <ReloadQueryButton type={'menuitem'} setIsOpen={setIsOpen} setAction={setAction} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarMenuOverflowDivider id="1" />
                        <ToolbarOverflowMenuItem id={'2'}>
                            <GoToFirstPageButton type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarOverflowMenuItem id={'3'}>
                            <GoToPrevPageButton type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarOverflowMenuItem id={'4'}>
                            <GoToNextPageButton type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarOverflowMenuItem id={'5'}>
                            <ChangePageSizeButton type={'menuitem'} setIsOpen={setIsOpen} setAction={setAction} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarMenuOverflowDivider id="2" />
                        <ToolbarOverflowMenuItem id={'6'}>
                            <StatusBar type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarMenuOverflowDivider id="3" />
                        <ToolbarOverflowMenuItem id={'7'}>
                            <CopyToClipboardButton type={'menuitem'} selectedTab={selectedTab} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarOverflowMenuItem id={'8'}>
                            <ExportButton type={'menuitem'} selectedTab={selectedTab} />
                        </ToolbarOverflowMenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </>
    );
};

type ToolbarOverflowDividerProps = {
    groupId: string;
};

const ToolbarOverflowDivider = ({ groupId }: ToolbarOverflowDividerProps) => {
    const groupVisibleState = useIsOverflowGroupVisible(groupId);

    if (groupVisibleState !== 'hidden') {
        return <ToolbarDivider />;
    }

    return null;
};

export type ResultToolbarProps = { selectedTab: string };

export const ResultPanelToolbarOverflow = ({ selectedTab }: ResultToolbarProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [action, setAction] = useState<() => Promise<void>>(() => async () => {});

    const handleDialogClose = useCallback(
        (confirmed: boolean) => {
            if (confirmed) {
                // Execute the action
                void action();
            }
            setIsOpen(false);
        },
        [action],
    );

    return (
        <>
            <AlertDialog
                isOpen={isOpen}
                onClose={handleDialogClose}
                title={l10n.t('Attention')}
                confirmButtonText={l10n.t('Continue')}
                cancelButtonText={l10n.t('Close')}
            >
                <div>{l10n.t('All loaded data will be lost. The query will be executed again in new session.')}</div>
                <div>{l10n.t('Are you sure you want to continue?')}</div>
            </AlertDialog>
            <Overflow padding={70}>
                <Toolbar aria-label="Default" size={'small'}>
                    <OverflowItem id={'1'} groupId={'1'}>
                        <ReloadQueryButton type={'button'} setIsOpen={setIsOpen} setAction={setAction} />
                    </OverflowItem>
                    <ToolbarOverflowDivider groupId="1" />
                    <OverflowItem id={'2'} groupId={'2'}>
                        <GoToFirstPageButton type={'button'} />
                    </OverflowItem>
                    <OverflowItem id={'3'} groupId={'2'}>
                        <GoToPrevPageButton type={'button'} />
                    </OverflowItem>
                    <OverflowItem id={'4'} groupId={'2'}>
                        <GoToNextPageButton type={'button'} />
                    </OverflowItem>
                    <OverflowItem id={'5'} groupId={'2'}>
                        <ChangePageSizeButton type={'button'} setIsOpen={setIsOpen} setAction={setAction} />
                    </OverflowItem>
                    <ToolbarOverflowDivider groupId="2" />
                    <OverflowItem id={'6'} groupId={'3'}>
                        <StatusBar type={'button'} />
                    </OverflowItem>
                    <ToolbarOverflowDivider groupId="3" />
                    <OverflowItem id={'7'} groupId={'4'}>
                        <CopyToClipboardButton type={'button'} selectedTab={selectedTab} />
                    </OverflowItem>
                    <OverflowItem id={'8'} groupId={'4'}>
                        <ExportButton type={'button'} selectedTab={selectedTab} />
                    </OverflowItem>
                    <OverflowMenu selectedTab={selectedTab} setIsOpen={setIsOpen} setAction={setAction} />
                </Toolbar>
            </Overflow>
        </>
    );
};
