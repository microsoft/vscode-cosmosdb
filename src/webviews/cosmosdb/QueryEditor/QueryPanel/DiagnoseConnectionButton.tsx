/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NetworkCheckRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { ToolbarOverflowButton } from '../../../common/ToolbarOverflow/ToolbarOverflowButton';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export function DiagnoseConnectionButton({ ref, type }: ToolbarOverflowItemProps<HTMLButtonElement>) {
    const { isConnected, isChangingConnection } = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const label = l10n.t('Diagnose Connection');
    return (
        <ToolbarOverflowButton
            ref={ref}
            type={type}
            ariaLabel={label}
            content={label}
            tooltip={l10n.t('Check query access to the selected container')}
            showButtonText
            icon={<NetworkCheckRegular aria-hidden />}
            disabled={!isConnected || isChangingConnection}
            onClick={() => dispatcher.diagnoseConnection()}
        />
    );
}
