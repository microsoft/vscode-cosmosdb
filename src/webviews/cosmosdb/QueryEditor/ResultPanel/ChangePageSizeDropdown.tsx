/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type OptionOnSelectData } from '@fluentui/react-combobox';
import {
    Dropdown,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Option,
    Tooltip,
} from '@fluentui/react-components';
import { Checkmark16Filled, NumberSymbolSquareRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ForwardedRef, forwardRef, useCallback } from 'react';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const ChangePageSizeDropdown = forwardRef(function ChangePageSizeDropdown(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLDivElement>,
) {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const pageSize = state.pageSize;

    const changePageSize = useCallback(
        (countPerPage: number) => {
            if (!state.currentExecutionId || !state.currentQueryResult?.query) {
                // The result is not loaded yet, just set the page size
                dispatcher.setPageSize(countPerPage);
                return;
            }

            void dispatcher.runQuery(state.currentQueryResult?.query, {
                sessionId: state.currentExecutionId,
                countPerPage: countPerPage,
            });
        },
        [dispatcher, state],
    );

    const onOptionSelect = useCallback(
        (data: OptionOnSelectData) => {
            const parsedValue = parseInt(data.optionValue ?? '', 10);
            const countPerPage = isFinite(parsedValue) ? parsedValue : -1;
            changePageSize(countPerPage);
        },
        [changePageSize],
    );

    return (
        <>
            {props.type === 'button' ? (
                <div ref={ref} style={{ paddingLeft: '8px' }}>
                    <Tooltip content={l10n.t('Change page size')} relationship="label" appearance="inverted" withArrow>
                        <Dropdown
                            onOptionSelect={(_event, data) => onOptionSelect(data)}
                            style={{ minWidth: '100px', maxWidth: '100px' }}
                            value={pageSize === -1 ? l10n.t('All') : pageSize.toString()}
                            selectedOptions={[pageSize.toString()]}
                        >
                            <Option key="10" value={'10'}>
                                10
                            </Option>
                            <Option key="50" value={'50'}>
                                50
                            </Option>
                            <Option key="100" value={'100'}>
                                100
                            </Option>
                            <Option key="500" value={'500'}>
                                500
                            </Option>
                            <Option key="All" value={'-1'}>
                                {l10n.t('All')}
                            </Option>
                        </Dropdown>
                    </Tooltip>
                </div>
            ) : (
                <Menu>
                    <MenuTrigger>
                        <MenuItem aria-label={l10n.t('Change page size')} icon={<NumberSymbolSquareRegular />}>
                            {l10n.t('Change page size')}
                        </MenuItem>
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem
                                onClick={() => changePageSize(10)}
                                icon={
                                    <Checkmark16Filled style={{ visibility: pageSize === 10 ? 'visible' : 'hidden' }} />
                                }
                            >
                                10
                            </MenuItem>
                            <MenuItem
                                onClick={() => changePageSize(50)}
                                icon={
                                    <Checkmark16Filled style={{ visibility: pageSize === 50 ? 'visible' : 'hidden' }} />
                                }
                            >
                                50
                            </MenuItem>
                            <MenuItem
                                onClick={() => changePageSize(100)}
                                icon={
                                    <Checkmark16Filled
                                        style={{ visibility: pageSize === 100 ? 'visible' : 'hidden' }}
                                    />
                                }
                            >
                                100
                            </MenuItem>
                            <MenuItem
                                onClick={() => changePageSize(500)}
                                icon={
                                    <Checkmark16Filled
                                        style={{ visibility: pageSize === 500 ? 'visible' : 'hidden' }}
                                    />
                                }
                            >
                                500
                            </MenuItem>
                            <MenuItem
                                onClick={() => changePageSize(-1)}
                                icon={
                                    <Checkmark16Filled style={{ visibility: pageSize === -1 ? 'visible' : 'hidden' }} />
                                }
                            >
                                {l10n.t('All')}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            )}
        </>
    );
});
