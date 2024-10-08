/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { useEffect, useRef, useState, type JSX } from 'react';

import { Label, Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, SaveRegular, TextGrammarCheckmarkRegular } from '@fluentui/react-icons';
import { Editor, loader } from '@monaco-editor/react';
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
            __mode?: string;
            __databaseName: string;
            __collectionName: string;
            __documentId: string;
            __documentContent: string;
            __vsCodeApi: WebviewApi<unknown>;
            [key: string]: unknown; // Optional: Allows any other properties in config
        };
    }
}

interface DocumentToolbarProps {
    onValidateRequest: () => void;
    onRefreshRequest: () => void;
    onSaveRequest: () => void;
}

export const DocumentToolbar = ({
    onValidateRequest,
    onRefreshRequest,
    onSaveRequest,
}: DocumentToolbarProps): JSX.Element => {
    return (
        <Toolbar size="small">
            <Tooltip content="Save document to the database" relationship="description" withArrow>
                <ToolbarButton
                    onClick={onSaveRequest}
                    aria-label="Save to the database"
                    icon={<SaveRegular />}
                    appearance={'primary'}
                    disabled={window.config?.__mode !== 'add'}
                >
                    Save
                </ToolbarButton>
            </Tooltip>

            <ToolbarDividerTransparent />

            <Tooltip content="Check document syntax" relationship="description" withArrow>
                <ToolbarButton
                    onClick={onValidateRequest}
                    aria-label="Check document syntax"
                    icon={<TextGrammarCheckmarkRegular />}
                    disabled={true}
                >
                    Validate
                </ToolbarButton>
            </Tooltip>

            <Tooltip content="Reload original document from the database" relationship="description" withArrow>
                <ToolbarButton
                    onClick={onRefreshRequest}
                    aria-label="Reload original document from the database"
                    icon={<ArrowClockwiseRegular />}
                    disabled={window.config?.__mode !== 'add'}
                >
                    Refresh
                </ToolbarButton>
            </Tooltip>
        </Toolbar>
    );
};

export const DocumentView = (): JSX.Element => {
    //TODO: this approach is temporary until we move to better base class and messaging
    const staticContent: string = decodeURIComponent(window.config?.__documentContent ?? '{ }');
    const [editorContent] = useState(staticContent);

    const editor = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);

    // quick/temp solution
    function handleMessage(event): void {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        switch (event.data?.type) {
            case 'response.documentView.refreshDocument': {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                const documentContent = (event.data?.payload.documentContent as string) ?? '{  }';

                editor.current?.setValue(documentContent);

                break;
            }
            case 'response.documentView.saveDocument': {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                const documentContent = (event.data?.payload.documentContent as string) ?? '{  }';

                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                const newDocumentId = (event.data?.payload.documentId as string) ?? '';

                if (window.config) {
                    window.config.__documentId = newDocumentId;
                }

                editor.current?.setValue(documentContent);
                break;
            }
            default:
                return;
        }
    }

    useEffect(() => {
        window.addEventListener('message', handleMessage);

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    function onMount(_editor: monacoEditor.editor.IStandaloneCodeEditor, _monaco: typeof monacoEditor) {
        editor.current = _editor;

        /**
         * The code below is an experimetnal code to show how to use monaco editor with JSON schema validation.
         * We'll be using something along this line in the future to validate documents.
         */

        // const modelUri = 'foo://myapp/custom.json1';
        // const model = _monaco.editor.createModel(`{ "type":  }`, 'json', _monaco.Uri.parse(modelUri));
        // // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        // editor.current.setModel(model);
        // _monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        //     ..._monaco.languages.json.jsonDefaults.diagnosticsOptions,
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

    function handleOnRefreshRequest(): void {
        const documentId: string = window.config?.__documentId as string;

        window.config?.__vsCodeApi.postMessage({
            type: 'request.documentView.refreshDocument',
            payload: {
                documentId: documentId,
            },
        });
    }

    function handleOnSaveRequest(): void {
        const editorContent = editor.current?.getValue();

        window.config?.__vsCodeApi.postMessage({
            type: 'request.documentView.saveDocument',
            payload: {
                // we're not setting the ID here becasue it has to be extracted from the document being sent over
                documentContent: editorContent,
            },
        });
    }

    function handleOnValidateRequest(): void {}

    return (
        <div className="documentView">
            <DocumentToolbar
                onSaveRequest={handleOnSaveRequest}
                onValidateRequest={handleOnValidateRequest}
                onRefreshRequest={handleOnRefreshRequest}
            />

            {window.config?.__mode === 'add' && (
                <Label size="small" className="privatePreview">
                    <b>Private Preview:</b> Currently supports a subset of BSON datatypes that map easily to JSON, which
                    is why editing existing documents is disabled in this view. Full BSON support and editing
                    capabilities will be available in future updates!
                </Label>
            )}

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
