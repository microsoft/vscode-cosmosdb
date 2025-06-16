/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FolderOpenRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback, useMemo } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher } from '../state/QueryEditorContext';

export const OpenFileButton = forwardRef(function OpenFileButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
    const dispatcher = useQueryEditorDispatcher();

    const openFile = useCallback(
        (event?: KeyboardEvent) => {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }

            return dispatcher.openFile();
        },
        [dispatcher],
    );

    const openFileHotkeyTooltip = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'queryEditor',
                'OpenQuery',
            ),
        [],
    );

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('queryEditor', 'OpenQuery', openFile);

    return (
        <ToolbarOverflowButton
            type={props.type}
            refs={ref}
            ariaLabel={l10n.t('Open')}
            onClick={openFile}
            icon={<FolderOpenRegular />}
            content={l10n.t('Open')}
            hotkey={openFileHotkeyTooltip}
            tooltip={l10n.t('Open query from the disk')}
        />
    );
});
