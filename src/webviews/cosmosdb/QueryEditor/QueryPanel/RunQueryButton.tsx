/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    type MenuButtonProps,
    MenuItem,
    MenuPopover,
    MenuTrigger,
    SplitButton,
    Tooltip,
} from '@fluentui/react-components';
import { PlayRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback, useMemo } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const RunQueryButton = forwardRef(function RunQueryButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const isDisabled = !state.isConnected || state.isExecuting;

    const truncateString = (str: string, maxLength: number) => {
        if (str.length > maxLength) {
            return str.slice(0, maxLength - 1) + '…';
        }
        return str;
    };

    const runQuery = useCallback(
        async (event?: KeyboardEvent) => {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }

            if (state.querySelectedValue) {
                return dispatcher.runQuery(state.querySelectedValue, { countPerPage: state.pageSize });
            }

            return dispatcher.runQuery(state.queryValue, { countPerPage: state.pageSize });
        },
        [dispatcher, state],
    );

    const [runQueryHotkeyTooltip, runQueryHotkeyMenu] = useMemo(() => {
        const title = HotkeyCommandService.getInstance<
            QueryEditorHotkeyScope,
            QueryEditorHotkeyCommand
        >().getShortcutDisplay('queryEditor', 'ExecuteQuery');
        return [title ? ` (${title})` : '', title ?? ''];
    }, []);

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('queryEditor', 'ExecuteQuery', runQuery, {
        disabled: isDisabled,
    });

    return (
        <Menu>
            <MenuTrigger>
                {props.type === 'button' ? (
                    (triggerProps: MenuButtonProps) => (
                        <Tooltip
                            content={l10n.t('Execute query') + runQueryHotkeyTooltip}
                            relationship="description"
                            appearance="inverted"
                        >
                            <SplitButton
                                ref={ref}
                                aria-label={l10n.t('Execute query')}
                                icon={<PlayRegular />}
                                disabled={isDisabled}
                                appearance={'primary'}
                                menuButton={{
                                    ...triggerProps,
                                    'aria-label': l10n.t('Show history of previous queries'),
                                }}
                                primaryActionButton={{ onClick: () => void runQuery() }}
                            >
                                {l10n.t('Run')}
                            </SplitButton>
                        </Tooltip>
                    )
                ) : (
                    <MenuItem
                        aria-label={l10n.t('Execute query')}
                        secondaryContent={runQueryHotkeyMenu}
                        icon={<PlayRegular />}
                        disabled={isDisabled}
                        onClick={() => void runQuery()}
                    >
                        {l10n.t('Run')}
                    </MenuItem>
                )}
            </MenuTrigger>
            <MenuPopover>
                {state.queryHistory.length === 0 && <MenuItem disabled>{l10n.t('No history')}</MenuItem>}
                {state.queryHistory.length > 0 &&
                    state.queryHistory.map((query, index) => (
                        <MenuItem onClick={() => dispatcher.insertText(query)} key={index}>
                            {truncateString(query, 50)}
                        </MenuItem>
                    ))}
            </MenuPopover>
        </Menu>
    );
});
