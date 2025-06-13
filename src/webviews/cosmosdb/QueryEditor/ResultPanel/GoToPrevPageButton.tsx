/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ForwardedRef, forwardRef, useCallback, useMemo } from 'react';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import  { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { ArrowLeftFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import  { type ToolbarOverflowItemProps } from '../OverflowToolbarItem';
import { ToolbarOverflowButton } from '../ToolbarOverflowButton';

export const GoToPrevPageButton = forwardRef( function GoToPrevPageButton(props: ToolbarOverflowItemProps, ref: ForwardedRef<HTMLButtonElement>)  {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const isDisabled = state.pageNumber === 1 || !state.isConnected || state.isExecuting || !state.currentExecutionId;

    const prevPage = useCallback(() => dispatcher.prevPage(state.currentExecutionId), [dispatcher, state]);

    const hotkey = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'resultPanel',
                'SwitchToPreviousPage',
            ),
        [],
    );
    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>(
        'resultPanel',
        'SwitchToPreviousPage',
        prevPage,
        { disabled: isDisabled },
    );

    return (
        <ToolbarOverflowButton
            ariaLabel={l10n.t('Go to previous page')}
            content={l10n.t('Go to previous page')}
            disabled={isDisabled}
            icon={<ArrowLeftFilled />}
            onClick={prevPage}
            hotkey={hotkey}
            refs={ref}
            showButtonText={false}
            tooltip={l10n.t('Go to previous page')}
            type={props.type}
        />
    );
});
