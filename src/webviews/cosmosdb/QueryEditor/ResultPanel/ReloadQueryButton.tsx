/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArrowClockwiseFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback, useMemo } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const ReloadQueryButton = forwardRef(function ReloadQueryButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const isDisabled = !state.isConnected || !state.currentExecutionId;

    const reloadData = useCallback(() => {
        void dispatcher.runQuery(state.queryHistory[state.queryHistory.length - 1], {
            countPerPage: state.pageSize,
            sessionId: state.currentExecutionId,
        });
    }, [dispatcher, state]);

    const hotkey = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'resultPanel',
                'Refresh',
            ),
        [],
    );

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('resultPanel', 'Refresh', reloadData, {
        disabled: isDisabled,
    });

    return (
        <>
            <ToolbarOverflowButton
                ariaLabel={l10n.t('Reload query results')}
                content={l10n.t('Refresh')}
                disabled={isDisabled}
                icon={<ArrowClockwiseFilled />}
                hotkey={hotkey}
                onClick={reloadData}
                refs={ref}
                showButtonText={false}
                tooltip={l10n.t('Reload query results')}
                type={props.type}
            />
        </>
    );
});
