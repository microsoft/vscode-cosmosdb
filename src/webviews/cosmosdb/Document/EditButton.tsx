/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import type React from 'react';
import { type ForwardedRef, forwardRef, useCallback, useMemo } from 'react';
import { ToolbarOverflowButton } from '../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../common/ToolbarOverflow/ToolbarOverflowItem';
import { HotkeyCommandService, useCommandHotkey } from '../../common/hotkeys';
import { type DocumentHotkeyCommand, type DocumentHotkeyScope } from './DocumentHotkeys';
import { useDocumentDispatcher, useDocumentState } from './state/DocumentContext';

export const EditButton = forwardRef(function EditButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
    const state = useDocumentState();
    const dispatcher = useDocumentDispatcher();

    const isEditDisabled = state.mode !== 'view';

    const hotkey = useMemo(
        () =>
            HotkeyCommandService.getInstance<DocumentHotkeyScope, DocumentHotkeyCommand>().getShortcutDisplay(
                'global',
                'EditDocument',
            ),
        [],
    );

    const onEdit = useCallback(
        async (event?: KeyboardEvent | MouseEvent | React.MouseEvent) => {
            // Open document for editing
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            await dispatcher.setMode('edit');
        },
        [dispatcher],
    );

    useCommandHotkey<DocumentHotkeyScope, DocumentHotkeyCommand>('global', 'EditDocument', onEdit, {
        disabled: isEditDisabled,
    });

    return (
        <ToolbarOverflowButton
            type={props.type}
            refs={ref}
            ariaLabel={l10n.t('Open item for editing')}
            onClick={onEdit}
            icon={<EditRegular />}
            content={l10n.t('Edit')}
            hotkey={hotkey}
            tooltip={l10n.t('Open item for editing')}
            disabled={isEditDisabled}
            toolbarButtonProps={{
                appearance: 'primary',
            }}
        />
    );
});
