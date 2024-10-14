// eslint-disable-next-line import/no-internal-modules
import { useEffect, useRef, useState, type JSX } from 'react';

import { Label, Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, SaveRegular, TextGrammarCheckmarkRegular } from '@fluentui/react-icons';
import { Editor, loader } from '@monaco-editor/react';
import { ToolbarDividerTransparent } from '../collectionView/components/ToolbarDividerTransparent';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

import { useConfiguration } from '../../api/webview-client/useConfiguration';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { type VsCodeLinkNotification } from '../../api/webview-client/vscodeLink';
import { type DocumentsViewWebviewConfigurationType } from './DocumentsViewController';
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

interface DocumentToolbarProps {
    viewerMode: string;
    onValidateRequest: () => void;
    onRefreshRequest: () => void;
    onSaveRequest: () => void;
}

export const DocumentToolbar = ({
    viewerMode,
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
                    disabled={viewerMode !== 'add'}
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
                >
                    Refresh
                </ToolbarButton>
            </Tooltip>
        </Toolbar>
    );
};

export const DocumentView = (): JSX.Element => {
    const configuration = useConfiguration<DocumentsViewWebviewConfigurationType>();
    const { clientTrpc, vscodeEventTarget } = useTrpcClient();

    const [firstLoad, setFirstLoad] = useState(true);

    const [editorContent] = useState('{ "loading...": true }');

    useEffect(() => {
        if (firstLoad) {
            if (configuration.mode !== 'add') {
                const documentId: string = configuration.documentId;

                void clientTrpc.mongoClusters.documentView.getDocumentById.query(documentId).then((response) => {
                    editor.current?.setValue(response);
                });
            }

            setFirstLoad(false);
        }
    }, [firstLoad]);

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
        const documentId: string = configuration.documentId;

        void clientTrpc.mongoClusters.documentView.getDocumentById.query(documentId).then((response) => {
            editor.current?.setValue(response);
        });
    }

    function handleOnSaveRequest(): void {
        const editorContent = editor.current?.getValue();

        if (editorContent === undefined) {
            return;
        }

        // we're not sending the ID over becasue it has to be extracted from the document being sent over
        void clientTrpc.mongoClusters.documentView.saveDocument.mutate({ documentContent: editorContent }).then((response) => {
            // update the configuration for potential refreshes of the document
            configuration.documentId = response.documentId;
            editor.current?.setValue(response.documentContent);
        });
    }

    function handleOnValidateRequest(): void {}

    return (
        <div className="documentView">
            <DocumentToolbar
                viewerMode={configuration.mode}
                onSaveRequest={handleOnSaveRequest}
                onValidateRequest={handleOnValidateRequest}
                onRefreshRequest={handleOnRefreshRequest}
            />

            {configuration.mode === 'add' && (
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
