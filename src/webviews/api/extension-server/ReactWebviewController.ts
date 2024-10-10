/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { appRouter } from '../configuration/appRouter';
import { type VsCodeLinkRequestMessage } from '../webview-client/vscodeLink';
import { ReactWebviewBaseController } from './ReactWebviewBaseController';
import { createCallerFactory } from './trpc';

/**
 * ReactWebviewPanelController is a class that manages a vscode.WebviewPanel and provides
 * a way to communicate with it. It provides a way to register request handlers and reducers
 * that can be called from the webview. It also provides a way to post notifications to the webview.
 * @template Configuration The type of the configuration object that the webview will receive
 * @template Reducers The type of the reducers that the webview will use
 */
export class ReactWebviewPanelController<Configuration, Reducers> extends ReactWebviewBaseController<
    Configuration,
    Reducers
> {
    private _panel: vscode.WebviewPanel;

    /**
     * Creates a new ReactWebviewPanelController
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

        // this._panel.webview.html = this._getHtmlTemplate();
        this._panel.webview.html = this.getDocumentTemplate(this._panel.webview);

        this._panel.iconPath = this._iconPath;

        const callerFactory = createCallerFactory(appRouter);

        this.registerDisposable(
            this._panel.webview.onDidReceiveMessage(async (message: VsCodeLinkRequestMessage) => {
                console.log('Received message from webview:', message);

                // Create a caller with the necessary context
                const caller = callerFactory({});

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

                            console.log('Responding with:', response);

                            this._panel.webview.postMessage(response);
                        } catch (error) {
                            console.log(error);
                        }

                        break;
                }
            }),
        );

        this.registerDisposable(
            this._panel.onDidDispose(() => {
                this.dispose();
            }),
        );

        // This call sends messages to the Webview so it's called after the Webview creation.
        this.initializeBase();
    }

    getProcedureFromPath(caller: unknown, path: string): unknown {
        const keys = path.split('.');
        let obj = caller;

        for (const key of keys) {
            if (obj !== null && (typeof obj === 'object' || typeof obj === 'function') && Object.prototype.hasOwnProperty.call(obj, key)
            ) {
                obj = obj[key];
            } else {
                throw new Error(`Procedure not found at path: ${path}`);
            }
        }

        if (typeof obj !== 'function') {
            throw new Error(`Procedure is not a function at path: ${path}`);
        }

        return obj;
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
}
