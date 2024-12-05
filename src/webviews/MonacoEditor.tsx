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
    const uncontrolledFocus = useUncontrolledFocus();

    useEffect(() => {
        if (monaco) {
            if (themeState.monaco.theme) {
                monaco.editor.defineTheme(themeState.monaco.themeName, themeState.monaco.theme);
                monaco.editor.setTheme(themeState.monaco.themeName);
            }
        }
    }, [monaco, themeState]);

    return (
        <section {...uncontrolledFocus} style={{ width: '100%', height: '100%' }}>
            <i
                // The hack to make the focus trap work
                // https://github.com/microsoft/fluentui/blob/0f490a4fea60df6b2ad0f5a6e088017df7ce1d54/packages/react-components/react-tabster/src/hooks/useTabster.ts#L34
                data-is-focus-trap-zone-bumper={true}
                style={{
                    position: 'fixed',
                    height: '1px',
                    width: '1px',
                    opacity: '0.001',
                    zIndex: '-1',
                    contentVisibility: 'hidden',
                    top: '0px',
                    left: '0px',
                }}
            ></i>
            <Editor {...props} data-is-focus-trap-zone-bumper={'true'} theme={themeState.monaco.themeName} />
        </section>
    );
};
