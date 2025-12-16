/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
} from '@fluentui/react-components';
import { ChatSparkle20Regular, PenSparkle20Regular, Sparkle20Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorDispatcher, useQueryEditorStateDispatch } from '../state/QueryEditorContext';

export const AIButton = ({ type = 'button' }: ToolbarOverflowItemProps) => {
    const dispatch = useQueryEditorStateDispatch();
    const dispatcher = useQueryEditorDispatcher();

    const handleGenerateClick = () => {
        dispatch({ type: 'toggleGenerateInput' });
    };

    const handleExplainClick = () => {
        void dispatcher.openCopilotExplainQuery();
    };

    // Generate query icon
    const generateIcon = <PenSparkle20Regular />;

    // AI button icon - use sparkle for AI/Copilot
    const aiIcon = <Sparkle20Regular />;

    if (type === 'menuitem') {
        // When in overflow menu, show both items separately
        return (
            <>
                <MenuItem icon={generateIcon} onClick={handleGenerateClick}>
                    {l10n.t('Generate query')}
                </MenuItem>
                <MenuItem icon={<ChatSparkle20Regular />} onClick={handleExplainClick}>
                    {l10n.t('Explain query')}
                </MenuItem>
            </>
        );
    }

    return (
        <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
                <MenuButton appearance="subtle" icon={aiIcon}>
                    {l10n.t('AI')}
                </MenuButton>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    <MenuItem icon={generateIcon} onClick={handleGenerateClick}>
                        {l10n.t('Generate query')}
                    </MenuItem>
                    <MenuItem icon={<ChatSparkle20Regular />} onClick={handleExplainClick}>
                        {l10n.t('Explain query')}
                    </MenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
