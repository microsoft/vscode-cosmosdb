/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EyeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { type CosmosDBRecordIdentifier } from '../../../../cosmosdb/types/queryResult';
import { getDocumentId } from '../../../../utils/document';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { type ToolbarOverflowItemProps } from '../OverflowToolbarItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { ToolbarOverflowButton } from '../ToolbarOverflowButton';

export const ViewItemButton = (props: ToolbarOverflowItemProps) => {
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

    const viewSelectedItem = useCallback(
        () => dispatcher.openDocuments('view', getSelectedDocuments()),
        [dispatcher, getSelectedDocuments],
    );

    const viewItemHotkeyTooltip = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'resultPanel',
                'ViewItem',
            ),
        [],
    );

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('resultPanel', 'ViewItem', viewSelectedItem, {
        disabled: isEditDisabled,
    });

    return (
        <ToolbarOverflowButton
            ariaLabel={l10n.t('View selected item')}
            content={l10n.t('View item')}
            disabled={isEditDisabled}
            icon={<EyeRegular />}
            hotkey={viewItemHotkeyTooltip}
            onClick={viewSelectedItem}
            showButtonText={false}
            tooltip={l10n.t('View selected item in separate tab')}
            type={props.type}
        />
    );
};
