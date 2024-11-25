/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type OptionOnSelectData } from '@fluentui/react-combobox';
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    Dropdown,
    Label,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Option,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    Tooltip,
    useRestoreFocusTarget,
} from '@fluentui/react-components';
import {
    ArrowClockwiseFilled,
    ArrowDownloadRegular,
    ArrowLeftFilled,
    ArrowPreviousFilled,
    ArrowRightFilled,
    DocumentCopyRegular,
} from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { DEFAULT_PAGE_SIZE } from '../../../docdb/types/queryResult';
import { Timer } from '../../Timer';
import { queryMetricsToCsv, queryMetricsToJSON, queryResultToCsv, queryResultToJSON } from '../../utils';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export type ResultToolbarProps = { selectedTab: string };

export type AlertDialogProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    doAction: () => Promise<void>;
};

const ToolbarDividerTransparent = () => {
    return <div style={{ padding: '4px' }} />;
};

const ToolbarGroupSave = ({ selectedTab }: ResultToolbarProps) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const hasSelection = state.selectedRows.length > 1; // If one document selected, it's not a selection
    const tooltipClipboardContent = hasSelection
        ? 'Copy selected documents to clipboard'
        : 'Copy all results from the current page to clipboard';
    const tooltipExportContent = hasSelection
        ? 'Export selected documents'
        : 'Export all results from the current page';

    async function onSaveToClipboardAsCSV() {
        if (selectedTab === 'result__tab') {
            await dispatcher.copyToClipboard(
                queryResultToCsv(
                    state.currentQueryResult,
                    state.partitionKey,
                    hasSelection ? state.selectedRows : undefined,
                ),
            );
        }

        if (selectedTab === 'stats__tab') {
            await dispatcher.copyToClipboard(queryMetricsToCsv(state.currentQueryResult));
        }
    }

    async function onSaveToClipboardAsJSON() {
        if (selectedTab === 'result__tab') {
            await dispatcher.copyToClipboard(
                queryResultToJSON(state.currentQueryResult, hasSelection ? state.selectedRows : undefined),
            );
        }

        if (selectedTab === 'stats__tab') {
            await dispatcher.copyToClipboard(queryMetricsToJSON(state.currentQueryResult));
        }
    }

    async function onSaveAsCSV() {
        const filename = `${state.dbName}_${state.collectionName}_${state.currentQueryResult?.activityId ?? 'query'}`;
        if (selectedTab === 'result__tab') {
            await dispatcher.saveToFile(
                queryResultToCsv(
                    state.currentQueryResult,
                    state.partitionKey,
                    hasSelection ? state.selectedRows : undefined,
                ),
                `${filename}_result`,
                'csv',
            );
        }

        if (selectedTab === 'stats__tab') {
            await dispatcher.saveToFile(queryMetricsToCsv(state.currentQueryResult), `${filename}_stats`, 'csv');
        }
    }

    async function onSaveAsJSON() {
        const filename = `${state.dbName}_${state.collectionName}_${state.currentQueryResult?.activityId ?? 'query'}`;
        if (selectedTab === 'result__tab') {
            await dispatcher.saveToFile(
                queryResultToJSON(state.currentQueryResult, hasSelection ? state.selectedRows : undefined),
                `${filename}_result`,
                'json',
            );
        }

        if (selectedTab === 'stats__tab') {
            await dispatcher.saveToFile(queryMetricsToJSON(state.currentQueryResult), `${filename}_stats`, 'json');
        }
    }

    return (
        <>
            <Menu>
                <MenuTrigger>
                    <Tooltip content={tooltipClipboardContent} relationship="description" withArrow>
                        <ToolbarButton
                            aria-label="Copy to clipboard"
                            icon={<DocumentCopyRegular />}
                            disabled={!state.isConnected}
                        />
                    </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem onClick={() => void onSaveToClipboardAsCSV()}>CSV</MenuItem>
                        <MenuItem onClick={() => void onSaveToClipboardAsJSON()}>JSON</MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>

            <Menu>
                <MenuTrigger>
                    <Tooltip content={tooltipExportContent} relationship="description" withArrow>
                        <ToolbarButton
                            aria-label="Export"
                            icon={<ArrowDownloadRegular />}
                            disabled={!state.isConnected}
                        />
                    </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem onClick={() => void onSaveAsCSV()}>CSV</MenuItem>
                        <MenuItem onClick={() => void onSaveAsJSON()}>JSON</MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </>
    );
};

// Shows the execution time and the number of records displayed in the result panel
const ToolbarStatusBar = () => {
    const state = useQueryEditorState();

    const [time, setTime] = useState(0);

    const recordRange = state.currentExecutionId
        ? state.pageSize === -1
            ? state.currentQueryResult?.documents?.length
                ? `0 - ${state.currentQueryResult?.documents?.length}`
                : 'All'
            : `${(state.pageNumber - 1) * state.pageSize} - ${state.pageNumber * state.pageSize}`
        : `0 - 0`;

    useEffect(() => {
        let interval: NodeJS.Timeout | undefined = undefined;

        if (state.isExecuting) {
            interval = setInterval(() => {
                setTime((time) => time + 10);
            }, 10);
        } else {
            setTime(0);
            clearInterval(interval);
        }
        return () => clearInterval(interval);
    }, [state.isExecuting]);

    return (
        <div style={{ minWidth: '100px', maxWidth: '100px', textAlign: 'center' }}>
            {state.isExecuting && <Timer time={time} />}
            {!state.isExecuting && <Label weight="semibold">{recordRange}</Label>}
        </div>
    );
};

const AlertDialog = ({ open, setOpen, doAction }: AlertDialogProps) => {
    return (
        <Dialog modalType="alert" open={open} onOpenChange={(_event, data) => setOpen(data.open)}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>Attention</DialogTitle>
                    <DialogContent>
                        <div>All loaded data will be lost. The query will be executed again in new session.</div>
                        <div>Are you sure you want to continue?</div>
                    </DialogContent>

                    <DialogActions>
                        <Button appearance="secondary" onClick={() => void doAction()}>
                            Continue
                        </Button>

                        <DialogTrigger disableButtonEnhancement>
                            <Button appearance="primary">Close</Button>
                        </DialogTrigger>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

export const ResultPanelToolbar = ({ selectedTab }: ResultToolbarProps) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const restoreFocusTargetAttribute = useRestoreFocusTarget();

    const hasMoreResults = state.currentQueryResult?.hasMoreResults ?? false;
    const toFirstPageDisabled =
        state.pageNumber === 1 || !state.isConnected || state.isExecuting || !state.currentExecutionId;
    const toPrevPageDisabled =
        state.pageNumber === 1 || !state.isConnected || state.isExecuting || !state.currentExecutionId;
    const toNextPageDisabled =
        state.pageSize === -1 || // Disable if page size is set to 'All'
        !state.isConnected ||
        state.isExecuting ||
        !state.currentExecutionId ||
        !hasMoreResults;

    const [open, setOpen] = useState(false);
    const [doAction, setDoAction] = useState<() => Promise<void>>(() => async () => {});

    async function nextPage() {
        await dispatcher.nextPage(state.currentExecutionId);
    }

    async function prevPage() {
        await dispatcher.prevPage(state.currentExecutionId);
    }

    async function firstPage() {
        await dispatcher.firstPage(state.currentExecutionId);
    }

    function reloadData() {
        setOpen(true);
        setDoAction(() => async () => {
            setOpen(false);
            await dispatcher.runQuery(state.queryHistory[state.queryHistory.length - 1], {
                countPerPage: state.pageSize,
            });
        });
    }

    function onOptionSelect(data: OptionOnSelectData) {
        const parsedValue = parseInt(data.optionValue ?? '', 10);
        const countPerPage = isFinite(parsedValue) ? parsedValue : -1;
        if (!state.currentExecutionId) {
            // The result is not loaded yet, just set the page size
            dispatcher.setPageSize(countPerPage);
            return;
        }

        setOpen(true);
        setDoAction(() => async () => {
            setOpen(false);
            dispatcher.setPageSize(countPerPage);
            await dispatcher.runQuery(state.queryHistory[state.queryHistory.length - 1], { countPerPage });
        });
    }

    return (
        <>
            <AlertDialog open={open} setOpen={setOpen} doAction={doAction} />
            <Toolbar aria-label="with Popover" size="small">
                <Tooltip content="Reload query results" relationship="description" withArrow>
                    <ToolbarButton
                        onClick={() => reloadData()}
                        aria-label="Refresh"
                        icon={<ArrowClockwiseFilled />}
                        {...restoreFocusTargetAttribute}
                        disabled={!state.isConnected || !state.currentExecutionId}
                    />
                </Tooltip>

                <ToolbarDivider />

                <Tooltip content="Go to first page" relationship="description" withArrow>
                    <ToolbarButton
                        onClick={() => void firstPage()}
                        aria-label="Go to start"
                        icon={<ArrowPreviousFilled />}
                        disabled={toFirstPageDisabled}
                    />
                </Tooltip>

                <Tooltip content="Go to previous page" relationship="description" withArrow>
                    <ToolbarButton
                        onClick={() => void prevPage()}
                        aria-label="Go to previous page"
                        icon={<ArrowLeftFilled />}
                        disabled={toPrevPageDisabled}
                    />
                </Tooltip>

                <Tooltip content="Go to next page (Load more)" relationship="description" withArrow>
                    <ToolbarButton
                        onClick={() => void nextPage()}
                        aria-label="Go to next page"
                        icon={<ArrowRightFilled />}
                        disabled={toNextPageDisabled}
                    />
                </Tooltip>

                <ToolbarDividerTransparent />

                <Tooltip content="Change page size" relationship="description" withArrow>
                    <Dropdown
                        onOptionSelect={(_event, data) => onOptionSelect(data)}
                        style={{ minWidth: '100px', maxWidth: '100px' }}
                        defaultValue={DEFAULT_PAGE_SIZE.toString()}
                        defaultSelectedOptions={[DEFAULT_PAGE_SIZE.toString()]}
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
                            All
                        </Option>
                    </Dropdown>
                </Tooltip>

                <ToolbarDivider />

                <ToolbarStatusBar />

                <ToolbarDivider />

                <ToolbarGroupSave selectedTab={selectedTab} />
            </Toolbar>
        </>
    );
};
