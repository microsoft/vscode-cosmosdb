/**
 * entry-point for vCore-related code. Activated from ./src/extension.ts
 *
 * We'll try to have everything related to vCore-support managed from here.
 * In case of a failure with this plan, this comment section will be updated.
 */
import { callWithTelemetryAndErrorHandling, registerCommand, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { getThemeAgnosticIconUri } from '../constants';
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
            registerCommand('mongocluster.internal.containerView.open', this.commandContainerViewOpen); //
        });
    }

    // commands

    commandSayHello(): void {
        console.log(`Hello there here!!!`);
        void vscode.window.showInformationMessage('Saying hello here!');
    }

    commandShowWebview(): void {
        ext.outputChannel.appendLine('vCore: webview');

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

        //panel.iconPath = getThemeAgnosticIconUri('CosmosDBAccount.svg');
        panel.webview.html = getWebviewContentReact();

        panel.webview.onDidReceiveMessage((message) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const queryString = (message?.queryConfig?.query as string) ?? '{}';
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const pageNumber = (message?.queryConfig?.pageNumber as number) ?? 1;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const pageSize = (message?.queryConfig?.pageSize as number) ?? 50;

            console.log(`Query: ${queryString}, page: ${pageNumber}, size: ${pageSize}`);

            void panel.webview.postMessage({
                message: 'Hello from the extension!',
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

        panel.iconPath = getThemeAgnosticIconUri('CosmosDBAccount.svg');
        panel.webview.html = getWebviewContentReact(_props.id, _props.liveConnectionId);

        panel.webview.onDidReceiveMessage(async (message) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const queryString = (message?.queryConfig?.query as string) ?? '{}';
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const pageNumber = (message?.queryConfig?.pageNumber as number) ?? 1;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const pageSize = (message?.queryConfig?.pageSize as number) ?? 10;

            console.log(`Query: ${queryString}, page: ${pageNumber}, size: ${pageSize}`);

            // run query
            const vClient: VCoreClient = await VCoreClient.getClient(_props.liveConnectionId);
            const responsePack = await vClient.queryDocuments(_props.databaseName, _props.collectionName, queryString, pageNumber * pageSize - pageSize, pageSize);

            void panel.webview.postMessage({
                message: 'Hello from the extension!',
                json: responsePack?.json ?? 'No data',
                table: responsePack?.table ?? [],
                tableColumns: responsePack?.tableColumns ?? [],
                tree: responsePack?.tree ?? []
            });
        });
    }

    async dispose(): Promise<void> {
        return;
    }
}

// ...args is just a temp solution for a MVP
const getWebviewContentReact = (
    id?: string,
    liveConnectionId?: string,
    databassName?: string,
    collectionName?: string,
) => {
    const jsFile = 'views.js';
    const localServerUrl = 'http://localhost:18080'; //webpack

    const scriptUrl = `${localServerUrl}/${jsFile}`;

    // const isProduction = context.extensionMode === ExtensionMode.Production;
    // if (isProduction) {
    //     scriptUrl = webView.asWebviewUri(vscode.Uri.file(join(context.extensionPath, 'dist', jsFile))).toString();
    //     cssUrl = webView.asWebviewUri(vscode.Uri.file(join(context.extensionPath, 'dist', cssFile))).toString();
    // } else {
    //     scriptUrl = `${localServerUrl}/${jsFile}`;
    // }

    return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
	</head>
	<body>
		<div id="root"></div>


            <script type="module">

            window.config = {
                ...window.config,
                __id: '${id}',
                __liveConnectionId: '${liveConnectionId}',
                __databaseName: '${databassName}',
                __collectionName: '${collectionName}',
                __vsCodeApi: acquireVsCodeApi(),
            };

            import { render } from "${scriptUrl}";
            render('vCoreCollectionView', window.config.__vsCodeApi, "/static");
            </script>


	</body>
	</html>`;
};
