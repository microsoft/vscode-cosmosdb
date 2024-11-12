/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Editor, { loader, useMonaco, type EditorProps } from '@monaco-editor/react';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

import { useEffect } from 'react';
import { useThemeState } from './theme/state/ThemeContext';

loader.config({ monaco: monacoEditor });

export const MonacoEditor = (props: EditorProps) => {
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

    return <Editor {...props} theme={themeState.monaco.themeName} /*onMount={handleEditorDidMount}*/ />;
};
