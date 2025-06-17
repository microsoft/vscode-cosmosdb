/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar } from '@fluentui/react-components';
import { ToolbarOverflowDividerTransparent } from '../../common/ToolbarOverflow/ToolbarOverflowDividerTransparent';
import { EditButton } from './EditButton';
import { RefreshButton } from './RefreshButton';
import { SaveButton } from './SaveButton';
import { useDocumentState } from './state/DocumentContext';

export const DocumentToolbar = () => {
    const state = useDocumentState();

    const isReady = state.isReady;
    const isReadOnly = state.mode === 'view';

    return (
        <>
            <Toolbar size={'small'}>
                {isReady && !isReadOnly && <SaveButton type={'button'} />}
                {isReady && isReadOnly && <EditButton type={'button'} />}

                <ToolbarOverflowDividerTransparent />

                <RefreshButton type={'button'} />
            </Toolbar>
        </>
    );
};
