/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeleteRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { type CosmosDBRecordIdentifier } from '../../../../cosmosdb/types/queryResult';
import { getDocumentId } from '../../../../utils/document';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const DeleteItemButton = (props: ToolbarOverflowItemProps) => {
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

    const deleteSelectedItem = useCallback(() => {
        const selectedDocuments = getSelectedDocuments();
        if (selectedDocuments.length === 1) {
            void dispatcher.deleteDocument(selectedDocuments[0]);
        } else {
            void dispatcher.deleteDocuments(selectedDocuments);
        }
    }, [dispatcher, getSelectedDocuments]);

    const deleteItemHotkeyTooltip = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'resultPanel',
                'DeleteItem',
            ),
        [],
    );

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>(
        'resultPanel',
        'DeleteItem',
        deleteSelectedItem,
        { disabled: isEditDisabled },
    );

    return (
        <ToolbarOverflowButton
            ariaLabel={l10n.t('Delete selected item(s)')}
            content={l10n.t('Delete item')}
            disabled={isEditDisabled}
            icon={<DeleteRegular />}
            hotkey={deleteItemHotkeyTooltip}
            onClick={deleteSelectedItem}
            showButtonText={false}
            tooltip={l10n.t('Delete selected item(s)')}
            type={props.type ?? 'button'}
        />
    );
};
