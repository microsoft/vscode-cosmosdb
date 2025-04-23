/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';

const DEV_SERVER_HOST = 'http://localhost:18080';

/**
 * WebviewBaseController is a class that manages a vscode.Webview and provides
 * a way to communicate with it. It provides a way to register request handlers and reducers
 * that can be called from the webview. It also provides a way to post notifications to the webview.
 * @template Configuration The type of the configuration object that the webview will receive
 */
export abstract class WebviewBaseController<Configuration> implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _isDisposed: boolean = false;

    // private _isFirstLoad: boolean = true;
    // private _loadStartTime: number = Date.now();
    private _onDisposed: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

    public readonly onDisposed: vscode.Event<void> = this._onDisposed.event;

    // these are kept for reference (for the telemetry work that's scheduled soon)
    // protected _webviewMessageHandler = async (message) => {
    //     if (message.type === 'request') {
    //         const handler = this._webviewRequestHandlers[message.method];
    //         if (handler) {
    //             //const _startTime = Date.now();
    //             const result = await handler(message.params);
    //             this.postMessage({ type: 'response', id: message.id, result });
    //             //const _endTime = Date.now();
    //             // sendActionEvent( --> TELEMETRY
    //             //     TelemetryViews.WebviewController,
    //             //     TelemetryActions.WebviewRequest,
    //             //     {
    //             //         type: this._webviewName,
    //             //         method: message.method,
    //             //         reducer:
    //             //             message.method === "action"
    //             //                 ? message.params.type
    //             //                 : undefined,
    //             //     },
    //             //     {
    //             //         durationMs: endTime - startTime,
    //             //     },
    //             // );
    //         } else {
    //             throw new Error(`No handler registered for method ${message.method}`);
    //         }
    //     }
    // };

    /**
     * Creates a new ReactWebviewPanelController
     * @param extensionContext The context of the extension-server
     * @param _webviewName The source file that the webview will use
     * @param configuration The initial state object that the webview will use
     */
    constructor(
        protected extensionContext: vscode.ExtensionContext,
        private _webviewName: string,
        protected configuration: Configuration,
    ) {}

    protected initializeBase() {
        this._registerDefaultRequestHandlers();
        // these are kept for reference
        //this.setupTheming();
    }

    protected registerDisposable(disposable: vscode.Disposable) {
        this._disposables.push(disposable);
    }

    protected getDocumentTemplate(webview?: vscode.Webview) {
        const devServer = !!process.env.DEVSERVER;
        const isProduction = ext.context.extensionMode === vscode.ExtensionMode.Production;
        const nonce = randomBytes(16).toString('base64');

        const dir = ext.isBundle ? '' : 'out/src/webviews';
        const filename = ext.isBundle ? 'views.js' : 'index.js';
        const uri = (...parts: string[]) =>
            webview?.asWebviewUri(vscode.Uri.file(path.join(ext.context.extensionPath, dir, ...parts))).toString(true);

        const srcUri = isProduction || !devServer ? uri(filename) : `${DEV_SERVER_HOST}/${filename}`;

        const csp = (
            isProduction
                ? [
                      `form-action 'none';`,
                      `default-src ${webview?.cspSource};`,
                      `script-src ${webview?.cspSource} 'nonce-${nonce}';`,
                      `style-src ${webview?.cspSource} vscode-resource: 'unsafe-inline';`,
                      `img-src ${webview?.cspSource} data: vscode-resource:;`,
                      `connect-src ${webview?.cspSource} ws:;`,
                      `font-src ${webview?.cspSource};`,
                      `worker-src ${webview?.cspSource} blob:;`,
                  ]
                : [
                      `form-action 'none';`,
                      `default-src ${webview?.cspSource} ${DEV_SERVER_HOST};`,
                      `script-src ${webview?.cspSource} ${DEV_SERVER_HOST} 'nonce-${nonce}';`,
                      `style-src ${webview?.cspSource} ${DEV_SERVER_HOST} vscode-resource: 'unsafe-inline';`,
                      `img-src ${webview?.cspSource} ${DEV_SERVER_HOST} data: vscode-resource:;`,
                      `connect-src ${webview?.cspSource} ${DEV_SERVER_HOST} ws:;`,
                      `font-src ${webview?.cspSource} ${DEV_SERVER_HOST};`,
                      `worker-src ${webview?.cspSource} ${DEV_SERVER_HOST} blob:;`,
                  ]
        ).join(' ');

        /**
         * Note to code maintainers:
         * encodeURIComponent(JSON.stringify(this.configuration)) below is crucial
         * We want to avoid the webview from crashing when the configuration object contains 'unsupported' bytes
         */

        return `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta // noinspection JSAnnotator
                        http-equiv="Content-Security-Policy" content="${csp}" />
                </head>
                    <body>
                        <div id="root"></div>
                            <script nonce="${nonce}">
                                globalThis.l10n_bundle = ${JSON.stringify(vscode.l10n.bundle ?? {})};
                            </script>
                            <script type="module" nonce="${nonce}">
                                window.config = {
                                    ...window.config,
                                    __initialData: '${encodeURIComponent(JSON.stringify(this.configuration))}'
                                };

                                import { render } from "${srcUri}";
                                render('${this._webviewName}', acquireVsCodeApi());
                            </script>

                    </body>
                </html>`;
    }

    //protected abstract _getWebview(): vscode.Webview;

    protected setupTheming() {
        /**
         * since it's still a work in progress, we'll leave it commented out for now.
         * It's here where we'd put Dmitrii's work on theming (?)
         */
        // this._disposables.push(
        //     vscode.window.onDidChangeActiveColorTheme((theme) => {
        //         this.postNotification(
        //             DefaultWebviewNotifications.onDidChangeTheme,
        //             theme.kind,
        //         );
        //     }),
        // );
        // this.postNotification(
        //     DefaultWebviewNotifications.onDidChangeTheme,
        //     vscode.window.activeColorTheme.kind,
        // );
    }

    private _registerDefaultRequestHandlers() {
        /**
         * since it's still a work in progress, we'll leave it commented out for now
         * as future reference (TELEMETRY)
         */
        // this._webviewRequestHandlers['getState'] = () => {
        //     return this.configuration;
        // };
        //
        // this._webviewRequestHandlers['action'] = async (action) => {
        //     const typedAction = action as { type: keyof Reducers; payload: Reducers[keyof Reducers] };
        //     const reducer = this._reducers[typedAction.type];
        //     if (reducer) {
        //         this.configuration = await reducer(this.configuration, typedAction.payload);
        //     } else {
        //         throw new Error(`No reducer registered for action ${typedAction.type.toString()}`);
        //     }
        // };
        //
        // this._webviewRequestHandlers['getTheme'] = () => {
        //     return vscode.window.activeColorTheme.kind;
        // };
        // this._webviewRequestHandlers['loadStats'] = (message) => {
        //     const timeStamp = message.loadCompleteTimeStamp;
        //     const timeToLoad = timeStamp - this._loadStartTime;
        //     if (this._isFirstLoad) {
        //         console.log(`Load stats for ${this._webviewName}` + '\n' + `Total time: ${timeToLoad} ms`);
        //         // sendActionEvent( --> TELEMETRY
        //         //     TelemetryViews.WebviewController,
        //         //     TelemetryActions.Load,
        //         //     {
        //         //         type: this._webviewName,
        //         //     },
        //         //     {
        //         //         durationMs: timeToLoad,
        //         //     },
        //         // );
        //         this._isFirstLoad = false;
        //     }
        // };
        // this._webviewRequestHandlers["sendActionEvent"] = (
        //     message: WebviewTelemetryActionEvent,
        // ) => {
        //     sendActionEvent(
        //         message.telemetryView,
        //         message.telemetryAction,
        //         message.additionalProps,
        //         message.additionalMeasurements,
        //     );
        // };
        //
        // this._webviewRequestHandlers["sendErrorEvent"] = (
        //     message: WebviewTelemetryErrorEvent,
        // ) => {
        //     sendErrorEvent(
        //         message.telemetryView,
        //         message.telemetryAction,
        //         message.error,
        //         message.includeErrorMessage,
        //         message.errorCode,
        //         message.errorType,
        //         message.additionalProps,
        //         message.additionalMeasurements,
        //     );
        // };
        // this._webviewRequestHandlers['getLocalization'] = async () => {
        //     if (vscode.l10n.uri?.fsPath) {
        //         const file = await vscode.workspace.fs.readFile(vscode.l10n.uri);
        //         const fileContents = Buffer.from(file).toString();
        //         return fileContents;
        //     } else {
        //         return undefined;
        //     }
        // };
    }

    /**
     * Gets whether the controller has been disposed
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Disposes the controller
     */
    public dispose() {
        this._onDisposed.fire();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        this._disposables.forEach((d) => d.dispose());
        this._isDisposed = true;
    }
}
