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
import { type ForwardedRef, forwardRef, useCallback, useState } from 'react';
import { AlertDialog } from '../../../common/AlertDialog';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const ChangePageSizeDropdown = forwardRef(function ChangePageSizeDropdown(
    props: ToolbarOverflowItemProps,
    ref: ForwardedRef<HTMLDivElement>,
) {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const [isOpen, setIsOpen] = useState(false);
    const [pageSize, setPageSize] = useState(state.pageSize);

    const handleDialogClose = useCallback(
        (confirmed: boolean) => {
            if (confirmed) {
                dispatcher.setPageSize(pageSize);
                void dispatcher.runQuery(state.queryHistory[state.queryHistory.length - 1], { countPerPage: pageSize });
            }
            setIsOpen(false);
        },
        [dispatcher, pageSize, state],
    );

    const changePageSize = useCallback(
        (countPerPage: number) => {
            setPageSize(countPerPage);
            if (!state.currentExecutionId) {
                // The result is not loaded yet, just set the page size
                dispatcher.setPageSize(countPerPage);
                return;
            }

            setIsOpen(true);
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
            <AlertDialog
                isOpen={isOpen}
                onClose={handleDialogClose}
                title={l10n.t('Attention')}
                confirmButtonText={l10n.t('Continue')}
                cancelButtonText={l10n.t('Close')}
            >
                <div>{l10n.t('All loaded data will be lost. The query will be executed again in new session.')}</div>
                <div>{l10n.t('Are you sure you want to continue?')}</div>
            </AlertDialog>
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
