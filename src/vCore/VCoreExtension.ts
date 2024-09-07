/**
 * entry-point for vCore-related code. Activated from ./src/extension.ts
 *
 * We'll try to have everything related to vCore-support managed from here.
 * In case of a failure with this plan, this comment section will be updated.
 */
import { callWithTelemetryAndErrorHandling, registerCommand, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { MongoClustersBranchDataProvider } from '../vCore/tree/MongoClustersBranchDataProvider';
import { VCoreClient } from './VCoreClient';

export class VCoreExtension implements vscode.Disposable {
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
            registerCommand('vCore.cmd.hello', this.commandSayHello);
            registerCommand('vCore.cmd.webview', this.commandShowWebview);
            registerCommand('mongocluster.internal.containerView.open', this.commandContainerViewOpen);

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
            'vCore.view.docs', // Identifies the type of the webview. Used internally
            'prefix/vCore Mock', // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            {
                enableScripts: true,
                enableCommandUris: true,
                retainContextWhenHidden: true,
            }, // Webview options. More on these later.
        );

        //panel.iconPath = getThemeAgnosticIconURI('CosmosDBAccount.svg');
        panel.webview.html = getWebviewContentReact(panel.webview);

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
            'vCore.view.docs', // Identifies the type of the webview. Used internally
            _props.viewTitle, // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            {
                enableScripts: true,
                enableCommandUris: true,
                retainContextWhenHidden: true,
            }, // Webview options. More on these later.
        );

        // panel.iconPath = getThemeAgnosticIconURI('CosmosDBAccount.svg');
        panel.webview.html = getWebviewContentReact(
            panel.webview,
            _props.id,
            _props.liveConnectionId,
            _props.databaseName,
            _props.collectionName,
        );
5
        panel.webview.onDidReceiveMessage(async (message) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const queryString = (message?.payload?.queryText as string) ?? '{}';
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const pageNumber = (message?.payload?.pageNumber as number) ?? 1;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const pageSize = (message?.payload?.pageSize as number) ?? 10;

            console.log(`Query: ${queryString}, page: ${pageNumber}, size: ${pageSize}`);

            // run query
            const vClient: VCoreClient = await VCoreClient.getClient(_props.liveConnectionId);
            const responsePack = await vClient.queryDocuments(
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
const getWebviewContentReact = (
    webview?: vscode.Webview,
    id?: string,
    liveConnectionId?: string,
    databassName?: string,
    collectionName?: string,
) => {
    // const jsFile = 'views.js';
    // const localServerUrl = 'http://localhost:18080'; //webpack

    const isProduction = ext.context.extensionMode === vscode.ExtensionMode.Production;
    const nonce = randomBytes(16).toString('base64');

    // const scriptUrl = `${localServerUrl}/${jsFile}`;

    const uri = (...parts: string[]) =>
        webview?.asWebviewUri(vscode.Uri.file(path.join(ext.context.extensionPath, 'dist', ...parts))).toString(true);

    const publicPath = isProduction ? uri() : `${DEV_SERVER_HOST}/`;
    const srcUri = isProduction ? uri('views.js') : `${DEV_SERVER_HOST}/views.js`;

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
                    __databaseName: '${databassName}',
                    __collectionName: '${collectionName}',
                    __vsCodeApi: acquireVsCodeApi(),
                };

                import { render } from "${srcUri}";
                render('vCoreCollectionView', window.config.__vsCodeApi, "${publicPath}");
            </script>


	</body>
	</html>`;
};
