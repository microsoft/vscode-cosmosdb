/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Menu, MenuButton, MenuItem, MenuList, MenuPopover, MenuTrigger } from '@fluentui/react-components';
import { ChatSparkle20Regular, PenSparkle20Regular, Sparkle20Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import {
    useQueryEditorDispatcher,
    useQueryEditorState,
    useQueryEditorStateDispatch,
} from '../state/QueryEditorContext';

export const AIButton = ({ ref, type = 'button' }: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatch = useQueryEditorStateDispatch();
    const dispatcher = useQueryEditorDispatcher();

    // Don't render if AI features are disabled (Copilot not available)
    if (!state.isAIFeaturesEnabled) {
        return null;
    }

    const handleGenerateClick = () => {
        if (state.showGenerateInput) {
            void dispatcher.closeGenerateInput();
        } else {
            void dispatcher.reportWebviewEvent('openGenerateInput');
        }
        dispatch({ type: 'toggleGenerateInput' });
    };

    const handleExplainClick = () => {
        void dispatcher.openCopilotExplainQuery();
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
                        {l10n.t('AI')}
                    </MenuButton>
                ) : (
                    <MenuItem icon={aiIcon}>{l10n.t('AI')}</MenuItem>
                )}
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
