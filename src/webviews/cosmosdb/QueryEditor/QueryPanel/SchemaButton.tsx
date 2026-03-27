/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuDivider,
    MenuItem,
    MenuItemCheckbox,
    MenuList,
    MenuPopover,
    MenuTrigger,
    ToolbarButton,
    Tooltip,
} from '@fluentui/react-components';
import { DatabaseRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const SchemaButton = (props: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const { ref, type } = props;
    const isDisabled = !state.isConnected;

    const generateSchema = useCallback((limit?: number) => void dispatcher.generateSchema(limit), [dispatcher]);

    const openSchemaSettings = useCallback(() => void dispatcher.openSchemaSettings(), [dispatcher]);

    const showCurrentSchema = useCallback(() => void dispatcher.showCurrentSchema(), [dispatcher]);

    const wipeCurrentSchema = useCallback(() => void dispatcher.wipeCurrentSchema(), [dispatcher]);

    const checkedValues = useMemo(
        () => ({
            schemaSettings: state.isSchemaBasedOnQueries ? ['generateSchemaBasedOnQueries'] : [],
        }),
        [state.isSchemaBasedOnQueries],
    );

    const menuContent = (
        <MenuPopover>
            <MenuList>
                <MenuItem disabled={isDisabled} onClick={() => generateSchema(50)}>
                    {l10n.t('Generate schema from TOP 50')}
                </MenuItem>
                <MenuItem disabled={isDisabled} onClick={() => generateSchema(100)}>
                    {l10n.t('Generate schema from TOP 100')}
                </MenuItem>
                <MenuItem disabled={isDisabled} onClick={() => generateSchema(500)}>
                    {l10n.t('Generate schema from TOP 500')}
                </MenuItem>
                <MenuItem disabled={isDisabled} onClick={() => generateSchema(undefined)}>
                    {l10n.t('Generate schema from ALL')}
                </MenuItem>
                <MenuDivider />
                <MenuItemCheckbox
                    name="schemaSettings"
                    value="generateSchemaBasedOnQueries"
                    onClick={openSchemaSettings}
                >
                    {l10n.t('Generate schema based on queries')}
                </MenuItemCheckbox>
                <MenuDivider />
                <MenuItem disabled={isDisabled} onClick={showCurrentSchema}>
                    {l10n.t('Show current schema')}
                </MenuItem>
                <MenuItem disabled={isDisabled} onClick={wipeCurrentSchema}>
                    {l10n.t('Wipe current schema')}
                </MenuItem>
            </MenuList>
        </MenuPopover>
    );

    if (type === 'button') {
        return (
            <Menu hasCheckmarks checkedValues={checkedValues}>
                <MenuTrigger>
                    <Tooltip
                        content={l10n.t('Schema options')}
                        relationship="description"
                        appearance="inverted"
                        withArrow
                    >
                        <ToolbarButton
                            ref={ref}
                            aria-label={l10n.t('Schema')}
                            icon={<DatabaseRegular />}
                            disabled={false}
                        >
                            {l10n.t('Schema')}
                        </ToolbarButton>
                    </Tooltip>
                </MenuTrigger>
                {menuContent}
            </Menu>
        );
    } else {
        return (
            <Menu hasCheckmarks checkedValues={checkedValues}>
                <MenuTrigger>
                    <MenuItem aria-label={l10n.t('Schema')} icon={<DatabaseRegular />}>
                        {l10n.t('Schema')}
                    </MenuItem>
                </MenuTrigger>
                {menuContent}
            </Menu>
        );
    }
};
