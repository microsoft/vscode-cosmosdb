/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArrowRightFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback, useMemo } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const GoToNextPageButton = forwardRef(function GoToNextPageButtonGoToNextPageButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
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

    const hotkey = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'resultPanel',
                'SwitchToNextPage',
            ),
        [],
    );
    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('resultPanel', 'SwitchToNextPage', nextPage, {
        disabled: isDisabled,
    });

    return (
        <ToolbarOverflowButton
            ariaLabel={l10n.t('Go to next page (Load more)')}
            content={l10n.t('Go to next page')}
            disabled={isDisabled}
            icon={<ArrowRightFilled />}
            hotkey={hotkey}
            onClick={nextPage}
            refs={ref}
            showButtonText={false}
            tooltip={l10n.t('Go to next page (Load more)')}
            type={props.type}
        />
    );
});
