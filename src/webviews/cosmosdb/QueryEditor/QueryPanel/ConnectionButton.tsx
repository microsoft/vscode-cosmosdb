/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Dropdown,
    Menu,
    MenuItem,
    MenuItemCheckbox,
    MenuList,
    MenuPopover,
    MenuSplitGroup,
    MenuTrigger,
    Option,
    OptionGroup,
    type OptionOnSelectData,
    type SelectionEvents,
    useRestoreFocusTarget,
} from '@fluentui/react-components';
import {
    bundleIcon,
    ChevronRightFilled,
    ChevronRightRegular,
    DatabasePlugConnectedRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo } from 'react';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

const ChevronRightIcon = bundleIcon(ChevronRightFilled, ChevronRightRegular);

export const ConnectionButton = (props: ToolbarOverflowItemProps<HTMLDivElement>) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const restoreFocusTargetAttribute = useRestoreFocusTarget();
    const { ref, type } = props;

    const currentValue = useMemo(() => {
        return state.dbName && state.collectionName ? `${state.dbName}/${state.collectionName}` : '';
    }, [state.dbName, state.collectionName]);

    const selectedOptions = useMemo(() => {
        return [`${state.dbName}/${state.collectionName}`];
    }, [state.dbName, state.collectionName]);

    const checkedValues = useMemo(() => {
        return { databaseId: [state.dbName], containerId: [state.collectionName] };
    }, [state.dbName, state.collectionName]);

    const onOpenChange = useCallback(
        (_e: never, data: { open: boolean }) => {
            if (data.open) {
                void dispatcher.getConnections();
            }
        },
        [dispatcher],
    );

    const onSetConnection = useCallback(
        (databaseId: string, containerId: string) => {
            void dispatcher.setConnection(databaseId, containerId);
        },
        [dispatcher],
    );

    const onOptionSelect = useCallback(
        (_event: SelectionEvents, data: OptionOnSelectData) => {
            const selected = data.optionValue;
            if (selected) {
                const [databaseId, containerId] = selected.split('/');
                void onSetConnection(databaseId, containerId);
            }
        },
        [onSetConnection],
    );

    if (type === 'button') {
        return (
            <div ref={ref} style={{ paddingLeft: '8px' }}>
                <Dropdown
                    style={{ minWidth: '100px', maxWidth: '300px' }}
                    aria-label={l10n.t('Connect to…')}
                    placeholder={l10n.t('Connect to…')}
                    value={currentValue}
                    selectedOptions={selectedOptions}
                    onOptionSelect={onOptionSelect}
                    onOpenChange={onOpenChange}
                    {...restoreFocusTargetAttribute}
                >
                    {state.isConnected && !state.connectionList && (
                        <OptionGroup label={state.dbName}>
                            <Option value={currentValue} text={currentValue}>
                                {state.collectionName}
                            </Option>
                        </OptionGroup>
                    )}
                    {!state.connectionList && <Option aria-label={l10n.t('Loading…')}>{l10n.t('Loading…')}</Option>}
                    {state.connectionList && Object.entries(state.connectionList).length === 0 && (
                        <Option disabled aria-label={l10n.t('No connections')}>
                            {l10n.t('No connections')}
                        </Option>
                    )}
                    {state.connectionList &&
                        Object.entries(state.connectionList).map(([databaseId, containers]) => (
                            <OptionGroup key={databaseId} label={databaseId}>
                                {containers.length === 0 && <Option disabled>{l10n.t('No containers')}</Option>}
                                {containers.map((containerId) => (
                                    <Option
                                        key={containerId}
                                        value={`${databaseId}/${containerId}`}
                                        text={`${databaseId}/${containerId}`}
                                    >
                                        {containerId}
                                    </Option>
                                ))}
                            </OptionGroup>
                        ))}
                </Dropdown>
            </div>
        );
    }

    return (
        <Menu hasCheckmarks={true} onOpenChange={onOpenChange} checkedValues={checkedValues}>
            <MenuTrigger>
                <MenuItem aria-label={l10n.t('Connect to…')} icon={<DatabasePlugConnectedRegular />}>
                    {l10n.t('Connect to…')}
                </MenuItem>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {!state.connectionList && <MenuItem>{l10n.t('Loading…')}</MenuItem>}
                    {state.connectionList && Object.entries(state.connectionList).length === 0 && (
                        <MenuItem disabled>{l10n.t('No connections')}</MenuItem>
                    )}
                    {state.connectionList &&
                        Object.entries(state.connectionList).map(([databaseId, containers]) => (
                            <Menu key={databaseId} hasCheckmarks={true} checkedValues={checkedValues}>
                                <MenuTrigger disableButtonEnhancement>
                                    <MenuSplitGroup>
                                        <MenuItemCheckbox
                                            key={databaseId}
                                            //icon={databaseId === state.dbName ? <Checkmark16Regular /> : undefined}
                                            name={'databaseId'}
                                            value={databaseId}
                                            submenuIndicator={<ChevronRightIcon />}
                                        >
                                            {databaseId}
                                        </MenuItemCheckbox>
                                        <MenuTrigger disableButtonEnhancement>
                                            <MenuItem aria-label="Open collection list" />
                                        </MenuTrigger>
                                    </MenuSplitGroup>
                                </MenuTrigger>
                                <MenuPopover>
                                    <MenuList>
                                        {containers.length === 0 && (
                                            <MenuItem disabled>{l10n.t('No containers')}</MenuItem>
                                        )}
                                        {containers.map((containerId) => (
                                            <MenuItemCheckbox
                                                key={containerId}
                                                name={'containerId'}
                                                value={containerId}
                                                onClick={() => void onSetConnection(databaseId, containerId)}
                                            >
                                                {containerId}
                                            </MenuItemCheckbox>
                                        ))}
                                    </MenuList>
                                </MenuPopover>
                            </Menu>
                        ))}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
