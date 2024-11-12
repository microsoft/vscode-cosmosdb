/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { appRouter } from '../configuration/appRouter';
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
     * @param _context The context of the extension-server
     * @param title The title of the webview panel
     * @param webviewName The source file that the webview will use
     * @param initialState The initial state object that the webview will use
     * @param viewColumn The view column that the webview will be displayed in
     * @param _iconPath The icon path that the webview will use
     */
    constructor(
        _context: vscode.ExtensionContext,
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
        super(_context, webviewName, initialState);

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

    protected setupTrpc(context: object): void {
        const callerFactory = createCallerFactory(appRouter);

        this.registerDisposable(
            this._panel.webview.onDidReceiveMessage(async (message: VsCodeLinkRequestMessage) => {
                // Create a caller with the necessary context (currrently none, but maybe a telemetry hook later?)
                const caller = callerFactory(context);

                switch (message.op.type) {
                    // case 'subscription':
                    //     break;
                    // case 'subscription.stop':
                    //     break;
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
                            console.log(error);
                        }

                        break;
                }
            }),
        );
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
