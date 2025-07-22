/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { DocumentCopyRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback, useMemo } from 'react';
import { queryMetricsToJSON, queryResultToJSON } from '../../../../utils/convertors';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const CopyToClipboardButton = forwardRef(function CopyToClipboardButton(
    props: ToolbarOverflowItemProps & { selectedTab: string },
    ref: ForwardedRef<HTMLButtonElement>,
) {
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

    const [copyToClipboardHotkeyTooltip, copyToClipboardHotkeyMenu] = useMemo(() => {
        const title = HotkeyCommandService.getInstance<
            QueryEditorHotkeyScope,
            QueryEditorHotkeyCommand
        >().getShortcutDisplay('resultPanel', 'CopyToClipboard');
        return [title ? ` (${title})` : '', title ?? ''];
    }, []);

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>(
        'resultPanel',
        'CopyToClipboard',
        onSaveToClipboardAsJSON,
        {
            disabled: !state.isConnected,
        },
    );

    return (
        <Menu>
            <MenuTrigger>
                {props.type === 'button' ? (
                    <Tooltip
                        content={tooltipClipboardContent + copyToClipboardHotkeyTooltip}
                        relationship="label"
                        appearance="inverted"
                        withArrow
                    >
                        <ToolbarButton
                            ref={ref}
                            aria-label={tooltipClipboardContent}
                            icon={<DocumentCopyRegular />}
                            disabled={!state.isConnected}
                        />
                    </Tooltip>
                ) : (
                    <MenuItem
                        aria-label={l10n.t('Copy to clipboard')}
                        icon={<DocumentCopyRegular />}
                        secondaryContent={copyToClipboardHotkeyMenu}
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
});
