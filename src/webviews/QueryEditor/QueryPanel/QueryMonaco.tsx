/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Editor, { loader, useMonaco } from '@monaco-editor/react';
import { debounce } from 'lodash';
//import * as monacoEditor from 'monaco-editor';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { useEffect, useMemo } from 'react';
import { useThemeState } from '../../theme/state/ThemeContext';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

loader.config({ monaco: monacoEditor });

export const QueryMonaco = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const monaco = useMonaco();
    const themeState = useThemeState();

    useEffect(() => {
        if (monaco) {
            if (themeState.monaco.theme) {
                monaco.editor.defineTheme(themeState.monaco.themeName, themeState.monaco.theme);
                monaco.editor.setTheme(themeState.monaco.themeName);
            }
        }
    }, [monaco, themeState]);

    const onChange = useMemo(
        () =>
            debounce((newValue: string) => {
                if (newValue !== state.queryValue) {
                    dispatcher.insertText(newValue);
                }
            }, 500),
        [dispatcher, state],
    );

    return (
        <Editor
            height={'100%'}
            width={'100%'}
            language="sql"
            theme={themeState.monaco.themeName}
            value={state.queryValue}
            onChange={onChange}
        />
    );
};
