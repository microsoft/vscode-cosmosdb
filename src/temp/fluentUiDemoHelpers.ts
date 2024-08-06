import * as vscode from 'vscode';


const getWebviewContentReact = () => {
    const jsFile = "views.js";
    const localServerUrl = "http://localhost:18080"; //webpack

    const scriptUrl = `${localServerUrl}/${jsFile}`;

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
            render('fluentUiDemo', acquireVsCodeApi(), "'/'");
            </script>
	</body>
	</html>`;
}


export function showFluentUiDemo(): void {
    const panel = vscode.window.createWebviewPanel(
        'development.demoUi', // Identifies the type of the webview. Used internally
        'Fluent UI Components', // Title of the panel displayed to the user
        vscode.ViewColumn.One, // Editor column to show the new webview panel in.
        {
            enableScripts: true,
            enableCommandUris: true,
            retainContextWhenHidden: true
        } // Webview options. More on these later.
    );

    panel.webview.html = getWebviewContentReact();
}

