/* eslint-disable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call */
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';

const DEV_SERVER_HOST = 'http://localhost:18080';

/**
 * ReactWebviewBaseController is a class that manages a vscode.Webview and provides
 * a way to communicate with it. It provides a way to register request handlers and reducers
 * that can be called from the webview. It also provides a way to post notifications to the webview.
 * @template SharedState The type of the state object that the webview and extension will share
 * @template Reducers The type of the reducers that the webview will use
 */
export abstract class ReactWebviewBaseController<SharedState, Reducers> implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _isDisposed: boolean = false;
    private _state: SharedState;
    private _webviewRequestHandlers: { [key: string]: (params: unknown) => unknown } = {};
    private _reducers: Record<
        keyof Reducers,
        (state: SharedState, payload: Reducers[keyof Reducers]) => ReducerResponse<SharedState>
    > = {} as Record<
        keyof Reducers,
        (state: SharedState, payload: Reducers[keyof Reducers]) => ReducerResponse<SharedState>
    >;

    // private _isFirstLoad: boolean = true;
    // private _loadStartTime: number = Date.now();
    private _onDisposed: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

    public readonly onDisposed: vscode.Event<void> = this._onDisposed.event;

    // TODO: TN fix typing

    protected _webviewMessageHandler = async (message) => {
        if (message.type === 'request') {
            const handler = this._webviewRequestHandlers[message.method];
            if (handler) {
                //const _startTime = Date.now();
                const result = await handler(message.params);
                this.postMessage({ type: 'response', id: message.id, result });
                //const _endTime = Date.now();
                // sendActionEvent( --> TELEMETRY
                //     TelemetryViews.WebviewController,
                //     TelemetryActions.WebviewRequest,
                //     {
                //         type: this._webviewName,
                //         method: message.method,
                //         reducer:
                //             message.method === "action"
                //                 ? message.params.type
                //                 : undefined,
                //     },
                //     {
                //         durationMs: endTime - startTime,
                //     },
                // );
            } else {
                throw new Error(`No handler registered for method ${message.method}`);
            }
        }
    };

    /**
     * Creates a new ReactWebviewPanelController
     * @param _context The context of the extension
     * @param _webviewName The source file that the webview will use
     * @param _initialData The initial state object that the webview will use
     */
    constructor(
        protected _context: vscode.ExtensionContext,
        private _webviewName: string,
        _initialData: SharedState,
    ) {
        this.state = _initialData;
    }

    protected initializeBase() {
        this._registerDefaultRequestHandlers();
        this.setupTheming();
    }

    protected registerDisposable(disposable: vscode.Disposable) {
        this._disposables.push(disposable);
    }

    protected getDocumentTemplate(
        webview?: vscode.Webview,
        id?: string,
        liveConnectionId?: string,
        databaseName?: string,
        collectionName?: string,
        documentId?: string,
        documentContent?: string,
        mode?: string,
    ) {
        const devServer = !!process.env.DEVSERVER;
        const isProduction = ext.context.extensionMode === vscode.ExtensionMode.Production;
        const nonce = randomBytes(16).toString('base64');

        const dir = ext.isBundle ? '' : 'out/src/webviews';
        const filename = ext.isBundle ? 'views.js' : 'index.js';
        const uri = (...parts: string[]) =>
            webview?.asWebviewUri(vscode.Uri.file(path.join(ext.context.extensionPath, dir, ...parts))).toString(true);

        const publicPath = isProduction || !devServer ? uri() : `${DEV_SERVER_HOST}/`;
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
                      `default-src ${DEV_SERVER_HOST};`,
                      `script-src ${DEV_SERVER_HOST} 'nonce-${nonce}';`,
                      `style-src ${DEV_SERVER_HOST} vscode-resource: 'unsafe-inline';`,
                      `img-src ${DEV_SERVER_HOST} data: vscode-resource:;`,
                      `connect-src ${DEV_SERVER_HOST} ws:;`,
                      `font-src ${DEV_SERVER_HOST};`,
                      `worker-src ${DEV_SERVER_HOST} blob:;`,
                  ]
        ).join(' ');

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

            <script type="module" nonce="${nonce}">
                window.config = {
                    ...window.config,
                    __id: '${id}',
                    __liveConnectionId: '${liveConnectionId}',
                    __databaseName: '${databaseName}',
                    __collectionName: '${collectionName}',
                    __documentId: '${documentId}',
                    __documentContent: '${documentContent}',
                    __mode: '${mode}'
            };

                import { render } from "${srcUri}";
                render('${this._webviewName}', acquireVsCodeApi(), "${publicPath}");
            </script>

	</body>
	</html>`;
    }

    protected _remove_getHtmlTemplate() {
        const nonce = randomBytes(16).toString('base64'); // getNonce();
        const baseUrl =
            this._getWebview()
                .asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'out', 'src', 'reactviews', 'assets'))
                .toString() + '/';

        return `
		<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>mssqlwebview</title>
					<base href="${baseUrl}"> <!-- Required for loading relative resources in the webview -->
				<style>
					html, body {
						margin: 0;
						padding: 0px;
  						width: 100%;
  						height: 100%;
					}
				</style>
				</head>
				<body>
					<link rel="stylesheet" href="${this._webviewName}.css">
					<div id="root"></div>
				  	<script type="module" nonce="${nonce}" src="${this._webviewName}.js"></script> <!-- since our bundles are in esm format we need to use type="module" -->
				</body>
			</html>
		`;
    }

    protected abstract _getWebview(): vscode.Webview;

    protected setupTheming() {
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
        this._webviewRequestHandlers['getState'] = () => {
            return this.state;
        };

        this._webviewRequestHandlers['action'] = async (action) => {
            const typedAction = action as { type: keyof Reducers; payload: Reducers[keyof Reducers] };
            const reducer = this._reducers[typedAction.type];
            if (reducer) {
                this.state = await reducer(this.state, typedAction.payload);
            } else {
                throw new Error(`No reducer registered for action ${typedAction.type.toString()}`);
            }
        };

        this._webviewRequestHandlers['getTheme'] = () => {
            return vscode.window.activeColorTheme.kind;
        };

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

        this._webviewRequestHandlers['getLocalization'] = async () => {
            if (vscode.l10n.uri?.fsPath) {
                const file = await vscode.workspace.fs.readFile(vscode.l10n.uri);
                const fileContents = Buffer.from(file).toString();
                return fileContents;
            } else {
                return undefined;
            }
        };
    }

    /**
     * Register a request handler that the webview can call and get a response from.
     * @param method The method name that the webview will use to call the handler
     * @param handler The handler that will be called when the method is called
     */
    public registerRequestHandler(method: string, handler: (params: unknown) => unknown) {
        this._webviewRequestHandlers[method] = handler;
    }

    /**
     * Reducers are methods that can be called from the webview to modify the state of the webview.
     * This method registers a reducer that can be called from the webview.
     * @param method The method name that the webview will use to call the reducer
     * @param reducer The reducer that will be called when the method is called
     * @template Method The key of the reducer that is being registered
     */
    public registerReducer<Method extends keyof Reducers>(
        method: Method,
        reducer: (state: SharedState, payload: Reducers[Method]) => ReducerResponse<SharedState>,
    ) {
        this._reducers[method] = reducer;
    }

    /**
     * Gets the state object that the webview is using
     */
    public get state(): SharedState {
        return this._state;
    }

    /**
     * Sets the state object that the webview is using. This will update the state in the webview
     * and may cause the webview to re-render.
     * @param value The new state object
     */
    public set state(value: SharedState) {
        this._state = value;
        this.postNotification(DefaultWebviewNotifications.updateState, value);
    }

    /**
     * Gets whether the controller has been disposed
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Posts a notification to the webview
     * @param method The method name that the webview will use to handle the notification
     * @param params The parameters that will be passed to the method
     */
    public postNotification(method: string, params: unknown) {
        this.postMessage({ type: 'notification', method, params });
    }

    /**
     * Posts a message to the webview
     * @param message The message to post to the webview
     */
    public postMessage(message: unknown) {
        if (!this._isDisposed) {
            this._getWebview().postMessage(message);
        }
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

export enum DefaultWebviewNotifications {
    updateState = 'updateState',
    onDidChangeTheme = 'onDidChangeTheme',
}

export type ReducerResponse<T> = T | Promise<T>;
