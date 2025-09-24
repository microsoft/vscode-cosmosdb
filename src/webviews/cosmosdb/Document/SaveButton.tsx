/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SaveRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import type React from 'react';
import { useCallback, useMemo } from 'react';
import { ToolbarOverflowButton } from '../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../common/ToolbarOverflow/ToolbarOverflowItem';
import { HotkeyCommandService, useCommandHotkey } from '../../common/hotkeys';
import { type DocumentHotkeyCommand, type DocumentHotkeyScope } from './DocumentHotkeys';
import { useDocumentDispatcher, useDocumentState } from './state/DocumentContext';

export const SaveButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const state = useDocumentState();
    const dispatcher = useDocumentDispatcher();

    const isSaveDisabled = state.isSaving || state.isRefreshing || !state.isDirty || !state.isValid;

    const hotkey = useMemo(
        () =>
            HotkeyCommandService.getInstance<DocumentHotkeyScope, DocumentHotkeyCommand>().getShortcutDisplay(
                'global',
                'SaveDocument',
            ),
        [],
    );

    const onSave = useCallback(
        async (event?: KeyboardEvent | MouseEvent | React.MouseEvent) => {
            // Save document to the database
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            await dispatcher.saveDocument(state.currentDocumentContent);
        },
        [dispatcher, state],
    );

    const onSaveAs = useCallback(
        async (event?: KeyboardEvent | MouseEvent | React.MouseEvent) => {
            // Save document as json file, but we have to save actual content, not currentDocumentContent
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            await dispatcher.saveDocumentAsFile(state.documentContent);
        },
        [dispatcher, state],
    );

    useCommandHotkey<DocumentHotkeyScope, DocumentHotkeyCommand>('global', 'SaveDocument', onSave, {
        disabled: isSaveDisabled,
    });

    useCommandHotkey<DocumentHotkeyScope, DocumentHotkeyCommand>('global', 'SaveToDisk', onSaveAs, {
        disabled: isSaveDisabled,
    });

    return (
        <ToolbarOverflowButton
            type={props.type}
            ref={props.ref}
            ariaLabel={l10n.t('Save item to the database')}
            onClick={onSave}
            icon={<SaveRegular />}
            content={l10n.t('Save')}
            hotkey={hotkey}
            tooltip={l10n.t('Save item to the database')}
            disabled={isSaveDisabled}
        />
    );
};
