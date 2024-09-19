/**
 * entry-point for mongoClusters-related code. Activated from ./src/extension.ts
 *
 * We'll try to have everything related to mongoClusters-support managed from here.
 * In case of a failure with this plan, this comment section will be updated.
 */
import { callWithTelemetryAndErrorHandling, registerCommand, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { MongoClustersClient } from './MongoClustersClient';
import { MongoClustersBranchDataProvider } from './tree/MongoClustersBranchDataProvider';

export class MongoClustersExtension implements vscode.Disposable {
    async activate(): Promise<void> {
        await callWithTelemetryAndErrorHandling('mongoClusters.activate', async (activateContext: IActionContext) => {
            activateContext.telemetry.properties.isActivationEvent = 'true';

            ext.mongoClustersBranchDataProvider = new MongoClustersBranchDataProvider();
            ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
                AzExtResourceType.MongoClusters,
                ext.mongoClustersBranchDataProvider,
            );

            // using registerCommand instead of vscode.commands.registerCommand for better telemetry:
            // https://github.com/microsoft/vscode-azuretools/tree/main/utils#telemetry-and-error-handling
            registerCommand('mongoClusters.cmd.hello', this.commandSayHello);
            registerCommand('mongoClusters.cmd.webview', this.commandShowWebview);
            registerCommand('mongoClusters.cmd.jsonview', this.commandShowDocumentView_View);
            registerCommand('mongoClusters.internal.containerView.open', this.commandContainerViewOpen);
            registerCommand('mongoClusters.internal.documentView.open.view', this.commandShowDocumentView_View);

            ext.outputChannel.appendLine(`mongoClusters: activated.`);
        });
    }

    // commands

    commandSayHello(): void {
        console.log(`Hello there here!!!`);
        void vscode.window.showInformationMessage('Saying hello here!');
    }

    commandShowWebview(): void {
        const panel = vscode.window.createWebviewPanel(
            'mongoClusters.view.docs', // Identifies the type of the webview. Used internally
            'prefix/mongoClusters Mock', // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            {
                enableScripts: true,
                enableCommandUris: true,
                retainContextWhenHidden: true,
            }, // Webview options. More on these later.
        );

        //panel.iconPath = getThemeAgnosticIconURI('CosmosDBAccount.svg');
        panel.webview.html = getCollectionWebviewContentReact(panel.webview);

        panel.webview.onDidReceiveMessage((message) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const queryString = (message?.payload?.queryText as string) ?? '{}';
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const pageNumber = (message?.payload?.pageNumber as number) ?? 1;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const pageSize = (message?.payload?.pageSize as number) ?? 10;

            console.log(`Query: ${queryString}, page: ${pageNumber}, size: ${pageSize}`);

            void panel.webview.postMessage({
                json: `You asked for: ${queryString}, page: ${pageNumber}, size: ${pageSize}`,
            });
        });
    }

    commandShowDocumentView_View(
        _context: IActionContext,
        _props: {
            id: string;
            liveConnectionId: string;
            viewTitle: string;
            databaseName: string;
            collectionName: string;
            documentId: string;
            documentContent: string;
        },
    ): void {
        const panel = vscode.window.createWebviewPanel(
            'mongoClusters.documentView.view', // Identifies the type of the webview. Used internally
            `${_props?.databaseName ?? 'unknown'}/${_props?.collectionName ?? 'unknown'}/${_props?.documentId ?? 'unknown'}`, // Title of the panel displayed to the user
            vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
            {
                enableScripts: true,
                enableCommandUris: true,
                retainContextWhenHidden: true,
            },
        );

        panel.webview.html = getDocumentViewContentReact(
            panel.webview,
            _props?.id ?? '',
            _props?.liveConnectionId ?? '',
            _props?.databaseName ?? '',
            _props?.collectionName ?? '',
            _props?.documentId ?? '',
            _props?.documentContent ?? '',
        );
    }

    commandContainerViewOpen(
        _context: IActionContext,
        _props: {
            id: string;
            liveConnectionId: string;
            viewTitle: string;
            databaseName: string;
            collectionName: string;
        },
    ): void {
        const panel = vscode.window.createWebviewPanel(
            'mongoClusters.view.docs', // Identifies the type of the webview. Used internally
            _props.viewTitle, // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            {
                enableScripts: true,
                enableCommandUris: true,
                retainContextWhenHidden: true,
            }, // Webview options. More on these later.
        );

        // panel.iconPath = getThemeAgnosticIconURI('CosmosDBAccount.svg');
        panel.webview.html = getCollectionWebviewContentReact(
            panel.webview,
            _props.id,
            _props.liveConnectionId,
            _props.databaseName,
            _props.collectionName,
        );
        panel.webview.onDidReceiveMessage(async (message) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const queryString = (message?.payload?.queryText as string) ?? '{}';
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const pageNumber = (message?.payload?.pageNumber as number) ?? 1;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const pageSize = (message?.payload?.pageSize as number) ?? 10;

            console.log(`Query: ${queryString}, page: ${pageNumber}, size: ${pageSize}`);

            // run query
            const client: MongoClustersClient = await MongoClustersClient.getClient(_props.liveConnectionId);
            const responsePack = await client.queryDocuments(
                _props.databaseName,
                _props.collectionName,
                queryString,
                pageNumber * pageSize - pageSize,
                pageSize,
            );

            void panel.webview.postMessage({
                type: 'queryResults',
                json: responsePack?.json ?? '{ "noData": true }',
                tableData: responsePack?.tableData ?? [],
                tableHeaders: responsePack?.tableHeaders ?? [],
                treeData: responsePack?.treeData ?? [],
            });
        });
    }

    async dispose(): Promise<void> {
        return;
    }
}

const DEV_SERVER_HOST = 'http://localhost:18080';

// ...args is just a temp solution for a MVP
const getCollectionWebviewContentReact = (
    webview?: vscode.Webview,
    id?: string,
    liveConnectionId?: string,
    databaseName?: string,
    collectionName?: string,
) => {
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
        <meta http-equiv="Content-Security-Policy" content="${csp}" />
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
                    __vsCodeApi: acquireVsCodeApi(),
                };

                import { render } from "${srcUri}";
                render('mongoClustersCollectionView', window.config.__vsCodeApi, "${publicPath}");
            </script>


	</body>
	</html>`;
};

// ...args is just a temp solution for a MVP
const getDocumentViewContentReact = (
    webview?: vscode.Webview,
    id?: string,
    liveConnectionId?: string,
    databaseName?: string,
    collectionName?: string,
    documentId?: string,
    documentContent?: string,
) => {
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
        <meta http-equiv="Content-Security-Policy" content="${csp}" />
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
                    __vsCodeApi: acquireVsCodeApi(),
                };

                import { render } from "${srcUri}";
                render('mongoClustersDocumentView', window.config.__vsCodeApi, "${publicPath}");
            </script>


	</body>
	</html>`;
};
