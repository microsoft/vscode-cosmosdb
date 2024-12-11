/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getTRPCErrorFromUnknown } from '@trpc/server';
import * as vscode from 'vscode';
import { type API } from '../../../AzureDBExperiences';
import { appRouter, type BaseRouterContext } from '../configuration/appRouter';
import { type VsCodeLinkNotification, type VsCodeLinkRequestMessage } from '../webview-client/vscodeLink';
import { WebviewBaseController } from './WebviewBaseController';
import { createCallerFactory } from './trpc';

/**
 * WebviewController is a class that manages a vscode.WebviewPanel and provides
 * a way to communicate with it. It provides a way to register request handlers and reducers
 * that can be called from the webview. It also provides a way to post notifications to the webview.
 * @template Configuration The type of the configuration object that the webview will receive
 * @template Reducers The type of the reducers that the webview will use
 */
export class WebviewController<Configuration> extends WebviewBaseController<Configuration> {
    private _panel: vscode.WebviewPanel;

    /**
     * Creates a new WebviewController
     * @param context The context of the extension-server
     * @param title The title of the webview panel
     * @param webviewName The source file that the webview will use
     * @param initialState The initial state object that the webview will use
     * @param viewColumn The view column that the webview will be displayed in
     * @param _iconPath The icon path that the webview will use
     */
    constructor(
        context: vscode.ExtensionContext,
        protected dbExperience: API,
        title: string,
        webviewName: string,
        initialState: Configuration,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
        private _iconPath?:
            | vscode.Uri
            | {
                  readonly light: vscode.Uri;
                  readonly dark: vscode.Uri;
              },
    ) {
        super(context, webviewName, initialState);

        this._panel = vscode.window.createWebviewPanel('react-webview-' + webviewName, title, viewColumn, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(this.extensionContext.extensionPath)],
        });

        this._panel.webview.html = this.getDocumentTemplate(this._panel.webview);

        this._panel.iconPath = this._iconPath;

        this.registerDisposable(
            this._panel.onDidDispose(() => {
                this.dispose();
            }),
        );

        // This call sends messages to the Webview so it's called after the Webview creation.
        this.initializeBase();
    }

    protected _activeSubscriptions = new Map<string, AbortController>();

    /**
     * Sets up the tRPC (TypeScript Remote Procedure Call) for the webview panel.
     * This method registers a disposable listener for messages received from the webview,
     * and handles different types of operations such as subscriptions and procedure calls.
     *
     * @param context - The base router context used to create a caller for tRPC procedures.
     *
     * The method performs the following operations:
     * - Creates a caller factory using the provided appRouter.
     * - Registers a listener for messages received from the webview.
     * - Handles 'subscription' messages by creating an async iterator for the subscription procedure,
     *   posting messages to the webview with the results, and supporting cancellation using an AbortController.
     * - Handles 'subscription.stop' messages by aborting the active subscription.
     * - Handles other messages by calling the appropriate tRPC procedure and posting the result to the webview.
     *
     * The method ensures proper error handling by wrapping errors in tRPC error messages and posting them to the webview.
     *
     * @remarks
     * This function must be called in order to enable tRPC functionality for the webview.
     */
    protected setupTrpc(context: BaseRouterContext): void {
        const callerFactory = createCallerFactory(appRouter);

        this.registerDisposable(
            this._panel.webview.onDidReceiveMessage(async (message: VsCodeLinkRequestMessage) => {
                // Create a caller with the necessary context
                const caller = callerFactory(context);

                switch (message.op.type) {
                    case 'subscription': {
                        try {
                            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                            const procedure = caller[message.op.path];

                            if (typeof procedure !== 'function') {
                                throw new Error(`Procedure not found: ${message.op.path}`);
                            }

                            // TODO: In v12, tRPC is expected to support cancellation. In the meantime, we'll work with an AbortController to support cancellation.
                            const abortController = new AbortController();
                            this._activeSubscriptions.set(message.id, abortController);

                            context.signal = abortController.signal;

                            // Call the subscription procedure, which returns an observable
                            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
                            const asyncIter = await procedure(message.op.input);

                            void (async () => {
                                try {
                                    for await (const value of asyncIter) {
                                        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                                        this._panel.webview.postMessage({ id: message.id, result: value });
                                    }

                                    // If we exit the loop naturally, it's complete
                                    this._panel.webview.postMessage({ id: message.id, complete: true });
                                } catch (error) {
                                    // If the async iterator throws, send an error message
                                    const trpcErrorMessage = this.wrapInTrpcErrorMessage(error, message.id);
                                    this._panel.webview.postMessage(trpcErrorMessage);
                                } finally {
                                    // Once done, remove from active subscriptions
                                    this._activeSubscriptions.delete(message.id);
                                }
                            })();
                        } catch (error) {
                            const trpcErrorMessage = this.wrapInTrpcErrorMessage(error, message.id);
                            this._panel.webview.postMessage(trpcErrorMessage);
                        }

                        break;
                    }

                    case 'subscription.stop': {
                        // Stop the async generator by aborting it
                        const abortController = this._activeSubscriptions.get(message.id);
                        if (abortController) {
                            abortController.abort();
                            this._activeSubscriptions.delete(message.id);
                        }
                        break;
                    }

                    default:
                        try {
                            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                            const procedure = caller[message.op.path];

                            if (typeof procedure !== 'function') {
                                throw new Error(`Procedure not found: ${message.op.path}`);
                            }

                            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
                            const result = await procedure(message.op.input);

                            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                            const response = { id: message.id, result };

                            this._panel.webview.postMessage(response);
                        } catch (error) {
                            const trpcErrorMessage = this.wrapInTrpcErrorMessage(error, message.id);
                            this._panel.webview.postMessage(trpcErrorMessage);
                        }

                        break;
                }
            }),
        );
    }

    /**
     * Wraps an error into a TRPC error message format suitable for sending via `postMessage`.
     *
     * This function manually constructs the error object by extracting the necessary properties
     * from the `errorEntry`. This is important because when using `postMessage` to send data
     * from the extension to the webview, the data is serialized (e.g., using `JSON.stringify`).
     * During serialization, only own enumerable properties of the object are included, while
     * properties inherited from the prototype chain or non-enumerable properties are omitted.
     *
     * Error objects like instances of `Error` or `TRPCError` often have their properties
     * (such as `message`, `name`, and `stack`) either inherited from the prototype or defined
     * as non-enumerable. As a result, directly passing such error objects to `postMessage`
     * would result in the webview receiving an error object without these essential properties.
     *
     * By explicitly constructing a plain object with the required error properties, we ensure
     * that all necessary information is included during serialization and properly received
     * by the webview.
     *
     * @param error - The error to be wrapped.
     * @param operationId - The ID of the operation associated with the error.
     * @returns An object containing the operation ID and a plain error object with own enumerable properties.
     */
    wrapInTrpcErrorMessage(error: unknown, operationId: string) {
        const errorEntry = getTRPCErrorFromUnknown(error);

        return {
            id: operationId,
            error: {
                code: errorEntry.code,
                name: errorEntry.name,
                message: errorEntry.message,
                stack: errorEntry.stack,
                cause: errorEntry.cause,
            },
        };
    }

    protected _getWebview(): vscode.Webview {
        return this._panel.webview;
    }

    /**
     * Gets the vscode.WebviewPanel that the controller is managing
     */
    public get panel(): vscode.WebviewPanel {
        return this._panel;
    }

    /**
     * Displays the webview in the foreground
     * @param viewColumn The view column that the webview will be displayed in
     */
    public revealToForeground(viewColumn: vscode.ViewColumn = vscode.ViewColumn.One): void {
        this._panel.reveal(viewColumn, true);
    }

    /**
     * Posts a notification to the webview
     * @param notification The notification name that the webview will use to handle the notification
     * @param parameters The parameters that will be passed to the notification
     */
    public postNotification(notification: string, parameters: unknown) {
        const message: VsCodeLinkNotification = { notification: notification, parameters: parameters };
        this._panel.webview.postMessage({ type: 'VSLinkNotification', payload: message });
    }
}
