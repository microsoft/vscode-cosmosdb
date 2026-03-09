/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Option, Tooltip, type OptionOnSelectData } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback } from 'react';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { type GridLibrary } from '../state/QueryEditorState';

export const ChangeGridDropdown = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const onOptionSelect = useCallback(
        (data: OptionOnSelectData) => {
            if (data.optionValue) {
                dispatcher.setGridLibrary(data.optionValue as GridLibrary);
            }
        },
        [dispatcher],
    );

    return (
        <Tooltip content={l10n.t('Change grid library')} relationship="label" appearance="inverted" withArrow>
            <Dropdown
                onOptionSelect={(_event, data) => onOptionSelect(data)}
                style={{ minWidth: '200px', maxWidth: '200px' }}
                value={state.gridLibrary}
                defaultSelectedOptions={[state.tableViewMode]}
            >
                <Option key="AG Grid Community" value="AG Grid Community">
                    {'AG Grid Community'}
                </Option>
                <Option key="FluentUI" value="FluentUI">
                    {'FluentUI'}
                </Option>
                <Option key="Tanstack/FluentUI" value="Tanstack/FluentUI">
                    {'Tanstack/FluentUI'}
                </Option>
                <Option key="SVAR" value="SVAR">
                    {'SVAR'}
                </Option>
                <Option key="Slickgrid Universal" value="Slickgrid Universal">
                    {'Slickgrid Universal'}
                </Option>
                <Option key="React Data Grid" value="React Data Grid">
                    {'React Data Grid'}
                </Option>
                <Option key="React OSS Data Grid" value="React OSS Data Grid">
                    {'React OSS Data Grid'}
                </Option>
            </Dropdown>
        </Tooltip>
    );
};
