/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useFocusFinders } from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import type React from 'react';
import { type ForwardedRef, forwardRef, useCallback, useMemo, useRef, useState } from 'react';
import { AlertDialog } from '../../common/AlertDialog';
import { ToolbarOverflowButton } from '../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../common/ToolbarOverflow/ToolbarOverflowItem';
import { HotkeyCommandService, useCommandHotkey } from '../../common/hotkeys';
import { type DocumentHotkeyCommand, type DocumentHotkeyScope } from './DocumentHotkeys';
import { useDocumentDispatcher, useDocumentState } from './state/DocumentContext';

export const RefreshButton = forwardRef(function RefreshButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
    const state = useDocumentState();
    const dispatcher = useDocumentDispatcher();

    const { findFirstFocusable } = useFocusFinders();
    const triggerRef = useRef<HTMLElement>(findFirstFocusable(document.body) ?? null);
    const [isOpen, setIsOpen] = useState(false);
    const [action, setAction] = useState<() => Promise<void>>(() => async () => {});

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

    const handleDialogClose = useCallback(
        (confirmed: boolean) => {
            if (confirmed) {
                // Execute the action
                void action();
            }
            setIsOpen(false);
            triggerRef.current?.focus();
        },
        [action],
    );

    const onRefresh = useCallback(
        async (event?: KeyboardEvent | MouseEvent | React.MouseEvent) => {
            // Reload original document from the database
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            if (state.isDirty) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                triggerRef.current = event?.target as HTMLElement;
                setIsOpen(true);
                setAction(() => async () => {
                    await dispatcher.refreshDocument();
                });
            } else {
                await dispatcher.refreshDocument();
            }
        },
        [dispatcher, state],
    );

    useCommandHotkey<DocumentHotkeyScope, DocumentHotkeyCommand>('global', 'Refresh', onRefresh, {
        disabled: isRefreshDisabled,
    });

    return (
        <>
            <AlertDialog
                isOpen={isOpen}
                title={l10n.t('Attention')}
                confirmButtonText={l10n.t('Continue')}
                cancelButtonText={l10n.t('Close')}
                onClose={handleDialogClose}
            >
                <div>{l10n.t('Your item has unsaved changes. If you continue, these changes will be lost.')}</div>
                <div>{l10n.t('Are you sure you want to continue?')}</div>
            </AlertDialog>
            <ToolbarOverflowButton
                type={props.type}
                refs={ref}
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
});
