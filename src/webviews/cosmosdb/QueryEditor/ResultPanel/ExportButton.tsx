/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowDownloadRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback, useMemo } from 'react';
import { queryMetricsToJSON, queryResultToJSON } from '../../../../utils/convertors';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const ExportButton = forwardRef(function ExportButton(
    props: ToolbarOverflowItemProps & { selectedTab: string },
    ref: ForwardedRef<HTMLButtonElement>,
) {
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
            return dispatcher.saveCSV(`${filename}_result`, state.currentQueryResult, state.partitionKey, selectedRows);
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

    const [exportHotkeyTooltip, exportHotkeyMenu] = useMemo(() => {
        const title = HotkeyCommandService.getInstance<
            QueryEditorHotkeyScope,
            QueryEditorHotkeyCommand
        >().getShortcutDisplay('resultPanel', 'SaveToDisk');
        return [title ? ` (${title})` : '', title ?? ''];
    }, []);

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('resultPanel', 'SaveToDisk', onSaveAsJSON, {
        disabled: !state.isConnected,
    });

    return (
        <Menu>
            <MenuTrigger>
                {props.type === 'button' ? (
                    <Tooltip
                        content={tooltipExportContent + exportHotkeyTooltip}
                        relationship="label"
                        appearance="inverted"
                        withArrow
                    >
                        <ToolbarButton
                            ref={ref}
                            aria-label={l10n.t('Export')}
                            icon={<ArrowDownloadRegular />}
                            disabled={!state.isConnected}
                        />
                    </Tooltip>
                ) : (
                    <MenuItem
                        aria-label="Export"
                        secondaryContent={exportHotkeyMenu}
                        icon={<ArrowDownloadRegular />}
                        disabled={!state.isConnected}
                    >
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
});
