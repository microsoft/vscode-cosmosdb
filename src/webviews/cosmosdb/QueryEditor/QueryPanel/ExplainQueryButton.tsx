/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, MenuItem, Tooltip } from '@fluentui/react-components';
import { ChatSparkle20Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorDispatcher } from '../state/QueryEditorContext';

export const ExplainQueryButton = ({ type = 'button' }: ToolbarOverflowItemProps) => {
    const dispatcher = useQueryEditorDispatcher();

    const handleClick = () => {
        void dispatcher.openCopilotExplainQuery();
    };

    if (type === 'menuitem') {
        return (
            <MenuItem icon={<ChatSparkle20Regular />} onClick={handleClick}>
                {l10n.t('Explain with Copilot')}
            </MenuItem>
        );
    }

    return (
        <Tooltip
            content={l10n.t('Open Copilot Chat to explain your query')}
            relationship="description"
            appearance="inverted"
            withArrow
        >
            <Button
                icon={<ChatSparkle20Regular />}
                onClick={handleClick}
                appearance="subtle"
                aria-label={l10n.t('Explain with Copilot')}
            >
                {l10n.t('Explain')}
            </Button>
        </Tooltip>
    );
};
