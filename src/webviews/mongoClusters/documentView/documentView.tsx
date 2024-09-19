// eslint-disable-next-line import/no-internal-modules
import { type JSX } from 'react';

import { Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, SaveRegular, TextGrammarCheckmarkRegular } from '@fluentui/react-icons';
import { Editor, loader } from '@monaco-editor/react';
import React from 'react';
import { type WebviewApi } from 'vscode-webview';
import { ToolbarDividerTransparent } from '../collectionView/components/ToolbarDividerTransparent';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

import './documentView.scss';

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
    readOnly: false,
    // cursorStyle: 'line',
    // automaticLayout: true,
};

declare global {
    interface Window {
        config?: {
            __id?: string;
            __liveConnectionId?: string;
            __databaseName: string;
            __collectionName: string;
            __documentId: string;
            __documentContent: string;
            __vsCodeApi: WebviewApi<unknown>;
            [key: string]: unknown; // Optional: Allows any other properties in config
        };
    }
}

export const DocumentToolbar = (): JSX.Element => {
    return (
        <Toolbar size="small">
            <Tooltip content="Save document to the database" relationship="description" withArrow>
                <ToolbarButton aria-label="Save to the database" icon={<SaveRegular />} appearance={'primary'}>
                    Save
                </ToolbarButton>
            </Tooltip>

            <ToolbarDividerTransparent />

            <Tooltip content="Check document syntax" relationship="description" withArrow>
                <ToolbarButton aria-label="Check document syntax" icon={<TextGrammarCheckmarkRegular />}>
                    Validate
                </ToolbarButton>
            </Tooltip>

            <Tooltip content="Reload original document from the database" relationship="description" withArrow>
                <ToolbarButton aria-label="Reload original document from the database" icon={<ArrowClockwiseRegular />}>
                    Refresh
                </ToolbarButton>
            </Tooltip>
        </Toolbar>
    );
};

export const DocumentView = (): JSX.Element => {
    const editorContent: string = JSON.stringify(window.config?.__documentContent ?? '{ }', null, 4);

    React.useEffect(() => {
        console.log('Document View has mounted');

        return () => {
            console.log('Document View will unmount');
        };
    }, []); // Empty dependency array means this runs only once, like componentDidMount

    function onMount(_editor: monacoEditor.editor.IStandaloneCodeEditor, _monaco: typeof monacoEditor) {
        // const modelUri = 'foo://myapp/custom.json1';
        // const model = monaco.editor.createModel(`{ "type":  }`, 'json', monaco.Uri.parse(modelUri));
        // editor.setModel(model);
        // monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        //     ...monaco.languages.json.jsonDefaults.diagnosticsOptions,
        //     allowComments: true,
        //     schemas: [
        //         {
        //             uri: 'foo://myapp/segment/type',
        //             fileMatch: ['*.json1'],
        //             schema: {
        //                 type: 'object',
        //                 properties: {
        //                     type: {
        //                         enum: ['v1', 'v2'],
        //                         description: 'comment extracted from schema',
        //                         markupDescription: 'comment *extracted* from schema',
        //                     },
        //                 },
        //             },
        //         },
        //     ],
        //     validate: true,
        // });
    }

    return (
        <div className="documentView">
            <DocumentToolbar />

            <Editor
                height={'100%'}
                width={'100%'}
                language="json"
                options={monacoOptions}
                value={editorContent}
                onMount={onMount}
            />
        </div>
    );
};
