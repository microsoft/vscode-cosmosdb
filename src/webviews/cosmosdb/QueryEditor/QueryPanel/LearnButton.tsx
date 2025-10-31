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
    const noSqlQuickReferenceUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/';
    const noSqlLearningCenterUrl = 'https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/';
    const cosmosDBLimitations = 'https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/cosmosdb/cosmos#limitations';

    const insertSampleText = useCallback((sample: string) => dispatcher.insertText(sample), [dispatcher]);

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
                    <MenuItemLink href={noSqlQuickReferenceUrl}>{l10n.t('NoSQL quick reference')}</MenuItemLink>
                    <MenuItemLink href={noSqlLearningCenterUrl}>{l10n.t('Learning center')}</MenuItemLink>
                    <MenuItemLink href={cosmosDBLimitations}>{l10n.t('Cosmos DB SDK limitations')}</MenuItemLink>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
