/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Tooltip, useFocusFinders } from '@fluentui/react-components';
import { ArrowClockwiseRegular, EditRegular, SaveRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertDialog } from '../../common/AlertDialog';
import { CommandType, findHotkeyMapping, HotkeyScope, useCommandHotkey } from '../../common/hotkeys';
import { useDocumentDispatcher, useDocumentState } from './state/DocumentContext';

const ToolbarDividerTransparent = () => {
    return <div style={{ padding: '4px' }} />;
};

export const DocumentToolbar = () => {
    const state = useDocumentState();
    const dispatcher = useDocumentDispatcher();

    const { findFirstFocusable } = useFocusFinders();
    const triggerRef = useRef<HTMLElement>(findFirstFocusable(document.body) ?? null);
    const [isOpen, setIsOpen] = useState(false);
    const [action, setAction] = useState<() => Promise<void>>(() => async () => {});

    const isReady = state.isReady;
    const isReadOnly = state.mode === 'view';
    const inProgress = state.isSaving || state.isRefreshing;
    const hasDocumentInDB = state.documentId !== '';
    const isSaveDisabled = inProgress || !state.isDirty || !state.isValid;
    const isEditDisabled = !isReadOnly;
    const isRefreshDisabled = inProgress || !hasDocumentInDB;

    const isMac = useMemo(() => /Mac|iPod|iPhone|iPad/.test(navigator.userAgent), []);
    const onSaveHotkeyTitle = useMemo(() => {
        const hotkeys = findHotkeyMapping(CommandType.SaveDocument, HotkeyScope.DocumentEditor);
        return hotkeys?.[0].shortcutDisplay[isMac ? 'mac' : 'windows'] ?? '';
    }, [isMac]);
    const onEditHotkeyTitle = useMemo(() => {
        const hotkeys = findHotkeyMapping(CommandType.EditDocument, HotkeyScope.DocumentEditor);
        return hotkeys?.[0].shortcutDisplay[isMac ? 'mac' : 'windows'] ?? '';
    }, [isMac]);
    const onRefreshHotkeyTitle = useMemo(() => {
        const hotkeys = findHotkeyMapping(CommandType.Refresh, HotkeyScope.DocumentEditor);
        return hotkeys?.[0].shortcutDisplay[isMac ? 'mac' : 'windows'] ?? '';
    }, [isMac]);

    //#region Callbacks
    const stopPropagation = useCallback((event: KeyboardEvent | MouseEvent | React.MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
    }, []);

    const onSave = useCallback(
        async (event?: KeyboardEvent | MouseEvent | React.MouseEvent) => {
            // Save document to the database
            if (event) stopPropagation(event);
            await dispatcher.saveDocument(state.currentDocumentContent);
        },
        [dispatcher, state, stopPropagation],
    );

    const onSaveAs = useCallback(
        async (event?: KeyboardEvent | MouseEvent | React.MouseEvent) => {
            // Save document as json file, but we have to save actual content, not currentDocumentContent
            if (event) stopPropagation(event);
            await dispatcher.saveDocumentAsFile(state.documentContent);
        },
        [dispatcher, state, stopPropagation],
    );

    const onEdit = useCallback(
        async (event?: KeyboardEvent | MouseEvent | React.MouseEvent) => {
            // Open document for editing
            if (event) stopPropagation(event);
            await dispatcher.setMode('edit');
        },
        [dispatcher, stopPropagation],
    );

    const onRefresh = useCallback(
        async (event?: KeyboardEvent | MouseEvent | React.MouseEvent) => {
            // Reload original document from the database
            if (event) stopPropagation(event);
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
        [dispatcher, state, stopPropagation],
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
    //#endregion

    //#region Hotkeys
    // Set up the scope for this component
    useCommandHotkey(HotkeyScope.DocumentEditor, CommandType.SaveDocument, onSave, { disabled: isSaveDisabled });

    useCommandHotkey(HotkeyScope.DocumentEditor, CommandType.SaveToDisk, onSaveAs, { disabled: isSaveDisabled });

    useCommandHotkey(HotkeyScope.DocumentEditor, CommandType.EditDocument, onEdit, { disabled: isEditDisabled });

    useCommandHotkey(HotkeyScope.DocumentEditor, CommandType.Refresh, onRefresh, { disabled: isRefreshDisabled });
    //#endregion

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
            <Toolbar size={'small'}>
                {isReady && !isReadOnly && (
                    <Tooltip
                        content={l10n.t('Save item to the database') + ` (${onSaveHotkeyTitle})`}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton
                            onClick={() => void onSave()}
                            aria-label={l10n.t('Save item to the database')}
                            icon={<SaveRegular />}
                            appearance={'primary'}
                            disabled={isSaveDisabled}
                        >
                            {l10n.t('Save')}
                        </ToolbarButton>
                    </Tooltip>
                )}
                {isReady && isReadOnly && (
                    <Tooltip
                        content={l10n.t('Open item for editing') + ` (${onEditHotkeyTitle})`}
                        relationship="description"
                        withArrow
                    >
                        <ToolbarButton
                            onClick={() => void onEdit()}
                            aria-label={l10n.t('Open item for editing')}
                            icon={<EditRegular />}
                            appearance={'primary'}
                        >
                            {l10n.t('Edit')}
                        </ToolbarButton>
                    </Tooltip>
                )}

                <ToolbarDividerTransparent />

                <Tooltip
                    content={l10n.t('Reload original item from the database') + ` (${onRefreshHotkeyTitle})`}
                    relationship="description"
                    withArrow
                >
                    <ToolbarButton
                        onClick={(event) => void onRefresh(event)}
                        aria-label={l10n.t('Reload original item from the database')}
                        icon={<ArrowClockwiseRegular />}
                        disabled={isRefreshDisabled}
                    >
                        {l10n.t('Refresh')}
                    </ToolbarButton>
                </Tooltip>
            </Toolbar>
        </>
    );
};
