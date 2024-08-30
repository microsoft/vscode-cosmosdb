import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { noSqlQueryConnectionKey, type NoSqlQueryConnection } from '../docdb/NoSqlCodeLensProvider';
import { ext } from '../extensionVariables';
import { KeyValueStore } from '../KeyValueStore';
import {
    ConnectToDatabaseCommand,
    DisconnectFromDatabaseCommand,
    OpenFileCommand,
    SaveFileCommand,
    ShowErrorMessageCommand,
    ShowInformationMessageCommand,
    type Command,
    type CommandResult,
} from './Commands';
import { type Channel } from './Communication/Channel/Channel';
import { VSCodeChannel } from './Communication/Channel/VSCodeChannel';

const DEV_SERVER_HOST = 'http://localhost:18080';

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
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel) {
        this.channel = new VSCodeChannel(panel.webview);
        this.panel = panel;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.html = this.getWebviewContent();

        // TODO: Should be another EventEmitter
        ext.noSqlCodeLensProvider.onDidChangeCodeLenses(this.updateConnection, this, this.disposables);

        this.initController();

        void this.updateConnection();
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
        this.channel.on<CommandResult<unknown>>('command', async (payload: CommandPayload) => {
            // TODO: Telemetry
            console.log('command', payload);

            const command = this.getCommand(payload);

            if (!command) {
                throw new Error(`Unknown command: ${payload.commandName}`);
            }

            try {
                const result = await command.execute(this.channel);
                return { isSuccess: true, value: result };
            } catch (error) {
                return { isSuccess: false, value: error instanceof Error ? error : new Error(String(error)) };
            }
        });
    }

    private getCommand(payload: CommandPayload): Command | undefined {
        const commandName = payload.commandName;
        switch (commandName) {
            case 'openFile':
                return new OpenFileCommand();
            case 'saveFile':
                return new SaveFileCommand(payload.params[0] as string);
            case 'showInformationMessage':
                return new ShowInformationMessageCommand(payload.params[0] as string);
            case 'showErrorMessage':
                return new ShowErrorMessageCommand(payload.params[0] as string);
            case 'connectToDatabase':
                return new ConnectToDatabaseCommand();
            case 'disconnectFromDatabase':
                return new DisconnectFromDatabaseCommand();
        }

        return undefined;
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
}
