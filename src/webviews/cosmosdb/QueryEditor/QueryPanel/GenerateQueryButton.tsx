/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from '@fluentui/react-components';
import { Sparkle20Filled, Sparkle20Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorState, useQueryEditorStateDispatch } from '../state/QueryEditorContext';

export const GenerateQueryButton = ({ type = 'button' }: ToolbarOverflowItemProps) => {
    const state = useQueryEditorState();
    const dispatch = useQueryEditorStateDispatch();

    const handleClick = () => {
        dispatch({ type: 'toggleGenerateInput' });
    };

    const icon = state.showGenerateInput ? <Sparkle20Filled style={{ color: '#0078D4' }} /> : <Sparkle20Regular />;

    return (
        <Button
            icon={icon}
            onClick={handleClick}
            appearance="subtle"
            title={l10n.t('Generate query with AI')}
            aria-label={l10n.t('Generate query with AI')}
        >
            {type === 'button' && l10n.t('Generate')}
        </Button>
    );
};
