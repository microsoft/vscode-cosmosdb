/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ToolbarButtonProps } from '@fluentui/react-components';
import { EditRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { getShortcutDisplay, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope, ResultPanelHotkeys } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { getSelectedDocumentIds } from './getSelectedDocumentIds';

export const EditItemButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const isEditDisabled = !state.isEditMode || state.selectedRows.length === 0 || state.isExecuting;

    const getSelectedDocuments = useCallback(
        () => getSelectedDocumentIds(state.selectedRows, state.currentQueryResult, state.partitionKey),
        [state],
    );

    const editSelectedItem = useCallback(
        () => dispatcher.openDocuments('edit', getSelectedDocuments()),
        [dispatcher, getSelectedDocuments],
    );

    const editItemHotkeyTooltip = useMemo(() => getShortcutDisplay(ResultPanelHotkeys, 'EditItem'), []);

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
            toolbarButtonProps={{ 'data-quickstart': 'edit-item' } as ToolbarButtonProps}
        />
    );
};
