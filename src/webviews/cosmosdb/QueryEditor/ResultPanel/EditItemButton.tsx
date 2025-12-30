/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const EditItemButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const executionId = state.currentExecutionId;
    const isEditDisabled = !state.isEditMode || state.selectedRows.length === 0 || state.isExecuting;

    const getSelectedDocuments = useCallback(() => {
        return state.selectedRows.filter((rowIndex) => !state.currentQueryResult?.deletedDocuments.includes(rowIndex));
    }, [state]);

    const editSelectedItem = useCallback(
        () => dispatcher.openDocuments(executionId, 'edit', getSelectedDocuments()),
        [dispatcher, executionId, getSelectedDocuments],
    );

    const editItemHotkeyTooltip = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'resultPanel',
                'EditItem',
            ),
        [],
    );

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('resultPanel', 'EditItem', editSelectedItem, {
        disabled: isEditDisabled,
    });

    return (
        <ToolbarOverflowButton
            ariaLabel={l10n.t('Edit selected item')}
            content={l10n.t('Edit item')}
            disabled={isEditDisabled}
            icon={<EditRegular />}
            hotkey={editItemHotkeyTooltip}
            onClick={editSelectedItem}
            showButtonText={false}
            tooltip={l10n.t('Edit selected item in separate tab')}
            type={props.type}
        />
    );
};
