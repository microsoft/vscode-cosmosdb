/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Editor, { loader, useMonaco, type EditorProps } from '@monaco-editor/react';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

import { useUncontrolledFocus } from '@fluentui/react-components';
import { useEffect } from 'react';
import { useThemeState } from './theme/state/ThemeContext';

loader.config({ monaco: monacoEditor });

export const MonacoEditor = (props: EditorProps) => {
    const monaco = useMonaco();
    const themeState = useThemeState();
    const attr = useUncontrolledFocus();

    useEffect(() => {
        if (monaco) {
            if (themeState.monaco.theme) {
                monaco.editor.defineTheme(themeState.monaco.themeName, themeState.monaco.theme);
                monaco.editor.setTheme(themeState.monaco.themeName);
            }
        }
    }, [monaco, themeState]);

    return (
        <section {...attr} style={{ width: '100%', height: '100%' }}>
            <Editor {...props} theme={themeState.monaco.themeName} />
            <input
                style={{ position: 'absolute', width: '1px', height: '1px' }}
                id="monaco-editor-aria-container"
                aria-label="Element to prevent loosing focus from editor"
            />
        </section>
    );
};
