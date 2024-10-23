/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useRef, useState, type JSX } from 'react';
import { MonacoEditor } from '../../../MonacoEditor';
import { CollectionViewContext } from '../collectionViewContext';

import { getTheme } from '@fluentui/react';

// eslint-disable-next-line import/no-internal-modules
import { type editor } from 'monaco-editor/esm/vs/editor/editor.api';

const theme = getTheme();

export const QueryEditor = ({ onQueryUpdate }): JSX.Element => {
    const [currentContext] = useContext(CollectionViewContext);

    const inputField = useRef<HTMLInputElement>(null);

    function runQuery() {
        const queryText = inputField.current?.value ?? '{}';
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        onQueryUpdate(queryText);
    }

    const monacoOptions: editor.IStandaloneEditorConstructionOptions = {
        // autoIndent: 'full',
        contextmenu: false,
        // fontFamily: 'monospace',
        fontSize: 14,
        lineHeight: 19,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        // matchBrackets: 'always',
        minimap: {
            enabled: false,
        },
        lineNumbers: 'off',
        scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
        },
        renderLineHighlight: 'none',
        // scrollbar: {
        //   horizontalSliderSize: 4,
        //   verticalSliderSize: 18,
        // },
        // selectOnLineNumbers: true,
        // roundedSelection: false,
        readOnly: false,
        // cursorStyle: 'line',
        // automaticLayout: true,
        scrollBeyondLastLine: false,
    };

    const [editorHeight, setEditorHeight] = useState<number>(1 * 19); // Initial height

    return (
        <div
            className="monacoEditorContainer"
            style={
                {
                    height: editorHeight,
                    '--textbox-border-color': theme.palette.neutralLight, // Pass Fluent UI color as CSS variable
                } as React.CSSProperties
            }
        >
            <MonacoEditor
                height={'100%'}
                width={'100%'}
                language="json"
                adaptiveHeight={{
                    enabled: true,
                    maxLines: 10,
                    minLines: 1,
                    lineHeight: 19,
                    onEditorContentHeightChange: (height) => {
                        setEditorHeight(height); // Dynamically update the outer component's height
                    },
                }}
                onExecute={(input) => {
                    console.log(input);
                }}
                options={monacoOptions}
            />
        </div>
    );
};
