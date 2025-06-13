/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AddFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { type ToolbarOverflowItemProps } from '../OverflowToolbarItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { ToolbarOverflowButton } from '../ToolbarOverflowButton';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const NewItemButton = (props: ToolbarOverflowItemProps) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const addNewItem = useCallback(() => dispatcher.openDocument('add'), [dispatcher]);

    const isDisabled = state.isExecuting;

    const newItemHotkeyTooltip = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'resultPanel',
                'NewItem',
            ),
        [],
    );
    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('resultPanel', 'NewItem', addNewItem);

    return (
        <ToolbarOverflowButton
            ariaLabel={l10n.t('Add new item')}
            content={l10n.t('Add new item')}
            disabled={isDisabled}
            icon={<AddFilled />}
            hotkey={newItemHotkeyTooltip}
            onClick={addNewItem}
            showButtonText={false}
            tooltip={l10n.t('Add new item in separate tab')}
            type={props.type}
        />
    );
};
