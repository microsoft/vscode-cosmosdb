/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuButton,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
} from '@fluentui/react-components';
import {
    ChatSparkle20Regular,
    PenSparkle20Regular,
    QuestionCircle20Regular,
    Sparkle20Regular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const AIButton = ({ ref, type }: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    // Don't render if AI features are disabled (Copilot not available)
    if (!state.isAIFeaturesEnabled) {
        return null;
    }

    const handleGenerateClick = () => {
        void dispatcher.reportWebviewEvent('openGenerateInput');
        void dispatcher.generateQueryViaAgent();
    };

    const handleExplainClick = () => {
        void dispatcher.explainQueryViaAgent();
    };

    const handleHelpClick = () => {
        void dispatcher.openChatParticipantHelp();
    };

    // Generate query icon
    const generateIcon = <PenSparkle20Regular />;

    // AI button icon - use sparkle for AI/Copilot
    const aiIcon = <Sparkle20Regular />;

    return (
        <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
                {type === 'button' ? (
                    <MenuButton ref={ref} appearance="subtle" icon={aiIcon}>
                        {l10n.t('AI')} {l10n.t('(Preview)')}
                    </MenuButton>
                ) : (
                    <MenuItem icon={aiIcon}>
                        {l10n.t('AI')} {l10n.t('(Preview)')}
                    </MenuItem>
                )}
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    <MenuItem icon={generateIcon} onClick={handleGenerateClick}>
                        {l10n.t('Generate query')}
                    </MenuItem>
                    <MenuItem
                        icon={<ChatSparkle20Regular />}
                        onClick={handleExplainClick}
                        disabled={!(state.querySelectedValue || state.queryValue).trim()}
                    >
                        {l10n.t('Explain query')}
                    </MenuItem>
                    <MenuDivider />
                    <MenuItem icon={<QuestionCircle20Regular />} onClick={handleHelpClick}>
                        {l10n.t('Help')}
                    </MenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
