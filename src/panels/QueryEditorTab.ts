import { AbortError, ErrorResponse, TimeoutError, type CosmosClient, type QueryIterator } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import { connectNoSqlContainer, disconnectNoSqlContainer } from '../docdb/commands/connectNoSqlContainer';
import { getCosmosClient, type CosmosDBCredential } from '../docdb/getCosmosClient';
import { noSqlQueryConnectionKey, type NoSqlQueryConnection } from '../docdb/NoSqlCodeLensProvider';
import { ext } from '../extensionVariables';
import { KeyValueStore } from '../KeyValueStore';
import * as vscodeUtil from '../utils/vscodeUtils';
import { type Channel } from './Communication/Channel/Channel';
import { getErrorMessage } from './Communication/Channel/CommonChannel';
import { VSCodeChannel } from './Communication/Channel/VSCodeChannel';

const DEV_SERVER_HOST = 'http://localhost:18080';

type ResultViewMetadata = {
    populateQueryMetrics?: boolean;
    maxItemCount?: number;
};

class Session {
    public readonly id: string;
    private readonly channel: Channel;
    private readonly client: CosmosClient;
    private readonly databaseId: string;
    private readonly containerId: string;
    private readonly resultViewMetadata: ResultViewMetadata = {};
    private readonly query: string;

    private abortController: AbortController | null = null;
    private iterator: QueryIterator<unknown> | null = null;
    private isDisposed = false;

    constructor(
        connection: NoSqlQueryConnection,
        channel: Channel,
        query: string,
        resultViewMetadata: ResultViewMetadata,
    ) {
        const { databaseId, containerId, endpoint, masterKey, isEmulator } = connection;
        const credentials: CosmosDBCredential[] = [];
        if (masterKey !== undefined) {
            credentials.push({ type: 'key', key: masterKey });
        }
        credentials.push({ type: 'auth' });

        this.id = uuid();
        this.channel = channel;
        this.client = getCosmosClient(endpoint, credentials, isEmulator);
        this.databaseId = databaseId;
        this.containerId = containerId;
        this.resultViewMetadata = resultViewMetadata;
        this.query = query;
    }

    public async run(): Promise<void> {
        if (this.isDisposed || this.iterator) {
            return;
        }

        try {
            this.abortController = new AbortController();
            this.iterator = this.client
                .database(this.databaseId)
                .container(this.containerId)
                .items.query(this.query, {
                    abortSignal: this.abortController.signal,
                    populateQueryMetrics: this.resultViewMetadata?.populateQueryMetrics ?? false,
                    maxItemCount: this.resultViewMetadata?.maxItemCount ?? 100,
                    maxDegreeOfParallelism: 1000,
                    bufferItems: true,
                });

            const results = await this.iterator.fetchNext();
            await this.channel.postMessage({
                type: 'event',
                name: 'queryResults',
                params: [this.id, results],
            });
        } catch (error) {
            if (error instanceof ErrorResponse) {
                const code: string = `${error.code ?? 'Unknown'}`;
                const message: string = error.body?.message ?? `Query failed with status code ${code}`;
                await this.channel.postMessage({
                    type: 'event',
                    name: 'queryError',
                    params: [this.id, message],
                });
            } else if (error instanceof TimeoutError) {
                await this.channel.postMessage({
                    type: 'event',
                    name: 'queryError',
                    params: [this.id, 'Query timed out'],
                });
            } else if (error instanceof AbortError) {
                await this.channel.postMessage({
                    type: 'event',
                    name: 'queryError',
                    params: [this.id, 'Query was aborted'],
                });
            } else {
                await this.channel.postMessage({
                    type: 'event',
                    name: 'queryError',
                    params: [this.id, getErrorMessage(error)],
                });
            }
        }
    }

    public async stop(): Promise<void> {
        this.abortController?.abort();
    }

    public dispose(): void {
        this.isDisposed = true;
        this.abortController?.abort();
    }
}

type CommandPayload = {
    commandName: string;
    params: unknown[];
};

export class QueryEditorTab {
    public static currentPanel: QueryEditorTab | undefined;
    public static readonly title = 'Query Editor';
    public static readonly viewType = 'cosmosDbQuery';

    private readonly channel: Channel;
    private readonly panel: vscode.WebviewPanel;
    private readonly sessions = new Map<string, Session>();
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel) {
        this.channel = new VSCodeChannel(panel.webview);
        this.panel = panel;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.html = this.getWebviewContent();

        // TODO: Should be another EventEmitter
        ext.noSqlCodeLensProvider.onDidChangeCodeLenses(this.updateConnection, this, this.disposables);

        this.initController();
    }

    public static render(): void {
        if (QueryEditorTab.currentPanel) {
            QueryEditorTab.currentPanel.panel.reveal(vscode.ViewColumn.One);
        } else {
            const panel = vscode.window.createWebviewPanel(
                QueryEditorTab.viewType,
                QueryEditorTab.title,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true, // TODO use vscode getState, setState to save/restore react state
                },
            );

            QueryEditorTab.currentPanel = new QueryEditorTab(panel);
        }
    }

    public dispose(): void {
        QueryEditorTab.currentPanel = undefined;

        this.channel.dispose();
        this.panel.dispose();

        this.sessions.forEach((session) => session.dispose());
        this.sessions.clear();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private getWebviewContent(): string {
        const ctx = ext.context;
        const cspSource = this.panel.webview.cspSource;
        const isProduction = ext.context.extensionMode === vscode.ExtensionMode.Production;
        const nonce = randomBytes(16).toString('base64');

        const uri = (...parts: string[]) =>
            this.panel.webview
                .asWebviewUri(vscode.Uri.file(path.join(ctx.extensionPath, 'dist', ...parts)))
                .toString(true);

        const publicPath = isProduction ? uri() : `${DEV_SERVER_HOST}/`;
        const srcUri = isProduction ? uri('views.js') : `${DEV_SERVER_HOST}/views.js`;

        const csp = (
            isProduction
                ? [
                      `form-action 'none';`,
                      `default-src ${cspSource};`,
                      `script-src ${cspSource} 'nonce-${nonce}';`,
                      `style-src ${cspSource} ${DEV_SERVER_HOST} 'unsafe-inline';`,
                      `font-src ${cspSource} ${DEV_SERVER_HOST};`,
                      `worker-src ${cspSource} ${DEV_SERVER_HOST} blob:;`,
                  ]
                : [
                      `form-action 'none';`,
                      `default-src ${cspSource} ${DEV_SERVER_HOST};`,
                      `style-src ${cspSource} ${DEV_SERVER_HOST} 'unsafe-inline';`,
                      `script-src ${cspSource} ${DEV_SERVER_HOST} 'nonce-${nonce}';`,
                      `connect-src ${cspSource} ${DEV_SERVER_HOST} ws:;`,
                      `font-src ${cspSource} ${DEV_SERVER_HOST};`,
                      `worker-src ${cspSource} ${DEV_SERVER_HOST} blob:;`,
                  ]
        ).join(' ');

        return this.template({
            title: QueryEditorTab.title,
            csp,
            srcUri,
            publicPath,
            viewType: QueryEditorTab.viewType,
            nonce,
        });
    }

    private template(params: {
        csp: string;
        viewType: string;
        srcUri: string;
        publicPath: string;
        title: string;
        nonce: string;
    }) {
        return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${params.title}</title>
    <meta http-equiv="Content-Security-Policy" content="${params.csp}" />
  </head>

  <body>
    <div id="root"></div>
    <script type="module" nonce="${params.nonce}">
      import { render } from "${params.srcUri}";
      render("${params.viewType}", acquireVsCodeApi(), "${params.publicPath}");
    </script>
  </body>
</html>
`;
    }

    private initController() {
        this.channel.on<void>('command', async (payload: CommandPayload) => {
            // TODO: Telemetry
            console.log('command', payload);

            await this.getCommand(payload);
        });

        this.channel.on<void>('ready', async () => {
            await this.updateConnection();
        });
    }

    private getCommand(payload: CommandPayload): Promise<void> {
        const commandName = payload.commandName;
        switch (commandName) {
            case 'openFile':
                return this.openFile();
            case 'saveFile':
                return this.saveFile(payload.params[0] as string);
            case 'showInformationMessage':
                return this.showInformationMessage(payload.params[0] as string);
            case 'showErrorMessage':
                return this.showErrorMessage(payload.params[0] as string);
            case 'connectToDatabase':
                return this.connectToDatabase();
            case 'disconnectFromDatabase':
                return this.disconnectFromDatabase();
            case 'runQuery':
                return this.runQuery(payload.params[0] as string, payload.params[1] as ResultViewMetadata);
            case 'stopQuery':
                return this.stopQuery(payload.params[0] as string);
            default:
                throw new Error(`Unknown command: ${commandName}`);
        }
    }

    private async updateConnection(): Promise<void> {
        const connection = KeyValueStore.instance.get(noSqlQueryConnectionKey);
        if (connection) {
            const { databaseId, containerId } = connection as NoSqlQueryConnection;

            await this.channel.postMessage({
                type: 'event',
                name: 'databaseConnected',
                params: [databaseId, containerId],
            });
        } else {
            await this.channel.postMessage({
                type: 'event',
                name: 'databaseDisconnected',
                params: [],
            });
        }
    }

    private async openFile() {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Select',
            canSelectFiles: true,
            canSelectFolders: false,
            title: 'Select query',
            filters: {
                'Query files': ['sql', 'nosql'],
                'Text files': ['txt'],
            },
        };

        void vscode.window.showOpenDialog(options).then((fileUri) => {
            if (fileUri && fileUri[0]) {
                return vscode.workspace.openTextDocument(fileUri[0]).then((document) => {
                    void this.channel.postMessage({ type: 'event', name: 'fileOpened', params: [document.getText()] });
                });
            } else {
                return undefined;
            }
        });
    }

    private async saveFile(query: string): Promise<void> {
        await vscodeUtil.showNewFile(query, `New query`, '.nosql');
    }

    private async showInformationMessage(message: string) {
        await vscode.window.showInformationMessage(message);
    }

    private async showErrorMessage(message: string) {
        await vscode.window.showErrorMessage(message);
    }

    private async connectToDatabase(): Promise<void> {
        void callWithTelemetryAndErrorHandling<void>('cosmosDB.connectToDatabase', (context) =>
            connectNoSqlContainer(context),
        );
    }

    private async disconnectFromDatabase(): Promise<void> {
        return disconnectNoSqlContainer();
    }

    private async runQuery(query: string, options: ResultViewMetadata): Promise<void> {
        const session = new Session(
            KeyValueStore.instance.get(noSqlQueryConnectionKey) as NoSqlQueryConnection,
            this.channel,
            query,
            options,
        );

        this.sessions.set(session.id, session);

        void this.channel.postMessage({
            type: 'event',
            name: 'executionStarted',
            params: [session.id],
        });

        return session.run();
    }

    private async stopQuery(executionId: string): Promise<void> {
        const session = this.sessions.get(executionId);
        if (session) {
            await session.stop();
            this.sessions.delete(executionId);
        }

        void this.channel.postMessage({
            type: 'event',
            name: 'executionStopped',
            params: [executionId],
        });
    }
}
