/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Editor, { loader } from '@monaco-editor/react';
import * as React from 'react';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

interface Props {
    value: string;
}

loader.config({ monaco: monacoEditor });

const monacoOptions = {
    // autoIndent: 'full',
    // contextmenu: true,
    // fontFamily: 'monospace',
    // fontSize: 13,
    // lineHeight: 24,
    // hideCursorInOverviewRuler: true,
    // matchBrackets: 'always',
    minimap: {
        enabled: true,
    },
    // scrollbar: {
    //   horizontalSliderSize: 4,
    //   verticalSliderSize: 18,
    // },
    // selectOnLineNumbers: true,
    // roundedSelection: false,
    readOnly: true,
    // cursorStyle: 'line',
    // automaticLayout: true,
};

export const DataViewPanelJSON = ({ value }: Props): React.JSX.Element => {
    React.useEffect(() => {
        console.log('JSON View has mounted');

        return () => {
            console.log('JSON View will unmount');
        };
    }, []); // Empty dependency array means this runs only once, like componentDidMount

    return <Editor height={'100%'} width={'100%'} language="json" options={monacoOptions} value={value} />;
};
