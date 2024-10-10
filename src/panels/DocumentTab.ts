/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import crypto from 'crypto';
import path from 'path';
import { v4 as uuid } from 'uuid';
import vscode from 'vscode';
import { type NoSqlQueryConnection } from '../docdb/NoSqlCodeLensProvider';
import { DocumentSession } from '../docdb/session/DocumentSession';
import { type CosmosDbRecordIdentifier } from '../docdb/types/queryResult';
import { ext } from '../extensionVariables';
import { TelemetryContext } from '../Telemetry';
import { type Channel } from './Communication/Channel/Channel';
import { VSCodeChannel } from './Communication/Channel/VSCodeChannel';

const DEV_SERVER_HOST = 'http://localhost:18080';

type DocumentTabMode = 'add' | 'edit' | 'view';
type CommandPayload = {
    commandName: string;
    params: unknown[];
};

export class DocumentTab {
    public static readonly title = '';
    public static readonly viewType = 'cosmosDbDocument';
    public static readonly openTabs: Set<DocumentTab> = new Set<DocumentTab>();

    public readonly channel: Channel;
    public readonly panel: vscode.WebviewPanel;
    public readonly session: DocumentSession;

    private readonly id: string;
    private readonly start: number;
    private readonly telemetryContext: TelemetryContext;

    private connection: NoSqlQueryConnection;
    private disposables: vscode.Disposable[] = [];
    private documentId: CosmosDbRecordIdentifier | undefined;
    private mode: DocumentTabMode = 'view';

    private constructor(
        panel: vscode.WebviewPanel,
        connection: NoSqlQueryConnection,
        mode: DocumentTabMode,
        documentId?: CosmosDbRecordIdentifier,
    ) {
        DocumentTab.openTabs.add(this);

        this.id = uuid();
        this.start = Date.now();
        this.telemetryContext = new TelemetryContext(connection);

        this.channel = new VSCodeChannel(panel.webview);
        this.panel = panel;
        this.connection = connection;
        this.documentId = documentId;
        this.mode = mode;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.html = this.getWebviewContent();

        this.initController();

        void this.telemetryContext.reportWebviewEvent('webviewOpened', {
            panelId: this.id,
            hasConnection: connection ? 'true' : 'false',
        });

        this.session = new DocumentSession(connection, this.channel);
    }

    public static render(
        connection: NoSqlQueryConnection,
        mode: DocumentTabMode,
        documentId?: CosmosDbRecordIdentifier,
        viewColumn?: vscode.ViewColumn,
    ): DocumentTab {
        const column = viewColumn ?? vscode.ViewColumn.One;
        if (documentId) {
            const openTab = [...DocumentTab.openTabs].find((openTab) => {
                if (!openTab.documentId) {
                    return false;
                }
                if (documentId._rid && openTab.documentId._rid && openTab.documentId._rid === documentId._rid) {
                    return true;
                }

                if (documentId.partitionKey !== undefined && openTab.documentId.partitionKey !== undefined) {
                    const openTabPK = Array.isArray(openTab.documentId.partitionKey)
                        ? openTab.documentId.partitionKey.join(',')
                        : openTab.documentId.partitionKey?.toString();
                    const pk = Array.isArray(documentId.partitionKey)
                        ? documentId.partitionKey.join(',')
                        : documentId.partitionKey?.toString();

                    return documentId.id === openTab.documentId.id && openTabPK === pk;
                }

                return documentId.id === openTab.documentId.id;
            });
            if (openTab) {
                openTab.panel.reveal(column);
                return openTab;
            }
        }

        const title = `${documentId?.id ? documentId.id : 'New Document'}.json`;
        const panel = vscode.window.createWebviewPanel(DocumentTab.viewType, title, column, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });

        return new DocumentTab(panel, connection, mode, documentId);
    }

    public dispose(): void {
        DocumentTab.openTabs.delete(this);

        this.channel.dispose();
        this.panel.dispose();
        this.session.dispose();

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
            title: this.panel.title,
            csp,
            srcUri,
            publicPath,
            viewType: DocumentTab.viewType,
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
            await this.getCommand(payload);
        });

        this.channel.on<void>('ready', async () => {
            await this.channel.postMessage({
                type: 'event',
                name: 'initState',
                params: [this.mode, this.connection.databaseId, this.connection.containerId, this.documentId],
            });
            if (this.documentId) {
                await this.session.read(this.documentId);
            }
        });
    }

    private getCommand(payload: CommandPayload): Promise<void> {
        const commandName = payload.commandName;
        switch (commandName) {
            case 'refreshDocument':
                return this.refreshDocument();
            case 'showInformationMessage':
                return this.showInformationMessage(payload.params[0] as string);
            case 'showErrorMessage':
                return this.showErrorMessage(payload.params[0] as string);
            case 'reportWebviewEvent':
                return this.telemetryContext.reportWebviewEvent(
                    payload.params[0] as string,
                    payload.params[1] as Record<string, string>,
                    payload.params[2] as Record<string, number>,
                );
            case 'reportWebviewError':
                return this.telemetryContext.reportWebviewError(
                    payload.params[0] as string, // message
                    payload.params[1] as string, // stack
                    payload.params[2] as string, // componentStack
                );
            case 'executeReportIssueCommand':
                // Use an async anonymous function to convert Thenable to Promise
                return (async () => await vscode.commands.executeCommand('azureDatabases.reportIssue'))();
            default:
                throw new Error(`Unknown command: ${commandName}`);
        }
    }

    private async showInformationMessage(message: string) {
        await vscode.window.showInformationMessage(message);
    }

    private async showErrorMessage(message: string) {
        await vscode.window.showErrorMessage(message);
    }

    private async refreshDocument(): Promise<void> {
        if (this.documentId) {
            await this.session.read(this.documentId);
        }
    }
}
