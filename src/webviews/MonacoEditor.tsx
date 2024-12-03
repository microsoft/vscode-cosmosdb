/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Editor, { loader, useMonaco, type EditorProps } from '@monaco-editor/react';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

import { useArrowNavigationGroup, useUncontrolledFocus } from '@fluentui/react-components';
import { useEffect } from 'react';
import { useThemeState } from './theme/state/ThemeContext';

loader.config({ monaco: monacoEditor });

export const MonacoEditor = (props: EditorProps) => {
    const monaco = useMonaco();
    const themeState = useThemeState();
    const uncontrolledFocus = useUncontrolledFocus();
    const navigationGroup = useArrowNavigationGroup({ circular: true, axis: 'both' });
    const tabsterHook = { ...navigationGroup, ...uncontrolledFocus }; // The order of these attributes is important

    useEffect(() => {
        if (monaco) {
            if (themeState.monaco.theme) {
                monaco.editor.defineTheme(themeState.monaco.themeName, themeState.monaco.theme);
                monaco.editor.setTheme(themeState.monaco.themeName);
            }
        }
    }, [monaco, themeState]);

    return (
        <section {...tabsterHook} style={{ width: '100%', height: '100%' }}>
            <Editor {...props} theme={themeState.monaco.themeName} />
        </section>
    );
};
