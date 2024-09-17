import Editor, { loader } from '@monaco-editor/react';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { useState } from 'react';
import { useThemeMutationObserver } from '../../theme/DynamicThemeProvider';
import { useVSCodeTheme } from '../../theme/themeGenerator';

loader.config({ monaco: monacoEditor });

export type DataViewPanelJSONProps = {
    value: string;
};

export const DataViewPanelJSON = ({ value }: DataViewPanelJSONProps) => {
    const [themeKind, setThemeKind] = useState(useVSCodeTheme());

    useThemeMutationObserver(setThemeKind);

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
            defaultLanguage={'json'}
            theme={getVscodeTheme(themeKind)}
            defaultValue={value}
            options={{ domReadOnly: true, readOnly: true }}
        />
    );
};
