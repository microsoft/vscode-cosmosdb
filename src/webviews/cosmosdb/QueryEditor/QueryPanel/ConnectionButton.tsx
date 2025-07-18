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
import { type ForwardedRef, forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

const ChevronRightIcon = bundleIcon(ChevronRightFilled, ChevronRightRegular);

export const ConnectionButton = forwardRef(function ConnectionButton(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLDivElement>,
) {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const restoreFocusTargetAttribute = useRestoreFocusTarget();
    const [connectionList, setConnectionList] = useState(state.connectionList);
    const [checkedValues, setCheckedValues] = useState<Record<string, string[]>>({ databaseId: [], collectionId: [] });
    const [selectedOptions, setSelectedOptions] = useState<string[]>([]);

    const currentValue = useMemo(() => {
        return state.dbName && state.collectionName ? `${state.dbName}/${state.collectionName}` : '';
    }, [state.dbName, state.collectionName]);

    useEffect(() => {
        setSelectedOptions([`${state.dbName}/${state.collectionName}`]);
        setCheckedValues({ databaseId: [state.dbName], collectionId: [state.collectionName] });
    }, [state.dbName, state.collectionName]);

    useEffect(() => {
        setConnectionList(state.connectionList);
    }, [state.connectionList]);

    const onOpenChange = useCallback(
        (_e: never, data: { open: boolean }) => {
            if (data.open) {
                void dispatcher.getConnections();
            }
        },
        [dispatcher],
    );

    const onSetConnection = useCallback(
        (databaseId: string, collectionId: string) => {
            void dispatcher.setConnection(databaseId, collectionId);
        },
        [dispatcher],
    );

    const onOptionSelect = useCallback(
        (_event: SelectionEvents, data: OptionOnSelectData) => {
            const selected = data.optionValue;
            if (selected) {
                const [databaseId, collectionId] = selected.split('/');
                void onSetConnection(databaseId, collectionId);
            }
        },
        [onSetConnection],
    );

    if (props.type === 'button') {
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
                    {state.isConnected && !connectionList && (
                        <OptionGroup label={state.dbName}>
                            <Option value={currentValue} text={currentValue}>
                                {state.collectionName}
                            </Option>
                        </OptionGroup>
                    )}
                    {!connectionList && <Option aria-label={l10n.t('Loading…')}>{l10n.t('Loading…')}</Option>}
                    {connectionList && Object.entries(connectionList).length === 0 && (
                        <Option disabled aria-label={l10n.t('No connections')}>
                            {l10n.t('No connections')}
                        </Option>
                    )}
                    {connectionList &&
                        Object.entries(connectionList).map(([databaseId, collections]) => (
                            <OptionGroup key={databaseId} label={databaseId}>
                                {collections.length === 0 && <Option disabled>{l10n.t('No collections')}</Option>}
                                {collections.map((collectionId) => (
                                    <Option
                                        key={collectionId}
                                        value={`${databaseId}/${collectionId}`}
                                        text={`${databaseId}/${collectionId}`}
                                    >
                                        {collectionId}
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
                    {!connectionList && <MenuItem>{l10n.t('Loading…')}</MenuItem>}
                    {connectionList && Object.entries(connectionList).length === 0 && (
                        <MenuItem disabled>{l10n.t('No connections')}</MenuItem>
                    )}
                    {connectionList &&
                        Object.entries(connectionList).map(([databaseId, collections]) => (
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
                                        {collections.length === 0 && (
                                            <MenuItem disabled>{l10n.t('No collections')}</MenuItem>
                                        )}
                                        {collections.map((collectionId) => (
                                            <MenuItemCheckbox
                                                key={collectionId}
                                                name={'collectionId'}
                                                value={collectionId}
                                                onClick={() => void onSetConnection(databaseId, collectionId)}
                                            >
                                                {collectionId}
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
});
