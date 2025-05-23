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
import { type ForwardedRef, forwardRef, type PropsWithChildren, useCallback, useEffect, useState } from 'react';
import { queryMetricsToJSON, queryResultToJSON } from '../../../../utils/convertors';
import { AlertDialog } from '../../../common/AlertDialog';
import { Timer } from '../../../Timer';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export type OpenAlertDialogProps = {
    setIsOpen: (isOpen: boolean) => void;
    setAction: (action: () => () => Promise<void>) => void;
};

type OverflowToolbarItemProps = {
    type: 'button' | 'menuitem';
};

const ReloadQueryButton = forwardRef(
    (props: OverflowToolbarItemProps & OpenAlertDialogProps, ref: ForwardedRef<HTMLButtonElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const restoreFocusTargetAttribute = useRestoreFocusTarget();
        const { setIsOpen, setAction } = props;

        const reloadData = () => {
            setIsOpen(true);
            setAction(() => async () => {
                await dispatcher.runQuery(state.queryHistory[state.queryHistory.length - 1], {
                    countPerPage: state.pageSize,
                });
            });
        };

        return (
            <>
                {props.type === 'button' && (
                    <Tooltip content={l10n.t('Reload query results')} relationship="description" withArrow>
                        <ToolbarButton
                            ref={ref}
                            onClick={() => reloadData()}
                            aria-label={l10n.t('Refresh')}
                            icon={<ArrowClockwiseFilled />}
                            {...restoreFocusTargetAttribute}
                            disabled={!state.isConnected || !state.currentExecutionId}
                        />
                    </Tooltip>
                )}
                {props.type === 'menuitem' && (
                    <MenuItem
                        onClick={() => reloadData()}
                        aria-label={l10n.t('Refresh')}
                        icon={<ArrowClockwiseFilled />}
                        disabled={!state.isConnected || !state.currentExecutionId}
                    >
                        {l10n.t('Reload query results')}
                    </MenuItem>
                )}
            </>
        );
    },
);

const GoToFirstPageButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const toFirstPageDisabled =
        state.pageNumber === 1 || !state.isConnected || state.isExecuting || !state.currentExecutionId;
    const firstPage = async () => {
        await dispatcher.firstPage(state.currentExecutionId);
    };

    if (props.type === 'button') {
        return (
            <Tooltip content={l10n.t('Go to first page')} relationship="description" withArrow>
                <ToolbarButton
                    ref={ref}
                    onClick={() => void firstPage()}
                    aria-label={l10n.t('Go to start')}
                    icon={<ArrowPreviousFilled />}
                    disabled={toFirstPageDisabled}
                />
            </Tooltip>
        );
    }

    return (
        <MenuItem
            onClick={() => void firstPage()}
            aria-label={l10n.t('Go to start')}
            icon={<ArrowPreviousFilled />}
            disabled={toFirstPageDisabled}
        >
            {l10n.t('Go to first page')}
        </MenuItem>
    );
});

const GoToPrevPageButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const toPrevPageDisabled =
        state.pageNumber === 1 || !state.isConnected || state.isExecuting || !state.currentExecutionId;
    const prevPage = async () => {
        await dispatcher.prevPage(state.currentExecutionId);
    };

    if (props.type === 'button') {
        return (
            <Tooltip content={l10n.t('Go to previous page')} relationship="description" withArrow>
                <ToolbarButton
                    ref={ref}
                    onClick={() => void prevPage()}
                    aria-label={l10n.t('Go to previous page')}
                    icon={<ArrowLeftFilled />}
                    disabled={toPrevPageDisabled}
                />
            </Tooltip>
        );
    }

    return (
        <MenuItem
            onClick={() => void prevPage()}
            aria-label={l10n.t('Go to previous page')}
            icon={<ArrowLeftFilled />}
            disabled={toPrevPageDisabled}
        >
            {l10n.t('Go to previous page')}
        </MenuItem>
    );
});

const GoToNextPageButton = forwardRef((props: OverflowToolbarItemProps, ref: ForwardedRef<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const hasMoreResults = state.currentQueryResult?.hasMoreResults ?? false;
    const toNextPageDisabled =
        state.pageSize === -1 || // Disable if page size is set to 'All'
        !state.isConnected ||
        state.isExecuting ||
        !state.currentExecutionId ||
        !hasMoreResults;
    const nextPage = async () => {
        await dispatcher.nextPage(state.currentExecutionId);
    };

    if (props.type === 'button') {
        return (
            <Tooltip content={l10n.t('Go to next page (Load more)')} relationship="description" withArrow>
                <ToolbarButton
                    ref={ref}
                    onClick={() => void nextPage()}
                    aria-label={l10n.t('Go to next page')}
                    icon={<ArrowRightFilled />}
                    disabled={toNextPageDisabled}
                />
            </Tooltip>
        );
    }

    return (
        <MenuItem
            onClick={() => void nextPage()}
            aria-label={l10n.t('Go to next page')}
            icon={<ArrowRightFilled />}
            disabled={toNextPageDisabled}
        >
            {l10n.t('Go to next page')}
        </MenuItem>
    );
});

const ChangePageSizeButton = forwardRef(
    (props: OverflowToolbarItemProps & OpenAlertDialogProps, ref: ForwardedRef<HTMLDivElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const restoreFocusTargetAttribute = useRestoreFocusTarget();

        const pageSize = state.pageSize;
        const { setIsOpen, setAction } = props;

        const changePageSize = (countPerPage: number) => {
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
        };

        const onOptionSelect = (data: OptionOnSelectData) => {
            const parsedValue = parseInt(data.optionValue ?? '', 10);
            const countPerPage = isFinite(parsedValue) ? parsedValue : -1;
            changePageSize(countPerPage);
        };

        if (props.type === 'button') {
            return (
                <div ref={ref} style={{ paddingLeft: '8px' }}>
                    <Tooltip content={l10n.t('Change page size')} relationship="description" withArrow>
                        <Dropdown
                            onOptionSelect={(_event, data) => onOptionSelect(data)}
                            style={{ minWidth: '100px', maxWidth: '100px' }}
                            value={pageSize === -1 ? l10n.t('All') : pageSize.toString()}
                            selectedOptions={[pageSize.toString()]}
                            {...restoreFocusTargetAttribute}
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

const CopyToClipboardButton = forwardRef(
    (props: OverflowToolbarItemProps & ResultToolbarProps, ref: ForwardedRef<HTMLButtonElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const { selectedTab } = props;
        const hasSelection = state.selectedRows.length > 1; // If one document selected, it's not a selection
        const tooltipClipboardContent = hasSelection
            ? l10n.t('Copy selected items to clipboard')
            : l10n.t('Copy all results from the current page to clipboard');

        async function onSaveToClipboardAsCSV() {
            if (selectedTab === 'result__tab') {
                await dispatcher.copyCSVToClipboard(
                    state.currentQueryResult,
                    state.partitionKey,
                    hasSelection ? state.selectedRows : undefined,
                );
            }

            if (selectedTab === 'stats__tab') {
                await dispatcher.copyMetricsCSVToClipboard(state.currentQueryResult);
            }
        }

        async function onSaveToClipboardAsJSON() {
            if (selectedTab === 'result__tab') {
                const selectedRows = hasSelection ? state.selectedRows : undefined;
                const json = queryResultToJSON(state.currentQueryResult, selectedRows);
                await dispatcher.copyToClipboard(json);
            }

            if (selectedTab === 'stats__tab') {
                const json = await queryMetricsToJSON(state.currentQueryResult);
                await dispatcher.copyToClipboard(json);
            }
        }

        return (
            <Menu>
                <MenuTrigger>
                    <Tooltip content={tooltipClipboardContent} relationship="description" withArrow>
                        {props.type === 'button' ? (
                            <ToolbarButton
                                ref={ref}
                                aria-label={l10n.t('Copy to clipboard')}
                                icon={<DocumentCopyRegular />}
                                disabled={!state.isConnected}
                            />
                        ) : (
                            <MenuItem
                                aria-label={l10n.t('Copy to clipboard')}
                                icon={<DocumentCopyRegular />}
                                disabled={!state.isConnected}
                            >
                                {l10n.t('Copy to clipboard')}
                            </MenuItem>
                        )}
                    </Tooltip>
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

const ExportButton = forwardRef(
    (props: OverflowToolbarItemProps & ResultToolbarProps, ref: ForwardedRef<HTMLButtonElement>) => {
        const state = useQueryEditorState();
        const dispatcher = useQueryEditorDispatcher();
        const { selectedTab } = props;
        const hasSelection = state.selectedRows.length > 1; // If one document selected, it's not a selection
        const tooltipExportContent = hasSelection
            ? l10n.t('Export selected items')
            : l10n.t('Export all results from the current page');

        async function onSaveAsCSV() {
            const filename = `${state.dbName}_${state.collectionName}_${state.currentQueryResult?.activityId ?? 'query'}`;
            if (selectedTab === 'result__tab') {
                const selectedRows = hasSelection ? state.selectedRows : undefined;
                await dispatcher.saveCSV(
                    `${filename}_result`,
                    state.currentQueryResult,
                    state.partitionKey,
                    selectedRows,
                );
            }

            if (selectedTab === 'stats__tab') {
                await dispatcher.saveMetricsCSV(`${filename}_stats`, state.currentQueryResult);
            }
        }

        async function onSaveAsJSON() {
            const filename = `${state.dbName}_${state.collectionName}_${state.currentQueryResult?.activityId ?? 'query'}`;
            if (selectedTab === 'result__tab') {
                const selectedRows = hasSelection ? state.selectedRows : undefined;
                const json = queryResultToJSON(state.currentQueryResult, selectedRows);
                await dispatcher.saveToFile(json, `${filename}_result`, 'json');
            }

            if (selectedTab === 'stats__tab') {
                const json = await queryMetricsToJSON(state.currentQueryResult);
                await dispatcher.saveToFile(json, `${filename}_stats`, 'json');
            }
        }

        return (
            <Menu>
                <MenuTrigger>
                    <Tooltip content={tooltipExportContent} relationship="description" withArrow>
                        {props.type === 'button' ? (
                            <ToolbarButton
                                ref={ref}
                                aria-label={l10n.t('Export')}
                                icon={<ArrowDownloadRegular />}
                                disabled={!state.isConnected}
                            />
                        ) : (
                            <MenuItem aria-label="Export" icon={<ArrowDownloadRegular />} disabled={!state.isConnected}>
                                {l10n.t('Export')}
                            </MenuItem>
                        )}
                    </Tooltip>
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
                content={
                    <>
                        <div>
                            {l10n.t('All loaded data will be lost. The query will be executed again in new session.')}
                        </div>
                        <div>{l10n.t('Are you sure you want to continue?')}</div>
                    </>
                }
                confirmButtonText={l10n.t('Continue')}
                cancelButtonText={l10n.t('Close')}
            />
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
