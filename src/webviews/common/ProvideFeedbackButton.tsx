/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from '@fluentui/react-components';
import { CommentCheckmarkRegular, EmojiSmileSlightRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { ThemedTooltip } from './ThemedTooltip';
import { type ToolbarOverflowItemProps } from './ToolbarOverflow/ToolbarOverflowItem';

export const ProvideFeedbackButton = ({
    ref,
    type,
    onProvideFeedback,
    quickStartId,
}: ToolbarOverflowItemProps<HTMLButtonElement> & {
    onProvideFeedback: () => void | Promise<void>;
    quickStartId?: string;
}) => {
    if (type === 'button') {
        return (
            <Menu>
                <MenuTrigger>
                    <ThemedTooltip
                        content={l10n.t('Provide Feedback')}
                        relationship="label"
                        appearance="inverted"
                        withArrow
                    >
                        <Button
                            ref={ref}
                            type="button"
                            appearance="subtle"
                            size="small"
                            aria-label={l10n.t('Provide Feedback')}
                            data-quickstart={quickStartId}
                            icon={<EmojiSmileSlightRegular />}
                        />
                    </ThemedTooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem icon={<CommentCheckmarkRegular />} onClick={() => void onProvideFeedback()}>
                            {l10n.t('Provide Feedback')}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        );
    } else {
        return (
            <MenuItem
                aria-label={l10n.t('Provide Feedback')}
                icon={<EmojiSmileSlightRegular />}
                onClick={() => void onProvideFeedback()}
            >
                {l10n.t('Provide Feedback')}
            </MenuItem>
        );
    }
};
