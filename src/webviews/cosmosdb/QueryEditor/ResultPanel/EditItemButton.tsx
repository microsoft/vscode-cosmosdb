/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { type CosmosDBRecordIdentifier } from '../../../../cosmosdb/types/queryResult';
import { getDocumentId } from '../../../../utils/document';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { type ToolbarOverflowItemProps } from '../OverflowToolbarItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { ToolbarOverflowButton } from '../ToolbarOverflowButton';

export const EditItemButton = (props: ToolbarOverflowItemProps) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const isEditDisabled = !state.isEditMode || state.selectedRows.length === 0 || state.isExecuting;

    const getSelectedDocuments = useCallback(() => {
        return state.selectedRows
            .map((rowIndex): CosmosDBRecordIdentifier | undefined => {
                const document = state.currentQueryResult?.documents[rowIndex];
                return document ? getDocumentId(document, state.partitionKey) : undefined;
            })
            .filter((document) => document !== undefined);
    }, [state]);

    const editSelectedItem = useCallback(
        () => dispatcher.openDocuments('edit', getSelectedDocuments()),
        [dispatcher, getSelectedDocuments],
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
