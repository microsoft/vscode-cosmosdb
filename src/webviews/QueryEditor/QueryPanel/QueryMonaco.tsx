import Editor, { loader } from '@monaco-editor/react';
import { debounce } from 'lodash';
//import * as monacoEditor from 'monaco-editor';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { useMemo, useState } from 'react';
import { useThemeMutationObserver } from '../../theme/DynamicThemeProvider';
import { useVSCodeTheme } from '../../theme/themeGenerator';
import { useQueryEditorDispatcher, useQueryEditorState } from '../QueryEditorContext';

loader.config({ monaco: monacoEditor });

export const QueryMonaco = () => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const [themeKind, setThemeKind] = useState(useVSCodeTheme());

    useThemeMutationObserver(setThemeKind);

    const onChange = useMemo(
        () =>
            debounce((newValue: string) => {
                if (newValue !== state.queryValue) {
                    dispatcher.insertText(newValue);
                }
            }, 500),
        [dispatcher, state],
    );

    const getVscodeTheme = (themeKind: string) => {
        return themeKind === 'vscode-light'
            ? 'vs'
            : themeKind === 'vscode-dark'
              ? 'vs-dark'
              : themeKind === 'vscode-high-contrast'
                ? 'hc-black'
                : themeKind === 'vscode-high-contrast-light'
                  ? 'hc-light'
                  : 'light';
    };

    return (
        <Editor
            height={'100%'}
            width={'100%'}
            language="sql"
            theme={getVscodeTheme(themeKind)}
            value={state.queryValue}
            onChange={onChange}
        />
    );
};
