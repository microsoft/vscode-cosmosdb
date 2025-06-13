/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { CommentCheckmarkRegular, EmojiSmileSlightRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback } from 'react';
import { type ToolbarOverflowItemProps } from '../OverflowToolbarItem';
import { useQueryEditorDispatcher } from '../state/QueryEditorContext';

export const ProvideFeedbackButton = forwardRef(function ProvideFeedbackButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLButtonElement>,
) {
    const dispatcher = useQueryEditorDispatcher();

    const provideFeedback = useCallback(() => dispatcher.provideFeedback(), [dispatcher]);

    if (props.type === 'button') {
        return (
            <Menu>
                <MenuTrigger>
                    <Tooltip content={l10n.t('Provide Feedback')} relationship="label" appearance="inverted" withArrow>
                        <ToolbarButton
                            ref={ref}
                            aria-label={l10n.t('Provide Feedback')}
                            icon={<EmojiSmileSlightRegular />}
                        />
                    </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        <MenuItem icon={<CommentCheckmarkRegular />} onClick={() => void provideFeedback()}>
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
                onClick={() => void dispatcher.provideFeedback()}
            >
                {l10n.t('Provide Feedback')}
            </MenuItem>
        );
    }
});
