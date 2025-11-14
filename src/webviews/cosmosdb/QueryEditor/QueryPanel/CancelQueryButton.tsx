/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import { StopRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { HotkeyCommandService, useCommandHotkey } from '../../../common/hotkeys';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { type QueryEditorHotkeyCommand, type QueryEditorHotkeyScope } from '../QueryEditorHotkeys';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

const useClasses = makeStyles({
    iconStop: {
        color: tokens.colorStatusDangerBorderActive,
    },
});

export const CancelQueryButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const classes = useClasses();
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const { ref, type } = props;

    const cancelQuery = useCallback(
        async (event?: KeyboardEvent) => {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }

            if (state.currentExecutionId) {
                return dispatcher.stopQuery(state.currentExecutionId);
            }
        },
        [dispatcher, state],
    );

    const cancelQueryHotkeyTooltip = useMemo(
        () =>
            HotkeyCommandService.getInstance<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>().getShortcutDisplay(
                'queryEditor',
                'Cancel',
            ),
        [],
    );

    useCommandHotkey<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('queryEditor', 'Cancel', cancelQuery, {
        disabled: !state.isExecuting,
    });

    return (
        <ToolbarOverflowButton
            ariaLabel={l10n.t('Cancel')}
            content={l10n.t('Cancel')}
            icon={<StopRegular className={classes.iconStop} />}
            onClick={cancelQuery}
            ref={ref}
            tooltip={l10n.t('Cancel query')}
            hotkey={cancelQueryHotkeyTooltip}
            type={type}
            disabled={!state.isExecuting}
        />
    );
};
