/**
 * entry-point for vCore-related code. Activated from ./src/extension.ts
 *
 * We'll try to have everything related to vCore-support managed from here.
 * In case of a failure with this plan, this comment section will be updated.
 */
import { callWithTelemetryAndErrorHandling, registerCommand, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { MongoVCoreResolver } from '../resolver/MongoVCoreResolver';


export class VCoreExtension implements vscode.Disposable {

    constructor() {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        ext.rgApi.registerApplicationResourceResolver(AzExtResourceType.MongoClusters as string, new MongoVCoreResolver());
    }

    async activate(): Promise<void> {
        await callWithTelemetryAndErrorHandling('vCore.activate', async (activateContext: IActionContext) => {
            activateContext.telemetry.properties.isActivationEvent = 'true';

            // using registerCommand instead of vscode.commands.registerCommand for better telemetry:
            // https://github.com/microsoft/vscode-azuretools/tree/main/utils#telemetry-and-error-handling
            registerCommand('vCore.cmd.hello', this.commandSayHello);
            registerCommand('vCore.cmd.webview', this.commandShowWebview);
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
            'vCore', // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            {
                enableScripts: true,
                enableCommandUris: true,
                retainContextWhenHidden: true
            } // Webview options. More on these later.
        );

        panel.webview.html = getWebviewContentReact();
    }

    async dispose(): Promise<void> {
        return;
    }
}


// function getWebviewContent(): string {
//     return `<!DOCTYPE html>
//   <html lang="en">
//   <head>
//       <meta charset="UTF-8">
//       <meta name="viewport" content="width=device-width, initial-scale=1.0">
//       <title>Cat Coding</title>
//   </head>
//   <body>
//       <h1 id="lines-of-code-counter">0</h1>
//       <img src="https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif" width="300" />
//   </body>

//     <script>
//         const counter = document.getElementById('lines-of-code-counter');

//         let count = 0;
//         setInterval(() => {
//             counter.textContent = count++;
//         }, 1000);

//         // setInterval(() => {
//         //     panel.dispose();
//         // }, 5000);

//     </script>


//   </html>`;
// }


const getWebviewContentReact = () => {
    const jsFile = "views.js";
    const localServerUrl = "http://localhost:18080"; //webpack

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
            import { render } from "${scriptUrl}";
            render('vCoreCollectionView', acquireVsCodeApi(), "'/static");
            </script>


	</body>
	</html>`;
}
