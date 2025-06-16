/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArrowPreviousFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback, useMemo } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const GoToFirstPageButton = forwardRef(function GoToFirstPageButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const isDisabled = state.pageNumber === 1 || !state.isConnected || state.isExecuting || !state.currentExecutionId;

    const firstPage = useCallback(() => dispatcher.firstPage(state.currentExecutionId), [dispatcher, state]);

    const hotkey = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'resultPanel',
                'SwitchToFirstPage',
            ),
        [],
    );
    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('resultPanel', 'SwitchToFirstPage', firstPage, {
        disabled: isDisabled,
    });

    return (
        <ToolbarOverflowButton
            ariaLabel={l10n.t('Go to first page')}
            content={l10n.t('Go to first page')}
            disabled={isDisabled}
            icon={<ArrowPreviousFilled />}
            hotkey={hotkey}
            onClick={firstPage}
            refs={ref}
            showButtonText={false}
            tooltip={l10n.t('Go to first page')}
            type={props.type}
        />
    );
});
