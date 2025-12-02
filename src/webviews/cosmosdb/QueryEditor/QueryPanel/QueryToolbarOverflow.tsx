/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Menu,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Overflow,
    OverflowItem,
    Toolbar,
    type ToolbarProps,
    useOverflowMenu,
} from '@fluentui/react-components';
import { MoreHorizontal20Filled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { ToolbarOverflowDivider } from '../../../common/ToolbarOverflow/ToolbarOverflowDivider';
import { ToolbarOverflowMenuDivider } from '../../../common/ToolbarOverflow/ToolbarOverflowMenuDivider';
import { ToolbarOverflowMenuItem } from '../../../common/ToolbarOverflow/ToolbarOverflowMenuItem';
import { useQueryEditorState } from '../state/QueryEditorContext';
import { CancelQueryButton } from './CancelQueryButton';
import { ConnectionButton } from './ConnectionButton';
import { DuplicateTabButton } from './DuplicateTabButton';
import { GenerateQueryButton } from './GenerateQueryButton';
import { LearnButton } from './LearnButton';
import { OpenFileButton } from './OpenFileButton';
import { ProvideFeedbackButton } from './ProvideFeedbackButton';
import { RunQueryButton } from './RunQueryButton';
import { SaveToFileButton } from './SaveToFileButton';

const OverflowMenu = () => {
    const { ref, isOverflowing } = useOverflowMenu<HTMLButtonElement>();
    const state = useQueryEditorState();

    if (!isOverflowing) {
        return null;
    }

    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <Button
                    ref={ref}
                    icon={<MoreHorizontal20Filled />}
                    aria-label={l10n.t('More items')}
                    appearance="subtle"
                />
            </MenuTrigger>

            <MenuPopover>
                <MenuList>
                    <ToolbarOverflowMenuItem id="1">
                        <RunQueryButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="2">
                        <CancelQueryButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuDivider id="1" />
                    <ToolbarOverflowMenuItem id="3">
                        <GenerateQueryButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="4">
                        <OpenFileButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="5">
                        <SaveToFileButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="6">
                        <DuplicateTabButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    <ToolbarOverflowMenuItem id="7">
                        <LearnButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                    {state.isSurveyCandidate && (
                        <ToolbarOverflowMenuItem id="8">
                            <ProvideFeedbackButton type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                    )}
                    <ToolbarOverflowMenuDivider id="2" />
                    <ToolbarOverflowMenuItem id="9">
                        <ConnectionButton type={'menuitem'} />
                    </ToolbarOverflowMenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};

export const QueryToolbarOverflow = (props: Partial<ToolbarProps>) => {
    return (
        <Overflow padding={40}>
            <Toolbar aria-label={l10n.t('Default')} size={'small'} {...props}>
                <OverflowItem id={'1'} groupId={'1'}>
                    <RunQueryButton type={'button'} />
                </OverflowItem>
                <OverflowItem id={'2'} groupId={'1'}>
                    <CancelQueryButton type={'button'} />
                </OverflowItem>
                <ToolbarOverflowDivider groupId="1" />
                <OverflowItem id={'3'} groupId={'2'}>
                    <GenerateQueryButton type={'button'} />
                </OverflowItem>
                <OverflowItem id={'4'} groupId={'2'}>
                    <OpenFileButton type={'button'} />
                </OverflowItem>
                <OverflowItem id={'5'} groupId={'2'}>
                    <SaveToFileButton type={'button'} />
                </OverflowItem>
                <OverflowItem id={'6'} groupId={'2'}>
                    <DuplicateTabButton type={'button'} />
                </OverflowItem>
                <OverflowItem id={'7'} groupId={'2'}>
                    <LearnButton type={'button'} />
                </OverflowItem>
                {useQueryEditorState().isSurveyCandidate && (
                    <OverflowItem id={'8'} groupId={'2'}>
                        <ProvideFeedbackButton type={'button'} />
                    </OverflowItem>
                )}
                <ToolbarOverflowDivider groupId="2" />
                <OverflowItem id={'9'} groupId={'3'}>
                    <ConnectionButton type={'button'} />
                </OverflowItem>
                <OverflowMenu />
            </Toolbar>
        </Overflow>
    );
};
