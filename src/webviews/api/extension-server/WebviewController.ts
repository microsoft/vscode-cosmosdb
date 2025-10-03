/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getTRPCErrorFromUnknown } from '@trpc/server';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type API } from '../../../AzureDBExperiences';
import { appRouter, type BaseRouterContext } from '../configuration/appRouter';
import { type VsCodeLinkRequestMessage } from '../webview-client/vscodeLink';
import { WebviewBaseController } from './WebviewBaseController';
import { createCallerFactory } from './trpc';

/**
 * WebviewController is a class that manages a vscode.WebviewPanel and provides
 * a way to communicate with it. It uses tRPC to handle incoming requests (queries,
 * mutations, and subscriptions) from the webview. Through this controller, the
 * webview can call server-side procedures defined in the `appRouter`.
 *
 * @template Configuration - The type of the configuration object that the webview will receive.
 */
export class WebviewController<Configuration> extends WebviewBaseController<Configuration> {
    private _panel: vscode.WebviewPanel;

    /**
     * Creates a new WebviewController instance.
     *
     * @param context      The extension context.
     * @param dbExperience A reference to the API object associated with this webview.
     * @param title        The title of the webview panel.
     * @param webviewName  The identifier/name for the webview resource.
     * @param initialState The initial state object that the webview will use on startup.
     * @param viewColumn   The view column in which to show the new webview panel.
     * @param _iconPath    An optional icon to display in the tab of the webview.
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

        // Create the webview panel
        this._panel = vscode.window.createWebviewPanel('react-webview-' + webviewName, title, viewColumn, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(this.extensionContext.extensionPath)],
        });

        this._panel.webview.html = this.getDocumentTemplate(this._panel.webview);
        this._panel.iconPath = this._iconPath;

        // Clean up when the panel is disposed
        this.registerDisposable(
            this._panel.onDidDispose(() => {
                this.dispose();
            }),
        );

        // Initializes the base functionality (like sending initial configuration) after creating the panel
        this.initializeBase();
    }

    /**
     * A map tracking active subscriptions by their operation ID.
     * Each subscription is associated with an AbortController, allowing the server
     * side to cancel the subscription if requested by the client.
     */
    protected _activeSubscriptions = new Map<string, AbortController>();

    /**
     * Sets up tRPC integration for the webview. This includes listening for messages from the webview,
     * parsing them as tRPC operations (queries, mutations, subscriptions, or subscription stops),
     * invoking the appropriate server-side procedures, and returning results or errors.
     *
     * After refactoring, the switch-case is now delegated to separate handler functions
     * for improved clarity.
     *
     * @param context - The base router context for procedure calls.
     */
    protected setupTrpc(context: BaseRouterContext): void {
        this.registerDisposable(
            this._panel.webview.onDidReceiveMessage(async (message: VsCodeLinkRequestMessage) => {
                switch (message.op.type) {
                    case 'subscription':
                        await this.handleSubscriptionMessage(message, context);
                        break;

                    case 'subscription.stop':
                        this.handleSubscriptionStopMessage(message);
                        break;

                    default:
                        await this.handleDefaultMessage(message, context);
                        break;
                }
            }),
        );
    }

    /**
     * Handles the 'subscription' message type.
     *
     * Sets up an async iterator for the subscription procedure and streams results back
     * to the webview. Also handles cancellation via AbortController.
     *
     * @param message - The original message from the webview.
     * @param caller - The tRPC caller for invoking the subscription procedure.
     * @param context - The base router context, to which we add an abort signal.
     */
    private async handleSubscriptionMessage(message: VsCodeLinkRequestMessage, context: BaseRouterContext) {
        try {
            const callerFactory = createCallerFactory(appRouter);
            const caller = callerFactory(context);

            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const procedure = caller[message.op.path];

            if (typeof procedure !== 'function') {
                throw new Error(l10n.t('Procedure not found: {name}', { name: message.op.path }));
            }

            // In v12, tRPC will have better cancellation support. For now, we use AbortController.
            const abortController = new AbortController();
            this._activeSubscriptions.set(message.id, abortController);

            // Attach the abort signal to the context for the subscription
            context.signal = abortController.signal;

            // Await the procedure call to get the async iterator (async generator) for the subscription
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
            const asyncIter = await procedure(message.op.input);

            void (async () => {
                try {
                    for await (const value of asyncIter) {
                        // Each yielded value is sent to the webview
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                        this._panel.webview.postMessage({ id: message.id, result: value });
                    }

                    // On natural completion, inform the client
                    this._panel.webview.postMessage({ id: message.id, complete: true });
                } catch (error) {
                    const trpcErrorMessage = this.wrapInTrpcErrorMessage(error, message.id);
                    this._panel.webview.postMessage(trpcErrorMessage);
                } finally {
                    this._activeSubscriptions.delete(message.id);
                }
            })();
        } catch (error) {
            const trpcErrorMessage = this.wrapInTrpcErrorMessage(error, message.id);
            this._panel.webview.postMessage(trpcErrorMessage);
        }
    }

    /**
     * Handles the 'subscription.stop' message type.
     *
     * Looks up the active subscription by ID and aborts it, stopping further data emission.
     *
     * @param message - The original message from the webview.
     */
    private handleSubscriptionStopMessage(message: VsCodeLinkRequestMessage) {
        const abortController = this._activeSubscriptions.get(message.id);
        if (abortController) {
            abortController.abort();
            this._activeSubscriptions.delete(message.id);
        }
    }

    /**
     * Handles the default case for messages (i.e., queries and mutations).
     *
     * Calls the specified tRPC procedure and returns a single result.
     * If the procedure is not found or throws, returns an error message.
     *
     * @param message - The original message from the webview.
     * @param caller - The tRPC caller for invoking the procedure.
     */
    private async handleDefaultMessage(message: VsCodeLinkRequestMessage, context: BaseRouterContext) {
        try {
            const callerFactory = createCallerFactory(appRouter);
            const caller = callerFactory(context);

            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const procedure = caller[message.op.path];

            if (typeof procedure !== 'function') {
                throw new Error(l10n.t('Procedure not found: {name}', { name: message.op.path }));
            }

            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
            const result = await procedure(message.op.input);

            // Send the result back to the client
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const response = { id: message.id, result };
            this._panel.webview.postMessage(response);
        } catch (error) {
            const trpcErrorMessage = this.wrapInTrpcErrorMessage(error, message.id);
            this._panel.webview.postMessage(trpcErrorMessage);
        }
    }

    /**
     * Converts an unknown error into a tRPC-compatible error response.
     *
     * By constructing a plain object with enumerable properties, we ensure the client
     * receives a properly serialized error object over postMessage.
     *
     * @param error - The caught error.
     * @param operationId - The operation ID associated with the error.
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

    /**
     * Retrieves the vscode.Webview associated with this controller.
     * @returns The webview being managed by this controller.
     */
    protected _getWebview(): vscode.Webview {
        return this._panel.webview;
    }

    /**
     * Gets the vscode.WebviewPanel that the controller is managing.
     */
    public get panel(): vscode.WebviewPanel {
        return this._panel;
    }

    /**
     * Reveals the webview in the given column, bringing it to the foreground.
     * Useful if the webview is already open but hidden.
     *
     * @param viewColumn The column to reveal in. Defaults to ViewColumn.One.
     */
    public revealToForeground(viewColumn: vscode.ViewColumn = vscode.ViewColumn.One): void {
        this._panel.reveal(viewColumn, true);
    }
}
