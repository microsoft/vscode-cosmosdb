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
    useOverflowMenu,
} from '@fluentui/react-components';
import { MoreHorizontal20Filled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { ToolbarOverflowDivider } from '../../../common/ToolbarOverflow/ToolbarOverflowDivider';
import { ToolbarOverflowMenuDivider } from '../../../common/ToolbarOverflow/ToolbarOverflowMenuDivider';
import { ToolbarOverflowMenuItem } from '../../../common/ToolbarOverflow/ToolbarOverflowMenuItem';
import { ChangePageSizeDropdown } from './ChangePageSizeDropdown';
import { CopyToClipboardButton } from './CopyToClipboardButton';
import { ExportButton } from './ExportButton';
import { GoToFirstPageButton } from './GoToFirstPageButton';
import { GoToNextPageButton } from './GoToNextPageButton';
import { GoToPrevPageButton } from './GoToPrevPageButton';
import { ReloadQueryButton } from './ReloadQueryButton';
import { StatusBar } from './StatusBar';

export type ResultToolbarProps = { selectedTab: string };

const OverflowMenu = ({ selectedTab }: ResultToolbarProps) => {
    const { ref, isOverflowing } = useOverflowMenu<HTMLButtonElement>();

    if (!isOverflowing) {
        return null;
    }

    return (
        <>
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
                        <ToolbarOverflowMenuItem id={'1'}>
                            <ReloadQueryButton type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarOverflowMenuDivider id="1" />
                        <ToolbarOverflowMenuItem id={'2'}>
                            <GoToFirstPageButton type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarOverflowMenuItem id={'3'}>
                            <GoToPrevPageButton type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarOverflowMenuItem id={'4'}>
                            <GoToNextPageButton type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarOverflowMenuItem id={'5'}>
                            <ChangePageSizeDropdown type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarOverflowMenuDivider id="2" />
                        <ToolbarOverflowMenuItem id={'6'}>
                            <StatusBar type={'menuitem'} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarOverflowMenuDivider id="3" />
                        <ToolbarOverflowMenuItem id={'7'}>
                            <CopyToClipboardButton type={'menuitem'} selectedTab={selectedTab} />
                        </ToolbarOverflowMenuItem>
                        <ToolbarOverflowMenuItem id={'8'}>
                            <ExportButton type={'menuitem'} selectedTab={selectedTab} />
                        </ToolbarOverflowMenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </>
    );
};

export const ResultPanelToolbarOverflow = ({ selectedTab }: ResultToolbarProps) => {
    return (
        <>
            <Overflow padding={70}>
                <Toolbar aria-label="Default" size={'small'}>
                    <OverflowItem id={'1'} groupId={'1'}>
                        <ReloadQueryButton type={'button'} />
                    </OverflowItem>
                    <ToolbarOverflowDivider groupId="1" />
                    <OverflowItem id={'2'} groupId={'2'}>
                        <GoToFirstPageButton type={'button'} />
                    </OverflowItem>
                    <OverflowItem id={'3'} groupId={'2'}>
                        <GoToPrevPageButton type={'button'} />
                    </OverflowItem>
                    <OverflowItem id={'4'} groupId={'2'}>
                        <GoToNextPageButton type={'button'} />
                    </OverflowItem>
                    <OverflowItem id={'5'} groupId={'2'}>
                        <ChangePageSizeDropdown type={'button'} />
                    </OverflowItem>
                    <ToolbarOverflowDivider groupId="2" />
                    <OverflowItem id={'6'} groupId={'3'}>
                        <StatusBar type={'button'} />
                    </OverflowItem>
                    <ToolbarOverflowDivider groupId="3" />
                    <OverflowItem id={'7'} groupId={'4'}>
                        <CopyToClipboardButton type={'button'} selectedTab={selectedTab} />
                    </OverflowItem>
                    <OverflowItem id={'8'} groupId={'4'}>
                        <ExportButton type={'button'} selectedTab={selectedTab} />
                    </OverflowItem>
                    <OverflowMenu selectedTab={selectedTab} />
                </Toolbar>
            </Overflow>
        </>
    );
};
