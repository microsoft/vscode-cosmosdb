/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { debounce } from 'lodash';
import { useMemo } from 'react';
import { MonacoEditor } from '../../MonacoEditor';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

export const QueryMonaco = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const onChange = useMemo(
        () =>
            debounce((newValue: string) => {
                if (newValue !== state.queryValue) {
                    dispatcher.insertText(newValue);
                }
            }, 500),
        [dispatcher, state],
    );

    return <MonacoEditor height={'100%'} width={'100%'} language="sql" value={state.queryValue} onChange={onChange} />;
};
