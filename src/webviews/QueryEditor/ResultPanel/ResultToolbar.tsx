import { type OptionOnSelectData, type SelectionEvents } from '@fluentui/react-combobox';
import {
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
} from '@fluentui/react-components';
import {
    ArrowClockwiseFilled,
    ArrowDownloadRegular,
    ArrowLeftFilled,
    ArrowPreviousFilled,
    ArrowRightFilled,
    DocumentCopyRegular,
} from '@fluentui/react-icons';
import { queryMetricsToCsv, queryMetricsToTable, queryResultToCsv, queryResultToJson } from '../../utils';
import { DEFAULT_PAGE_SIZE, useQueryEditorDispatcher, useQueryEditorState } from '../QueryEditorContext';

const ToolbarDividerTransparent = () => {
    return <div style={{ padding: '4px' }} />;
};

export const ResultToolbar = ({ selectedTab }: { selectedTab: string }) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    function nextPage() {
        dispatcher.setPageNumber(state.pageNumber + 1);
    }

    function prevPage() {
        dispatcher.setPageNumber(state.pageNumber - 1);
    }

    function firstPage() {
        dispatcher.setPageNumber(1);
    }

    function onOptionSelect(_event: SelectionEvents, data: OptionOnSelectData) {
        dispatcher.setPageSize(parseInt(data.optionText ?? '', 10) ?? -1);
    }

    async function onSaveAsCSV() {
        if (selectedTab === 'result__tab') {
            await dispatcher.saveToFile(queryResultToCsv(state.currentQueryResult), 'csv');
        }

        if (selectedTab === 'stats__tab') {
            await dispatcher.saveToFile(queryMetricsToCsv(state.currentQueryResult), 'csv');
        }
    }

    async function onSaveAsJSON() {
        if (selectedTab === 'result__tab') {
            await dispatcher.saveToFile(queryResultToJson(state.currentQueryResult), 'json');
        }

        if (selectedTab === 'stats__tab') {
            await dispatcher.saveToFile(JSON.stringify(queryMetricsToTable(state.currentQueryResult), null, 4), 'json');
        }
    }

    return (
        <Toolbar aria-label="with Popover" size="small">
            <Tooltip content="Reload query results" relationship="description" withArrow>
                <ToolbarButton aria-label="Refresh" icon={<ArrowClockwiseFilled />} />
            </Tooltip>

            <ToolbarDivider />

            <Tooltip content="Go to first page" relationship="description" withArrow>
                <ToolbarButton
                    onClick={firstPage}
                    aria-label="Go to start"
                    icon={<ArrowPreviousFilled />}
                    disabled={state.pageNumber === 1}
                />
            </Tooltip>

            <Tooltip content="Go to previous page" relationship="description" withArrow>
                <ToolbarButton
                    onClick={prevPage}
                    aria-label="Go to previous page"
                    icon={<ArrowLeftFilled />}
                    disabled={state.pageNumber === 1}
                />
            </Tooltip>

            <Tooltip content="Go to next page (Load more)" relationship="description" withArrow>
                <ToolbarButton
                    onClick={nextPage}
                    aria-label="Go to next page"
                    icon={<ArrowRightFilled />}
                    disabled={state.pageSize === -1} // Disable if page size is set to 'All'
                />
            </Tooltip>

            <ToolbarDividerTransparent />

            <Tooltip content="Change page size" relationship="description" withArrow>
                <Dropdown
                    onOptionSelect={onOptionSelect}
                    style={{ minWidth: '100px', maxWidth: '100px' }}
                    defaultValue={DEFAULT_PAGE_SIZE.toString()}
                    defaultSelectedOptions={[DEFAULT_PAGE_SIZE.toString()]}>
                    <Option key="10">10</Option>
                    <Option key="10">50</Option>
                    <Option key="100">100</Option>
                    <Option key="500">500</Option>
                    <Option key="All">All</Option>
                </Dropdown>
            </Tooltip>

            <ToolbarDivider />

            <Label weight="semibold" style={{ minWidth: '100px', maxWidth: '100px', textAlign: 'center' }}>
                {state.currentQueryResult
                    ? `${(state.pageNumber - 1) * state.pageSize} - ${state.pageNumber * state.pageSize}`
                    : `0 - 0`}
            </Label>

            <ToolbarDivider />

            <Tooltip content="Copy to clipboard" relationship="description" withArrow>
                <ToolbarButton aria-label="Copy to clipboard" icon={<DocumentCopyRegular />} />
            </Tooltip>

            <Tooltip content="Export results" relationship="description" withArrow>
                <Menu>
                    <MenuTrigger>
                        <ToolbarButton aria-label="Export" icon={<ArrowDownloadRegular />} />
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem onClick={() => void onSaveAsCSV()}>CSV</MenuItem>
                            <MenuItem onClick={() => void onSaveAsJSON()}>JSON</MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            </Tooltip>
        </Toolbar>
    );
};
