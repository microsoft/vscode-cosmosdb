/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArrowLeftFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const GoToPrevPageButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
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
            ref={props.ref}
            showButtonText={false}
            tooltip={l10n.t('Go to previous page')}
            type={props.type}
        />
    );
};
