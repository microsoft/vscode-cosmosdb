/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar } from '@fluentui/react-components';
import { useQueryEditorState } from '../state/QueryEditorContext';
import { ToolbarOverflowDividerTransparent } from '../ToolbarOverflowDividerTransparent';
import { ChangeViewModeDropdown } from './ChangeViewModeDropdown';
import { DeleteItemButton } from './DeleteItemButton';
import { EditItemButton } from './EditItemButton';
import { NewItemButton } from './NewItemButton';
import { ViewItemButton } from './ViewItemButton';

export const ResultTabToolbar = () => {
    const state = useQueryEditorState();

    return (
        <>
            <Toolbar size="small">
                {state.isEditMode && (
                    <>
                        <NewItemButton type={'button'} />
                        <ViewItemButton type={'button'} />
                        <EditItemButton type={'button'} />
                        <DeleteItemButton type={'button'} />
                        <ToolbarOverflowDividerTransparent padding={18} />
                    </>
                )}

                <ChangeViewModeDropdown />
            </Toolbar>
        </>
    );
};
