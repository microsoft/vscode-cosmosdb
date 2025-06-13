/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SaveRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback, useMemo } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { type ToolbarOverflowItemProps } from '../OverflowToolbarItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { ToolbarOverflowButton } from '../ToolbarOverflowButton';

export const SaveToFileButton = forwardRef(function SaveToFileButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const saveToFile = useCallback(
        (event?: KeyboardEvent) => {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }

            return dispatcher.saveToFile(state.queryValue, 'New query', 'nosql');
        },
        [dispatcher, state],
    );

    const saveToFileHotkeyTooltip = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'queryEditor',
                'SaveToDisk',
            ),
        [],
    );

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('queryEditor', 'SaveToDisk', saveToFile);

    return (
        <ToolbarOverflowButton
            type={props.type}
            refs={ref}
            ariaLabel={l10n.t('Save query')}
            onClick={saveToFile}
            icon={<SaveRegular />}
            content={l10n.t('Save')}
            hotkey={saveToFileHotkeyTooltip}
            tooltip={l10n.t('Save query to the disk')}
        />
    );
});
