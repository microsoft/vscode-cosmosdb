import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { getNoSqlQueryConnection } from '../docdb/commands/connectNoSqlContainer';
import { type NoSqlQueryConnection } from '../docdb/NoSqlCodeLensProvider';
import { CosmosDBSession } from '../docdb/session/CosmosDBSession';
import { type ResultViewMetadata } from '../docdb/types/queryResult';
import { ext } from '../extensionVariables';
import * as vscodeUtil from '../utils/vscodeUtils';
import { type Channel } from './Communication/Channel/Channel';
import { VSCodeChannel } from './Communication/Channel/VSCodeChannel';

const DEV_SERVER_HOST = 'http://localhost:18080';

type CommandPayload = {
    commandName: string;
    params: unknown[];
};

export class QueryEditorTab {
    public static readonly title = 'Query Editor';
    public static readonly viewType = 'cosmosDbQuery';
    public static readonly openTabs: Set<QueryEditorTab> = new Set<QueryEditorTab>();

    public readonly channel: Channel;
    public readonly panel: vscode.WebviewPanel;
    public readonly sessions = new Map<string, CosmosDBSession>();

    private connection: NoSqlQueryConnection | undefined;
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, connection?: NoSqlQueryConnection) {
        QueryEditorTab.openTabs.add(this);

        this.channel = new VSCodeChannel(panel.webview);
        this.panel = panel;
        this.connection = connection;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.html = this.getWebviewContent();

        this.initController();
    }

    public static render(connection?: NoSqlQueryConnection, viewColumn?: vscode.ViewColumn): QueryEditorTab {
        const column = viewColumn ?? vscode.ViewColumn.One;
        if (connection) {
            const openTab = [...QueryEditorTab.openTabs].find(
                (openTab) =>
                    openTab.connection?.endpoint === connection.endpoint &&
                    openTab.connection?.databaseId === connection.databaseId &&
                    openTab.connection?.containerId === connection.containerId,
            );
            if (openTab) {
                openTab.panel.reveal(column);
                return openTab;
            }
        }

        const panel = vscode.window.createWebviewPanel(QueryEditorTab.viewType, QueryEditorTab.title, column, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });

        return new QueryEditorTab(panel, connection);
    }

    public dispose(): void {
        QueryEditorTab.openTabs.delete(this);

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
        const devServer = !!process.env.DEVSERVER;
        const isProduction = ext.context.extensionMode === vscode.ExtensionMode.Production;
        const nonce = randomBytes(16).toString('base64');

        const dir = ext.isBundle ? '' : 'out/src/webviews';
        const filename = ext.isBundle ? 'views.js' : 'index.js';
        const uri = (...parts: string[]) =>
            this.panel.webview
                .asWebviewUri(vscode.Uri.file(path.join(ctx.extensionPath, dir, ...parts)))
                .toString(true);

        const publicPath = isProduction || !devServer ? uri() : `${DEV_SERVER_HOST}/`;
        const srcUri = isProduction || !devServer ? uri(filename) : `${DEV_SERVER_HOST}/${filename}`;

        const csp = (
            isProduction
                ? [
                      `form-action 'none';`,
                      `default-src ${cspSource};`,
                      `script-src ${cspSource} 'nonce-${nonce}';`,
                      `style-src ${cspSource} ${DEV_SERVER_HOST} 'unsafe-inline';`,
                      `font-src ${cspSource} ${DEV_SERVER_HOST};`,
                      `worker-src ${cspSource} ${DEV_SERVER_HOST} blob:;`,
                      `img-src ${cspSource} ${DEV_SERVER_HOST} data:;`,
                  ]
                : [
                      `form-action 'none';`,
                      `default-src ${cspSource} ${DEV_SERVER_HOST};`,
                      `style-src ${cspSource} ${DEV_SERVER_HOST} 'unsafe-inline';`,
                      `script-src ${cspSource} ${DEV_SERVER_HOST} 'nonce-${nonce}';`,
                      `connect-src ${cspSource} ${DEV_SERVER_HOST} ws:;`,
                      `font-src ${cspSource} ${DEV_SERVER_HOST};`,
                      `worker-src ${cspSource} ${DEV_SERVER_HOST} blob:;`,
                      `img-src ${cspSource} ${DEV_SERVER_HOST} data:;`,
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
            await this.updateConnection(this.connection);
        });
    }

    private getCommand(payload: CommandPayload): Promise<void> {
        const commandName = payload.commandName;
        switch (commandName) {
            case 'openFile':
                return this.openFile();
            case 'saveFile':
                return this.saveFile(
                    payload.params[0] as string,
                    payload.params[1] as string,
                    payload.params[2] as string,
                );
            case 'copyToClipboard':
                return this.copyToClipboard(payload.params[0] as string);
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
            case 'nextPage':
                return this.nextPage(payload.params[0] as string);
            case 'prevPage':
                return this.prevPage(payload.params[0] as string);
            case 'firstPage':
                return this.firstPage(payload.params[0] as string);
            default:
                throw new Error(`Unknown command: ${commandName}`);
        }
    }

    private async updateConnection(connection?: NoSqlQueryConnection): Promise<void> {
        this.connection = connection;

        if (this.connection) {
            const { databaseId, containerId } = this.connection;

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

    private async openFile(): Promise<void> {
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

        await vscode.window.showOpenDialog(options).then((fileUri) => {
            if (fileUri && fileUri[0]) {
                return vscode.workspace.openTextDocument(fileUri[0]).then((document) => {
                    void this.channel.postMessage({ type: 'event', name: 'fileOpened', params: [document.getText()] });
                });
            } else {
                return undefined;
            }
        });
    }

    private async saveFile(text: string, filename: string, ext: string): Promise<void> {
        if (!ext.startsWith('.')) {
            ext = `.${ext}`;
        }
        await vscodeUtil.showNewFile(text, filename, ext);
    }

    private async copyToClipboard(text: string): Promise<void> {
        await vscode.env.clipboard.writeText(text);
    }

    private async showInformationMessage(message: string) {
        await vscode.window.showInformationMessage(message);
    }

    private async showErrorMessage(message: string) {
        await vscode.window.showErrorMessage(message);
    }

    private async connectToDatabase(): Promise<void> {
        await getNoSqlQueryConnection().then(async (connection) => {
            if (connection) {
                await this.updateConnection(connection);
            }
        });
    }

    private async disconnectFromDatabase(): Promise<void> {
        return this.updateConnection(undefined);
    }

    private async runQuery(query: string, options: ResultViewMetadata): Promise<void> {
        if (!this.connection) {
            throw new Error('No connection');
        }

        const session = new CosmosDBSession(this.connection, this.channel, query, options);

        this.sessions.set(session.id, session);

        await session.run();
    }

    private async stopQuery(executionId: string): Promise<void> {
        const session = this.sessions.get(executionId);
        if (!session) {
            throw new Error(`No session found for executionId: ${executionId}`);
        }

        await session.stop();
        this.sessions.delete(executionId);
    }

    private async nextPage(executionId: string): Promise<void> {
        if (!this.connection) {
            throw new Error('No connection');
        }

        const session = this.sessions.get(executionId);
        if (!session) {
            throw new Error(`No session found for executionId: ${executionId}`);
        }

        await session.nextPage();
    }

    private async prevPage(executionId: string): Promise<void> {
        if (!this.connection) {
            throw new Error('No connection');
        }

        const session = this.sessions.get(executionId);
        if (!session) {
            throw new Error(`No session found for executionId: ${executionId}`);
        }

        await session.prevPage();
    }

    private async firstPage(executionId: string): Promise<void> {
        if (!this.connection) {
            throw new Error('No connection');
        }

        const session = this.sessions.get(executionId);
        if (!session) {
            throw new Error(`No session found for executionId: ${executionId}`);
        }

        await session.firstPage();
    }
}
