/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Option, Tooltip, type OptionOnSelectData } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback } from 'react';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { type TableViewMode } from '../state/QueryEditorState';

export const ChangeViewModeDropdown = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const onOptionSelect = useCallback(
        (data: OptionOnSelectData) => {
            if (data.optionValue) {
                dispatcher.setTableViewMode(data.optionValue as TableViewMode);
            }
        },
        [dispatcher],
    );

    return (
        <Tooltip content={l10n.t('Change view mode')} relationship="label" appearance="inverted" withArrow>
            <Dropdown
                onOptionSelect={(_event, data) => onOptionSelect(data)}
                style={{ minWidth: '100px', maxWidth: '100px' }}
                value={
                    state.tableViewMode === 'Tree'
                        ? l10n.t('Tree')
                        : state.tableViewMode === 'JSON'
                          ? l10n.t('JSON')
                          : l10n.t('Table')
                }
                defaultSelectedOptions={[state.tableViewMode]}
            >
                <Option key="Tree" value="Tree">
                    {l10n.t('Tree view')}
                </Option>
                <Option key="JSON" value="JSON">
                    {l10n.t('JSON view')}
                </Option>
                <Option key="Table" value="Table">
                    {l10n.t('Table view')}
                </Option>
            </Dropdown>
        </Tooltip>
    );
};
