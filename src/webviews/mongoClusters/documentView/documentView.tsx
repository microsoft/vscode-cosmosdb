/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { type JSX, useEffect, useRef, useState } from 'react';
import { Editor, loader } from '@monaco-editor/react';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

import { useConfiguration } from '../../api/webview-client/useConfiguration';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { type VsCodeLinkNotification } from '../../api/webview-client/vscodeLink';
import { type DocumentsViewWebviewConfigurationType } from './documentsViewController';
import './documentView.scss';
import { ToolbarDocuments } from './components/toolbarDocuments';

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

export const DocumentView = (): JSX.Element => {
    /**
     * Use the configuration object to access the data passed to the webview at its creation.
     * Feel free to update the content of the object. It won't be synced back to the extension though.
     */
    const configuration = useConfiguration<DocumentsViewWebviewConfigurationType>();

    /**
     * Use the `useTrpcClient` hook to get the tRPC client and an event target
     * for handling notifications from the extension.
     */
    const { trpcClient, vscodeEventTarget } = useTrpcClient();

    const [editorContent] = configuration.mode === 'add' ? useState('{  }') : useState('{ "loading...": true }');

    // a useEffect without a dependency runs only once after the first render only
    useEffect(() => {
        if (configuration.mode !== 'add') {
            const documentId: string = configuration.documentId;

            void trpcClient.mongoClusters.documentView.getDocumentById.query(documentId).then((response) => {
                editor.current?.setValue(response);
            });
        }
    }, []);

    const editor = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);

    useEffect(() => {
        const handleNotification = (event: Event) => {
            const customEvent = event as CustomEvent<VsCodeLinkNotification>;
            const notification = customEvent.detail;

            // Handle the notification data, just playing with it
            console.log('Handling notification:', notification);
        };

        vscodeEventTarget.addEventListener('VsCodeLinkNotification', handleNotification);

        return () => {
            vscodeEventTarget.removeEventListener('VsCodeLinkNotification', handleNotification);
        };
    }, [vscodeEventTarget]);

    function onMonacoMount(_editor: monacoEditor.editor.IStandaloneCodeEditor, _monaco: typeof monacoEditor) {
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
        const documentId: string = configuration.documentId;

        void trpcClient.mongoClusters.documentView.getDocumentById.query(documentId).then((response) => {
            editor.current?.setValue(response);
        });
    }

    function handleOnSaveRequest(): void {
        const editorContent = editor.current?.getValue();

        if (editorContent === undefined) {
            return;
        }

        // we're not sending the ID over becasue it has to be extracted from the document being sent over
        void trpcClient.mongoClusters.documentView.saveDocument
            .mutate({ documentContent: editorContent })
            .then((response) => {
                // update the configuration for potential refreshes of the document
                configuration.documentId = response.documentId;
                editor.current?.setValue(response.documentStringified);
            });
    }

    function handleOnValidateRequest(): void {}

    return (
        <div className="documentView">
            <ToolbarDocuments
                viewerMode={configuration.mode}
                onSaveRequest={handleOnSaveRequest}
                onValidateRequest={handleOnValidateRequest}
                onRefreshRequest={handleOnRefreshRequest}
            />

            <Editor
                height={'100%'}
                width={'100%'}
                language="json"
                options={monacoOptions}
                value={editorContent}
                onMount={onMonacoMount}
            />
        </div>
    );
};
