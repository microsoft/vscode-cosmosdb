/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ToolbarButtonProps } from '@fluentui/react-components';
import { ArrowRightFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { getShortcutDisplay, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope, ResultPanelHotkeys } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const GoToNextPageButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const label = l10n.t('Go to next page');
    const hasMoreResults = state.currentQueryResult?.hasMoreResults ?? false;
    const { ref, type } = props;
    const isDisabled =
        state.pageSize === -1 || // Disable if page size is set to 'All'
        !state.isConnected ||
        state.isChangingConnection ||
        state.isExecuting ||
        !state.currentExecutionId ||
        !hasMoreResults;

    const nextPage = useCallback(() => dispatcher.nextPage(state.currentExecutionId), [dispatcher, state]);

    const hotkey = useMemo(() => getShortcutDisplay(ResultPanelHotkeys, 'SwitchToNextPage'), []);
    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('resultPanel', 'SwitchToNextPage', nextPage, {
        disabled: isDisabled,
    });

    return (
        <ToolbarOverflowButton
            ariaLabel={type === 'menuitem' ? label : l10n.t('Go to next page (Load more)')}
            content={label}
            disabled={isDisabled}
            icon={<ArrowRightFilled />}
            hotkey={hotkey}
            onClick={nextPage}
            ref={ref}
            showButtonText={false}
            tooltip={l10n.t('Go to next page (Load more)')}
            type={type}
            toolbarButtonProps={{ 'data-quickstart': 'pagination' } as ToolbarButtonProps}
        />
    );
};
