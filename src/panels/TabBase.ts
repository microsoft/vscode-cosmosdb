/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../docdb/NoSqlCodeLensProvider';
import { type CosmosDBSession } from '../docdb/session/CosmosDBSession';
import { ext } from '../extensionVariables';
import { TelemetryContext } from '../Telemetry';
import { type Channel } from './Communication/Channel/Channel';
import { VSCodeChannel } from './Communication/Channel/VSCodeChannel';

const DEV_SERVER_HOST = 'http://localhost:18080';

export type CommandPayload = {
    commandName: string;
    params: unknown[];
};

type ViewType = 'cosmosDbQuery';

export abstract class TabBase {
    protected readonly title: string;
    protected readonly viewType: ViewType;
    private static readonly openTabs: Map<ViewType, Set<TabBase>> = new Map();

    protected readonly channel: Channel;
    private readonly panel: vscode.WebviewPanel;
    protected readonly sessions = new Map<string, CosmosDBSession>();

    private readonly id: string;
    private readonly start: number;
    protected readonly telemetryContext: TelemetryContext;

    protected connection: NoSqlQueryConnection | undefined;
    private disposables: vscode.Disposable[] = [];

    public constructor(
        viewType: ViewType,
        title: string,
        panel: vscode.WebviewPanel,
        connection?: NoSqlQueryConnection,
    ) {
        if (!TabBase.openTabs.has(viewType)) {
            TabBase.openTabs.set(viewType, new Set());
        }
        TabBase.openTabs.get(viewType)!.add(this);
        this.viewType = viewType;
        this.title = title;

        this.id = uuid();
        this.start = Date.now();
        this.telemetryContext = new TelemetryContext(connection);

        this.channel = new VSCodeChannel(panel.webview);
        this.panel = panel;
        this.connection = connection;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.html = this.getWebviewContent();

        this.initController();

        void this.telemetryContext.reportWebviewEvent('webviewOpened', {
            panelId: this.id,
            hasConnection: connection ? 'true' : 'false',
        });
    }

    public static render<T extends TabBase>(
        tabData: {
            c: new (
                viewType: ViewType,
                title: string,
                panel: vscode.WebviewPanel,
                connection?: NoSqlQueryConnection,
            ) => T; // constructor
            viewType: ViewType;
            title: string;
        },
        connection?: NoSqlQueryConnection,
        viewColumn?: vscode.ViewColumn,
    ): TabBase {
        const column = viewColumn ?? vscode.ViewColumn.One;
        if (connection && TabBase.openTabs.has(tabData.viewType)) {
            const openTab = [...TabBase.openTabs.get(tabData.viewType)!].find(
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

        const panel = vscode.window.createWebviewPanel(tabData.viewType, tabData.title, column, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });

        return new tabData.c(tabData.viewType, tabData.title, panel, connection);
    }

    public dispose(): void {
        TabBase.openTabs.get(this.viewType)?.delete(this);

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

        void this.telemetryContext.reportWebviewEvent(
            'webviewClosed',
            {
                panelId: this.id,
            },
            { openedTime: (Date.now() - this.start) / 1000 },
        );
    }

    private getWebviewContent(): string {
        const ctx = ext.context;
        const cspSource = this.panel.webview.cspSource;
        const devServer = !!process.env.DEVSERVER;
        const isProduction = ext.context.extensionMode === vscode.ExtensionMode.Production;
        const nonce = crypto.randomBytes(16).toString('base64');

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
            title: this.title,
            csp,
            srcUri,
            publicPath,
            viewType: this.viewType,
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

            await this.processCommand(payload);
        });

        this.channel.on<void>('ready', async () => {
            await this.updateConnection(this.connection);
        });
    }

    protected abstract processCommand(payload: CommandPayload): Promise<void>;

    protected async updateConnection(connection?: NoSqlQueryConnection): Promise<void> {
        this.connection = connection;

        if (this.connection) {
            const { databaseId, containerId, endpoint, masterKey } = this.connection;

            this.telemetryContext.addMaskedValue([databaseId, containerId, endpoint, masterKey ?? '']);

            await this.channel.postMessage({
                type: 'event',
                name: 'databaseConnected',
                params: [databaseId, containerId],
            });
        } else {
            // We will not remove the connection details from the telemetry context
            // to prevent accidental logging of sensitive information
            await this.channel.postMessage({
                type: 'event',
                name: 'databaseDisconnected',
                params: [],
            });
        }
    }
}
