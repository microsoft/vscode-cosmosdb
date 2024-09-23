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
import { isMongoClustersSupportenabled } from './utils/isMongoClustersSupportenabled';

export class MongoClustersExtension implements vscode.Disposable {
    async activate(): Promise<void> {
        await callWithTelemetryAndErrorHandling('mongoClusters.activate', async (activateContext: IActionContext) => {
            activateContext.telemetry.properties.isActivationEvent = 'true';

            const isMongoClustersEnabled: boolean = isMongoClustersSupportenabled() ?? false;

            activateContext.telemetry.properties.mongoClustersEnabled = isMongoClustersEnabled.toString();

            // allows to show/hide commands in the package.json file
            vscode.commands.executeCommand(
                'setContext',
                'vscodeDatabases.mongoClustersSupportEnabled',
                isMongoClustersEnabled,
            );

            if (!isMongoClustersEnabled) {
                return;
            }

            ext.mongoClustersBranchDataProvider = new MongoClustersBranchDataProvider();
            ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
                AzExtResourceType.MongoClusters,
                ext.mongoClustersBranchDataProvider,
            );

            if (isMongoClustersSupportenabled()) {
                vscode.commands.executeCommand('setContext', 'vscodeDatabases.mongoClustersSupportEnabled', true);

                // using registerCommand instead of vscode.commands.registerCommand for better telemetry:
                // https://github.com/microsoft/vscode-azuretools/tree/main/utils#telemetry-and-error-handling
                registerCommand('mongoClusters.cmd.hello', this.commandSayHello);
                registerCommand('mongoClusters.cmd.webview', this.commandShowWebview);
                registerCommand('mongoClusters.internal.containerView.open', this.commandContainerViewOpen);
            } else {
                vscode.commands.executeCommand('setContext', 'vscodeDatabases.mongoClustersSupportEnabled', false);
            }
            ext.outputChannel.appendLine(`mongoClusters: activated.`);
        });
    }

    // commands

    commandSayHello(): void {
        console.log(`Hello there here!!!`);
        void vscode.window.showInformationMessage('Saying hello here!');

        void vscode.window.showWarningMessage(
            `Are you sure?`,
            { modal: true, detail: "You are about to:\n\ndelete 5 documents.\n\nThis action can't be undone." },
            'Delete',
        );
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
            mode?: string;
        },
    ): void {
        const panel = vscode.window.createWebviewPanel(
            'mongoClusters.documentView.view', // Identifies the type of the webview. Used internally
            _props.viewTitle, // Title of the panel displayed to the user
            vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
            {
                enableScripts: true,
                enableCommandUris: true,
                retainContextWhenHidden: true,
            },
        );

        panel.webview.onDidReceiveMessage(async (message) => {

            function extractIdFromJson(jsonString: string): string | null {
                let extractedId: string | null = null;

                // Use JSON.parse with a reviver function
                JSON.parse(jsonString, (key, value) => {
                  if (key === "_id") {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    extractedId = value;  // Extract _id when found
                  }
                  // Return the value to keep parsing
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                  return value;
                });

                return extractedId;
              }

            console.log('Webview->Ext:', JSON.stringify(message, null, 2));

            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const messageType = message?.type as string;

            switch (messageType) {
                case 'request.documentView.refreshDocument': {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const documentId = (message?.payload?.documentId as string) ?? '';

                    // run query
                    const client: MongoClustersClient = await MongoClustersClient.getClient(_props.liveConnectionId);
                    const documentContent = await client.pointRead(
                        _props.databaseName,
                        _props.collectionName,
                        documentId,
                    );

                    const documentContetntAsString = JSON.stringify(documentContent, null, 4);

                    void panel.webview.postMessage({
                        type: 'response.documentView.refreshDocument',
                        payload: { documentContent: documentContetntAsString },
                    });

                    break;
                }
                case 'request.documentView.saveDocument': {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const documentContent = message?.payload?.documentContent as string;

                    const documentId = extractIdFromJson(documentContent) ?? '';

                    // run query
                    const client: MongoClustersClient = await MongoClustersClient.getClient(_props.liveConnectionId);

                    // when a document is saved and is missing an _id field, the _id field is added on the server
                    // or by the mongodb driver.
                    const upsertResult = await client.upsertDocument(
                        _props.databaseName,
                        _props.collectionName,
                        documentId,
                        documentContent,
                    );

                    const objectId = upsertResult?.updateResult.upsertedId?.toString() ?? documentId;

                    panel.title = `${_props.databaseName}/${_props.collectionName}/${objectId}`;

                    const newDocumentContetntAsString = JSON.stringify(upsertResult.documentContent, null, 4);

                    void panel.webview.postMessage({
                        type: 'response.documentView.saveDocument',
                        payload: { documentContent: newDocumentContetntAsString, documentId: objectId },
                    });

                    break;
                }
                default:
                    break;
            }
        });

        panel.webview.html = getDocumentViewContentReact(
            panel.webview,
            _props?.id ?? '',
            _props?.liveConnectionId ?? '',
            _props?.databaseName ?? '',
            _props?.collectionName ?? '',
            _props?.documentId ?? '',
            _props?.documentContent ?? '',
            _props?.mode ?? 'view',
        );

        panel.webview.onDidReceiveMessage(async (message) => {
            console.log('Webview->Ext:', JSON.stringify(message, null, 2));
        });
    }

    getRandomArrayAndIndex(length: number): { numbers: number[]; index: number } {
        // Generate an array of three random numbers between 0 and 100 (can adjust range)
        const randomNumbers: number[] = Array.from({ length: length }, () => Math.floor(Math.random() * 101));

        // Get a random index between 0 and 2
        const randomIndex: number = Math.floor(Math.random() * randomNumbers.length);

        // Return the object with fields "numbers" and "index"
        return { numbers: randomNumbers, index: randomIndex };
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
            function getRandomArrayAndIndex(length: number): { numbers: number[]; index: number } {
                // Generate an array of three random numbers between 0 and 100 (can adjust range)
                const randomNumbers: number[] = Array.from({ length: length }, () => Math.floor(Math.random() * 101));

                // Get a random index between 0 and 2
                const randomIndex: number = Math.floor(Math.random() * randomNumbers.length);

                // Return the object with fields "numbers" and "index"
                return { numbers: randomNumbers, index: randomIndex };
            }

            console.log('Webview->Ext:', JSON.stringify(message, null, 2));

            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const messageType = message?.type as string;

            switch (messageType) {
                case 'queryConfig': {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const queryString = (message?.payload?.queryText as string) ?? '{}';
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const pageNumber = (message?.payload?.pageNumber as number) ?? 1;
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const pageSize = (message?.payload?.pageSize as number) ?? 10;

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
                        json: responsePack?.jsonDocuments ?? '{ "noData": true }',
                        tableData: responsePack?.tableData ?? [],
                        tableHeaders: responsePack?.tableHeaders ?? [],
                        treeData: responsePack?.treeData ?? [],
                    });
                    break;
                }
                case 'deleteDocumentsRequest': {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const selectedDocumentObjectIds = message?.payload as string[];

                    const randomInput: { numbers: number[]; index: number } = getRandomArrayAndIndex(3);

                    const confirmation = await vscode.window.showWarningMessage(
                        `Are you sure?`,
                        {
                            modal: true,
                            detail:
                            `Delete ${selectedDocumentObjectIds.length} documents?\n\n`
                            + `This can't be undone.\n`
                            + `Choose '${randomInput.numbers[randomInput.index]}' to confirm.\n\n`
                            + `(Planned: Adjust this safety check in the settings.)`,
                        },
                        randomInput.numbers[0].toString(),
                        randomInput.numbers[1].toString(),
                        randomInput.numbers[2].toString(),
                    );

                    if (confirmation !== randomInput.numbers[randomInput.index].toString()) {
                        break;
                    }

                    const client: MongoClustersClient = await MongoClustersClient.getClient(_props.liveConnectionId);
                    const acknowledged = await client.deleteDocuments(
                        _props.databaseName,
                        _props.collectionName,
                        selectedDocumentObjectIds,
                    );

                    if (!acknowledged) {
                        void vscode.window.showErrorMessage('Failed to delete documents. Unknown error.', {
                            modal: true,
                        });
                    }

                    void panel.webview.postMessage({
                        type: 'deleteDocumentsResponse',
                        payload: acknowledged,
                    });

                    break;
                }
                case 'viewDocumentRequest': {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const objectId = message?.payload?.objectId as string;
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    //const index = message?.payload?.index as number;

                    // TODO: introduce response cache to the client to avoid sending the document content back and forth
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    let documentContent = (message?.payload?.documentContent as string) ?? '{  }';

                    //TODO: this is curcial to avoid breaking the webview, and make sure it's in the future API
                    // for all the data to be sent in a safe way
                    documentContent = encodeURIComponent(documentContent);

                    vscode.commands.executeCommand('mongoClusters.internal.documentView.open.view', {
                        id: _props.id,
                        liveConnectionId: _props.liveConnectionId,
                        viewTitle: `${_props.databaseName}/${_props.collectionName}/${objectId}`,
                        databaseName: _props.databaseName,
                        collectionName: _props.collectionName,
                        documentId: objectId,
                        documentContent: documentContent,
                    });
                    break;
                }
                case 'request.collectionView.addDocument': {
                    vscode.commands.executeCommand('mongoClusters.internal.documentView.open.add', {
                        id: _props.id,
                        liveConnectionId: _props.liveConnectionId,
                        viewTitle: `${_props.databaseName}/${_props.collectionName}/new`,
                        databaseName: _props.databaseName,
                        collectionName: _props.collectionName,
                        mode: 'add',
                    });
                    break;
                }

                default:
                    break;
            }
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
    mode?: string
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
                    __mode: '${mode}',
                    __vsCodeApi: acquireVsCodeApi(),
                };

                import { render } from "${srcUri}";
                render('mongoClustersDocumentView', window.config.__vsCodeApi, "${publicPath}");
            </script>


	</body>
	</html>`;
};
