/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import { DatabasePlugConnectedRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback } from 'react';
import { type ToolbarOverflowItemProps } from '../OverflowToolbarItem';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { ToolbarOverflowButton } from '../ToolbarOverflowButton';

const useClasses = makeStyles({
    iconDisconnect: {
        color: tokens.colorStatusDangerBorderActive,
    },
});

export const ConnectionButton = forwardRef(function ConnectionButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
    const classes = useClasses();
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const connectToDatabase = useCallback(() => dispatcher.connectToDatabase(), [dispatcher]);
    const disconnectFromDatabase = useCallback(() => dispatcher.disconnectFromDatabase(), [dispatcher]);

    if (state.isConnected) {
        return (
            <ToolbarOverflowButton
                type={props.type}
                ariaLabel={l10n.t('Disconnect')}
                content={l10n.t('Disconnect')}
                icon={<DatabasePlugConnectedRegular className={classes.iconDisconnect} />}
                onClick={disconnectFromDatabase}
                tooltip={l10n.t('Disconnect from the database')}
                refs={ref}
            />
        );
    }

    return (
        <ToolbarOverflowButton
            type={props.type}
            ariaLabel={l10n.t('Connect')}
            content={l10n.t('Connect')}
            icon={<DatabasePlugConnectedRegular />}
            onClick={connectToDatabase}
            tooltip={l10n.t('Connect to the database')}
            refs={ref}
        />
    );
});
