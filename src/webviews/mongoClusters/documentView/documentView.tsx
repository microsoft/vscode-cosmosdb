/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { loader } from '@monaco-editor/react';
import { type JSX, useEffect, useRef, useState } from 'react';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

import { ProgressBar } from '@fluentui/react-components';
import debounce from 'lodash.debounce';
import { useConfiguration } from '../../api/webview-client/useConfiguration';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { MonacoEditor } from '../../MonacoEditor';
import { ToolbarDocuments } from './components/toolbarDocuments';
import { type DocumentsViewWebviewConfigurationType } from './documentsViewController';
import './documentView.scss';

loader.config({ monaco: monacoEditor });

const monacoOptions = {
    minimap: {
        enabled: true,
    },
    scrollBeyondLastLine: false,

    readOnly: false,
    automaticLayout: false,
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
    const { trpcClient /*, vscodeEventTarget*/ } = useTrpcClient();

    const [editorContent] = configuration.mode === 'add' ? useState('{  }') : useState('{ "loading...": true }');
    const [isLoading, setIsLoading] = useState(configuration.mode !== 'add');
    const [isDirty, setIsDirty] = useState(true);

    // a useEffect without a dependency runs only once after the first render only
    useEffect(() => {
        if (configuration.mode !== 'add') {
            const documentId: string = configuration.documentId;

            setIsLoading(true);

            void trpcClient.mongoClusters.documentView.getDocumentById
                .query(documentId)
                .then((response) => {
                    setContent(response);
                })
                .catch((error) => {
                    void trpcClient.common.displayErrorMessage.mutate({
                        message: 'Error while loading the document',
                        modal: false,
                        cause: error instanceof Error ? error.message : String(error),
                    });
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    }, []);

    const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
    const getCurrentContent = () => editorRef.current?.getValue() || '';
    const setContent = (newValue: string) => editorRef.current?.setValue(newValue);

    // useEffect(() => { // example of handling notifications from the extension
    //     const handleNotification = (event: Event) => {
    //         const customEvent = event as CustomEvent<VsCodeLinkNotification>;
    //         const notification = customEvent.detail;

    //         // Handle the notification data, just playing with it
    //         console.log('Handling notification:', notification);
    //     };

    //     vscodeEventTarget.addEventListener('VsCodeLinkNotification', handleNotification);

    //     return () => {
    //         vscodeEventTarget.removeEventListener('VsCodeLinkNotification', handleNotification);
    //     };
    // }, [vscodeEventTarget]);

    const handleMonacoEditorMount = (
        editor: monacoEditor.editor.IStandaloneCodeEditor,
        _monaco: typeof monacoEditor,
    ) => {
        // Store the editor instance in ref
        editorRef.current = editor;

        handleResize();

        // initialize the monaco editor with the schema that's basic
        // as we don't know the schema of the collection available
        // this is a fallback for the case when the autocompletion feature fails.
        // monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        //     validate: true,
        //     schemas: [
        //         {
        //             uri: 'mongodb-filter-query-schema.json', // Unique identifier
        //             fileMatch: ['*'], // Apply to all JSON files or specify as needed
        //             // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        //             schema: basicFindQuerySchema,
        //             // schema: generateMongoFindJsonSchema(fieldEntries)
        //         },
        //     ],
        // });
    };

    const handleResize = () => {
        if (editorRef.current) {
            editorRef.current.layout();
        }
    };

    useEffect(() => {
        // Add the debounced resize event listener
        const debouncedResizeHandler = debounce(handleResize, 200);
        window.addEventListener('resize', debouncedResizeHandler);

        // Initial layout adjustment
        handleResize();

        // Clean up on component unmount
        return () => {
            if (editorRef.current) {
                editorRef.current.dispose();
            }
            window.removeEventListener('resize', debouncedResizeHandler);
        };
    }, []);

    // function onMonacoMount(_editor: monacoEditor.editor.IStandaloneCodeEditor, _monaco: typeof monacoEditor) {
    //     editor.current = _editor;

    //     /**
    //      * The code below is an experimetnal code to show how to use monaco editor with JSON schema validation.
    //      * We'll be using something along this line in the future to validate documents.
    //      */

    //     // const modelUri = 'foo://myapp/custom.json1';
    //     // const model = _monaco.editor.createModel(`{ "type":  }`, 'json', _monaco.Uri.parse(modelUri));
    //     // // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    //     // editor.current.setModel(model);
    //     // _monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    //     //     ..._monaco.languages.json.jsonDefaults.diagnosticsOptions,
    //     //     allowComments: true,
    //     //     schemas: [
    //     //         {
    //     //             uri: 'foo://myapp/segment/type',
    //     //             fileMatch: ['*.json1'],
    //     //             schema: {
    //     //                 type: 'object',
    //     //                 properties: {
    //     //                     type: {
    //     //                         enum: ['v1', 'v2'],
    //     //                         description: 'comment extracted from schema',
    //     //                         markupDescription: 'comment *extracted* from schema',
    //     //                     },
    //     //                 },
    //     //             },
    //     //         },
    //     //     ],
    //     //     validate: true,
    //     // });
    // }

    function handleOnRefreshRequest(): void {
        if (configuration.documentId === undefined) {
            return;
        }

        setIsLoading(true);

        let documentLength = 0;

        void trpcClient.mongoClusters.documentView.getDocumentById
            .query(configuration.documentId)
            .then((response) => {
                documentLength = response.length ?? 0;
                setContent(response);
            })
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: 'Error while refreshing the document',
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            })
            .finally(() => {
                setIsLoading(false);
            });

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'refreshDocument',
                properties: {
                    ui: 'button',
                },
                measurements: {
                    documentLength: documentLength,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    }

    function handleOnSaveRequest(): void {
        const editorContent = getCurrentContent();

        if (editorContent === undefined) {
            return;
        }

        setIsLoading(true);

        // we're not sending the ID over becasue it has to be extracted from the document being sent over
        // TODO: how to handle the case when one is editing a document and actually changing the _id field?
        // this needs to be addressed, we do have to transmit the orignal _id field as well!
        void trpcClient.mongoClusters.documentView.saveDocument
            .mutate({ documentContent: editorContent })
            .then((response) => {
                // update the configuration for potential refreshes of the document
                configuration.documentId = response.documentId;
                setContent(response.documentStringified);
                setIsLoading(false);
                setIsDirty(false);
            })
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: 'Error saving the document',
                    modal: true, // we want to show the error in a modal dialog as it's an important one, failed to save the document
                    cause: error instanceof Error ? error.message : String(error),
                });
            })
            .finally(() => {
                setIsLoading(false);
            });

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'saveDocument',
                properties: {
                    ui: 'button',
                },
                measurements: {
                    documentLength: editorContent.length,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    }

    function handleOnValidateRequest(): void {}

    return (
        <div className="documentView">
            <div className="toolbarContainer">
                {isLoading && <ProgressBar thickness="large" shape="square" className="progressBar" />}
                <ToolbarDocuments
                    disableSaveButton={configuration.mode === 'view' || !isDirty}
                    onSaveRequest={handleOnSaveRequest}
                    onValidateRequest={handleOnValidateRequest}
                    onRefreshRequest={handleOnRefreshRequest}
                />
            </div>
            <div className="monacoContainer">
                <MonacoEditor
                    height={'100%'}
                    width={'100%'}
                    language="json"
                    options={monacoOptions}
                    value={editorContent}
                    onMount={handleMonacoEditorMount}
                    onChange={() => {
                        setIsDirty(true);
                    }}
                />
            </div>
        </div>
    );
};
