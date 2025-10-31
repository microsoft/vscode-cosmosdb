/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TabDesktopMultipleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const DuplicateTabButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const { ref, type } = props;

    const duplicateTab = useCallback(
        (event?: KeyboardEvent) => {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }

            return dispatcher.duplicateTab(state.queryValue);
        },
        [dispatcher, state],
    );

    const duplicateTabHotkeyTooltip = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'global',
                'DuplicateQueryEditor',
            ),
        [],
    );

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('global', 'DuplicateQueryEditor', duplicateTab, {
        disabled: !state.isConnected,
    });

    return (
        <ToolbarOverflowButton
            type={type}
            ref={ref}
            ariaLabel={l10n.t('Duplicate')}
            onClick={duplicateTab}
            icon={<TabDesktopMultipleRegular />}
            content={l10n.t('Duplicate')}
            hotkey={duplicateTabHotkeyTooltip}
            tooltip={l10n.t('Duplicate query editor tab')}
            disabled={!state.isConnected}
        />
    );
};
