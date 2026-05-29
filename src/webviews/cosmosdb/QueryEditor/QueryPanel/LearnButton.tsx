/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuItem,
    MenuItemLink,
    MenuList,
    MenuPopover,
    MenuTrigger,
    ToolbarButton,
    Tooltip,
} from '@fluentui/react-components';
import { LibraryRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback } from 'react';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const LearnButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const { ref, type } = props;
    const samples = ['SELECT * FROM c', 'SELECT * FROM c ORDER BY c.id', 'SELECT * FROM c OFFSET 0 LIMIT 10'];
    const cosmosDBAgentKitUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/agent-kit';
    const cosmosDBMcpToolkitUrl =
        'https://learn.microsoft.com/en-us/azure/cosmos-db/gen-ai/model-context-protocol-toolkit';
    const cosmosDBShellUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/shell/overview';
    const cosmosDBVsCodeExtensionUrl = 'https://review.microsoft.com/en-us/azure/cosmos-db/vscode-extension/overview';
    const cosmosDBGalleryUrl = 'https://azurecosmosdb.github.io/gallery/';

    const insertSampleText = useCallback((sample: string) => void dispatcher.insertText(sample), [dispatcher]);

    return (
        <Menu>
            <MenuTrigger>
                {type === 'button' ? (
                    <Tooltip
                        content={l10n.t('Learn more about NoSQL queries')}
                        relationship="description"
                        appearance="inverted"
                        withArrow
                    >
                        <ToolbarButton ref={ref} aria-label={l10n.t('Learn more')} icon={<LibraryRegular />}>
                            {l10n.t('Learn')}
                        </ToolbarButton>
                    </Tooltip>
                ) : (
                    <MenuItem aria-label={l10n.t('Learn more')} icon={<LibraryRegular />}>
                        {l10n.t('Learn')}
                    </MenuItem>
                )}
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    <Menu>
                        <MenuTrigger>
                            <MenuItem>{l10n.t('Query examples')}</MenuItem>
                        </MenuTrigger>
                        <MenuPopover>
                            {samples.map((sample, index) => (
                                <MenuItem
                                    disabled={state.isExecuting}
                                    onClick={() => insertSampleText(sample)}
                                    key={index}
                                >
                                    {sample}
                                </MenuItem>
                            ))}
                        </MenuPopover>
                    </Menu>
                    <MenuItemLink href={cosmosDBAgentKitUrl}>{l10n.t('Azure Cosmos DB Agent Kit')}</MenuItemLink>
                    <MenuItemLink href={cosmosDBMcpToolkitUrl}>{l10n.t('Azure Cosmos DB MCP Toolkit')}</MenuItemLink>
                    <MenuItemLink href={cosmosDBShellUrl}>{l10n.t('Azure Cosmos DB Shell')}</MenuItemLink>
                    <MenuItemLink href={cosmosDBVsCodeExtensionUrl}>
                        {l10n.t('Azure Cosmos DB VS Code extension')}
                    </MenuItemLink>
                    <MenuItemLink href={cosmosDBGalleryUrl}>{l10n.t('Azure Cosmos DB Gallery')}</MenuItemLink>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
