// eslint-disable-next-line import/no-internal-modules
import { useContext, useEffect, useRef, useState, type JSX } from 'react';

import { Label, Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, SaveRegular, Star20Regular, TextGrammarCheckmarkRegular } from '@fluentui/react-icons';
import { Editor, loader } from '@monaco-editor/react';
import { type WebviewApi } from 'vscode-webview';
import { ToolbarDividerTransparent } from '../collectionView/components/ToolbarDividerTransparent';
// eslint-disable-next-line import/no-internal-modules
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { type VsCodeLinkNotification } from '../../api/webview-client/vscodeLink';
import { WebviewContext } from '../../WebviewContext';
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

declare global {
    interface Window {
        config?: {
            __id?: string;
            __initialData?: string;
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

/**
 * We only import the `AppRouter` type from the server - this is not available at runtime
 */

interface DocumentToolbarProps {
    viewerMode: string;
    onValidateRequest: () => void;
    onRefreshRequest: () => void;
    onSaveRequest: () => void;
    onExpRequest: () => void;
}

export const DocumentToolbar = ({
    viewerMode,
    onValidateRequest,
    onRefreshRequest,
    onSaveRequest,
    onExpRequest,
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
                    disabled={viewerMode !== 'add'}
                >
                    Refresh
                </ToolbarButton>
            </Tooltip>

            <ToolbarButton onClick={onExpRequest} icon={<Star20Regular />}>
                Experiment
            </ToolbarButton>
        </Toolbar>
    );
};

export const DocumentView = (): JSX.Element => {
    const { vscodeApi } = useContext(WebviewContext);

    //TODO: this approach is temporary until we move to better base class and messaging
    // const staticContent: string = decodeURIComponent(window.config?.__documentContent ?? '{ }');
    const configuration: DocumentsViewWebviewConfigurationType = JSON.parse(
        decodeURIComponent(window.config?.__initialData ?? '{  }'),
    ) as DocumentsViewWebviewConfigurationType;

    const staticContent: string = JSON.stringify(configuration.documentContent, null, 4);
    const [editorContent] = useState(staticContent);

    const editor = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);


    const { clientTrpc, vscodeEventTarget } = useTrpcClient();

    useEffect(() => {
      const handleNotification = (event: Event) => {
        const customEvent = event as CustomEvent<VsCodeLinkNotification>;
        const notification = customEvent.detail;
        // Handle the notification data
        console.log('Handling notification:', notification);
      };

      vscodeEventTarget.addEventListener('VsCodeLinkNotification', handleNotification);

      return () => {
        vscodeEventTarget.removeEventListener('VsCodeLinkNotification', handleNotification);
      };
    }, [vscodeEventTarget]);



    // function send(message: VsCodeLinkRequestMessage) {
    //     vscodeApi.postMessage(message);
    // }

    // function onReceive(callback: (message: VsCodeLinkResponseMessage) => void): () => void {
    //     const handler = (event: MessageEvent) => {
    //         // 1. Catch our VsCodeLinkNotification messages and pipe them to the webview directly
    //         if ((event.data as VsCodeLinkNotification).notification) {
    //             console.log('Received notification', event.data);
    //             return;
    //         }

    //         // 2. It's not a VsCodeLinkNotification, so it must be a VsCodeLinkResponseMessage
    //         //    ==> continue with tRPC message handling

    //         const message = (event.data as VsCodeLinkResponseMessage);
    //         callback(message);
    //     };
    //     window.addEventListener('message', handler);
    //     return () => {
    //         window.removeEventListener('message', handler);
    //     };
    // }

    // // Initialize the tRPC client
    // const clientTrpc = createTRPCClient<AppRouter>({
    //     links: [ loggerLink(), vscodeLink({ send, onReceive })],
    // });//loggerLink(),

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
        // const documentId: string = window.config?.__documentId as string;
        const documentId: string = configuration.documentId;

        vscodeApi.postMessage({
            type: 'request.documentView.refreshDocument',
            payload: {
                documentId: documentId,
            },
        });
    }

    function handleOnSaveRequest(): void {
        const editorContent = editor.current?.getValue();

        vscodeApi.postMessage({
            type: 'request.documentView.saveDocument',
            payload: {
                // we're not setting the ID here becasue it has to be extracted from the document being sent over
                documentContent: editorContent,
            },
        });
    }

    function handleOnExpRequest(): void {
        console.log('Experiment button clicked');

        // void clientTrpc.common.doSomething
        //     .mutate()
        //     .then((result) => {
        //         console.log(result);
        //     })
        //     .catch((error) => {
        //         console.error(error);
        //     });

        // void clientTrpc.bighello.query().then((result) => {
        //     console.log(result.text);
        // });

        void clientTrpc.common.sayMyName.query('asdf').then((result) => {
            console.log(result.text);
        });

        void clientTrpc.documentsView.getInfo.query().then((result) => {
            console.log(result);
        });

        // void clientTrpc.common.hello.query().then((result) => {
        //     console.log(result.text);
        // });
    }

    function handleOnValidateRequest(): void {}

    return (
        <div className="documentView">
            <DocumentToolbar
                viewerMode={configuration.mode}
                onSaveRequest={handleOnSaveRequest}
                onValidateRequest={handleOnValidateRequest}
                onRefreshRequest={handleOnRefreshRequest}
                onExpRequest={handleOnExpRequest}
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
