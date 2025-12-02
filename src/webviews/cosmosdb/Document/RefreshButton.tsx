/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import type React from 'react';
import { useCallback, useMemo } from 'react';
import { ToolbarOverflowButton } from '../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../common/ToolbarOverflow/ToolbarOverflowItem';
import { HotkeyCommandService, useCommandHotkey } from '../../common/hotkeys';
import { type DocumentHotkeyCommand, type DocumentHotkeyScope } from './DocumentHotkeys';
import { useDocumentDispatcher, useDocumentState } from './state/DocumentContext';

export const RefreshButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const state = useDocumentState();
    const dispatcher = useDocumentDispatcher();
    const { ref, type } = props;

    const inProgress = state.isSaving || state.isRefreshing;
    const hasDocumentInDB = state.documentId !== '';
    const isRefreshDisabled = inProgress || !hasDocumentInDB;

    const hotkey = useMemo(
        () =>
            HotkeyCommandService.getInstance<DocumentHotkeyScope, DocumentHotkeyCommand>().getShortcutDisplay(
                'global',
                'Refresh',
            ),
        [],
    );

    const onRefresh = useCallback(
        async (event?: KeyboardEvent | MouseEvent | React.MouseEvent) => {
            // Reload original document from the database
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }

            await dispatcher.refreshDocument();
        },
        [dispatcher],
    );

    useCommandHotkey<DocumentHotkeyScope, DocumentHotkeyCommand>('global', 'Refresh', onRefresh, {
        disabled: isRefreshDisabled,
    });

    return (
        <>
            <ToolbarOverflowButton
                type={type}
                ref={ref}
                ariaLabel={l10n.t('Reload original item from the database')}
                onClick={onRefresh}
                icon={<ArrowClockwiseRegular />}
                content={l10n.t('Refresh')}
                hotkey={hotkey}
                tooltip={l10n.t('Reload original item from the database')}
                disabled={isRefreshDisabled}
            />
        </>
    );
};
