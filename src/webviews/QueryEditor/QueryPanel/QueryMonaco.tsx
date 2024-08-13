import Editor, { loader, useMonaco } from '@monaco-editor/react';
//import * as monacoEditor from 'monaco-editor';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { useEffect, useState } from 'react';
import { useThemeMutationObserver } from '../../theme/DynamicThemeProvider';
import { useVSCodeTheme } from '../../themeGenerator';

const value = `SELECT * FROM c`;

loader.config({ monaco: monacoEditor });

export const QueryMonaco = () => {
    const monaco = useMonaco();
    const [themeKind, setThemeKind] = useState(useVSCodeTheme());

    useThemeMutationObserver(setThemeKind);

    const getVscodeTheme = (themeKind: string) => {
        return themeKind === 'vscode-light'
            ? 'light'
            : themeKind === 'vscode-dark'
              ? 'vs-dark'
              : themeKind === 'vscode-high-contrast'
                ? 'hc-black'
                : themeKind === 'vscode-high-contrast-light'
                  ? 'light' // TODO: find a better theme for this
                  : 'light';
    };

    useEffect(() => {
        if (monaco) {
            console.log('here is the monaco instance:', monaco);
        }
    }, [monaco]);

    return <Editor height={'100%'} width={'100%'} language="sql" theme={getVscodeTheme(themeKind)} value={value} />;
};
