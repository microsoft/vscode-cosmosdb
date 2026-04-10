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
    const hasSchema = state.containerSchema !== null;

    const generateSchemaDisabledReason = isDisabled ? l10n.t('Connect to a container to generate a schema') : undefined;

    const schemaActionDisabledReason = isDisabled
        ? l10n.t('Connect to a container first')
        : !hasSchema
          ? l10n.t('No schema available. Generate a schema first.')
          : undefined;

    const generateSchema = useCallback((limit?: number) => void dispatcher.generateSchema(limit), [dispatcher]);

    const toggleSchemaBasedOnQueries = useCallback(() => void dispatcher.openSchemaSettings(), [dispatcher]);

    const showCurrentSchema = useCallback(() => void dispatcher.showCurrentSchema(), [dispatcher]);

    const deleteCurrentSchema = useCallback(() => void dispatcher.deleteCurrentSchema(), [dispatcher]);

    const checkedValues = useMemo(
        () => ({
            schemaSettings: state.isSchemaBasedOnQueries ? ['generateSchemaBasedOnQueries'] : [],
        }),
        [state.isSchemaBasedOnQueries],
    );

    return (
        <Menu hasCheckmarks checkedValues={checkedValues}>
            <MenuTrigger>
                {type === 'button' ? (
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
                ) : (
                    <MenuItem aria-label={l10n.t('Schema')} icon={<DatabaseRegular />}>
                        {l10n.t('Schema')}
                    </MenuItem>
                )}
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    <Menu>
                        <MenuTrigger disableButtonEnhancement>
                            <MenuItem disabled={isDisabled} aria-description={generateSchemaDisabledReason}>
                                {l10n.t('Generate schema')}
                            </MenuItem>
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                <MenuItem onClick={() => generateSchema(50)}>{l10n.t('From TOP 50')}</MenuItem>
                                <MenuItem onClick={() => generateSchema(100)}>{l10n.t('From TOP 100')}</MenuItem>
                                <MenuItem onClick={() => generateSchema(500)}>{l10n.t('From TOP 500')}</MenuItem>
                                <MenuItem onClick={() => generateSchema(undefined)}>{l10n.t('From ALL')}</MenuItem>
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                    <MenuItemCheckbox
                        name="schemaSettings"
                        value="generateSchemaBasedOnQueries"
                        onClick={toggleSchemaBasedOnQueries}
                    >
                        {l10n.t('Generate schema based on queries')}
                    </MenuItemCheckbox>
                    <MenuDivider />
                    <MenuItem
                        disabled={isDisabled || !hasSchema}
                        aria-description={schemaActionDisabledReason}
                        onClick={showCurrentSchema}
                    >
                        {l10n.t('Show current schema')}
                    </MenuItem>
                    <MenuItem
                        disabled={isDisabled || !hasSchema}
                        aria-description={schemaActionDisabledReason}
                        onClick={deleteCurrentSchema}
                    >
                        {l10n.t('Delete current schema')}
                    </MenuItem>
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
