/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArrowClockwiseFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback, useMemo, useState } from 'react';
import { AlertDialog } from '../../../common/AlertDialog';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const ReloadQueryButton = forwardRef(function ReloadQueryButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const [isOpen, setIsOpen] = useState(false);

    const isDisabled = !state.isConnected || !state.currentExecutionId;

    const handleDialogClose = useCallback(
        (confirmed: boolean) => {
            if (confirmed) {
                void dispatcher.runQuery(state.queryHistory[state.queryHistory.length - 1], {
                    countPerPage: state.pageSize,
                });
            }
            setIsOpen(false);
        },
        [dispatcher, state],
    );

    const reloadData = useCallback(() => setIsOpen(true), []);

    const hotkey = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'resultPanel',
                'Refresh',
            ),
        [],
    );

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('resultPanel', 'Refresh', reloadData, {
        disabled: isDisabled,
    });

    return (
        <>
            <AlertDialog
                isOpen={isOpen}
                onClose={handleDialogClose}
                title={l10n.t('Attention')}
                confirmButtonText={l10n.t('Continue')}
                cancelButtonText={l10n.t('Close')}
            >
                <div>{l10n.t('All loaded data will be lost. The query will be executed again in new session.')}</div>
                <div>{l10n.t('Are you sure you want to continue?')}</div>
            </AlertDialog>
            <ToolbarOverflowButton
                ariaLabel={l10n.t('Reload query results')}
                content={l10n.t('Refresh')}
                disabled={isDisabled}
                icon={<ArrowClockwiseFilled />}
                hotkey={hotkey}
                onClick={reloadData}
                refs={ref}
                showButtonText={false}
                tooltip={l10n.t('Reload query results')}
                type={props.type}
            />
        </>
    );
});
