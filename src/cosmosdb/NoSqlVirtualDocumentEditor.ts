/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

interface ParsedContent {
    connection?: {
        databaseId?: string;
        containerId?: string;
        endpoint?: string;
        isEmulator?: boolean;
    } | null;
    query?: string;
    results?: unknown;
    timestamp?: number;
    error?: string;
    rawContent?: string;
}

/**
 * Simple virtual document editor for nosql-virtual: scheme documents
 * Displays content in a webview when virtual documents are opened
 */
export class NoSqlVirtualDocumentEditor {
    private readonly webviewPanels = new Map<string, vscode.WebviewPanel>();
    private static instance: NoSqlVirtualDocumentEditor | undefined;

    public static register(_context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new NoSqlVirtualDocumentEditor();
        NoSqlVirtualDocumentEditor.instance = provider;

        // Listen for when virtual documents are opened
        const disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor?.document.uri.scheme === 'nosql-virtual') {
                void provider.openVirtualDocumentEditor(editor.document);
            }
        });

        return disposable;
    }

    public static getInstance(): NoSqlVirtualDocumentEditor | undefined {
        return NoSqlVirtualDocumentEditor.instance;
    }

    constructor() {}

    public openEditor(document: vscode.TextDocument): void {
        this.openVirtualDocumentEditor(document);
    }

    private openVirtualDocumentEditor(document: vscode.TextDocument): void {
        const uri = document.uri.toString();

        // Check if we already have a panel for this document
        if (this.webviewPanels.has(uri)) {
            const panel = this.webviewPanels.get(uri)!;
            panel.reveal();
            this.updateWebviewContent(panel, document);
            return;
        }

        // Create new webview panel
        const panel = vscode.window.createWebviewPanel(
            'nosqlVirtualEditor',
            `NoSQL Query: ${document.uri.path}`,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        // Store the panel
        this.webviewPanels.set(uri, panel);

        // Set initial content
        this.updateWebviewContent(panel, document);

        // Update webview when document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === uri) {
                this.updateWebviewContent(panel, e.document);
            }
        });

        // Clean up when panel is disposed
        panel.onDidDispose(() => {
            this.webviewPanels.delete(uri);
            changeDocumentSubscription.dispose();
        });
    }

    private updateWebviewContent(panel: vscode.WebviewPanel, document: vscode.TextDocument): void {
        panel.webview.html = this.getHtmlForWebview(document);
    }

    private getHtmlForWebview(document: vscode.TextDocument): string {
        const content = document.getText();
        let parsedContent: ParsedContent;

        try {
            parsedContent = JSON.parse(content) as ParsedContent;
        } catch {
            parsedContent = { error: 'Invalid JSON content', rawContent: content };
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NoSQL Virtual Document</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        .section {
            margin-bottom: 20px;
            padding: 15px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            background-color: var(--vscode-panel-background);
        }
        .section-title {
            font-weight: bold;
            margin-bottom: 10px;
            color: var(--vscode-textLink-foreground);
        }
        .connection-info {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
        }
        .query-content {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            background-color: var(--vscode-editor-background);
            padding: 10px;
            border-radius: 4px;
            white-space: pre-wrap;
            border: 1px solid var(--vscode-input-border);
        }
        .results {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            background-color: var(--vscode-editor-background);
            padding: 10px;
            border-radius: 4px;
            white-space: pre-wrap;
            border: 1px solid var(--vscode-input-border);
        }
        .error {
            color: var(--vscode-errorForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>NoSQL Virtual Document Editor</h1>

        <div class="section">
            <div class="section-title">Connection Information</div>
            <div class="connection-info">
                ${
                    parsedContent.connection
                        ? `
                    <div><strong>Database:</strong> ${parsedContent.connection.databaseId || 'Not specified'}</div>
                    <div><strong>Container:</strong> ${parsedContent.connection.containerId || 'Not specified'}</div>
                    <div><strong>Endpoint:</strong> ${parsedContent.connection.endpoint || 'Not specified'}</div>
                    <div><strong>Is Emulator:</strong> ${parsedContent.connection.isEmulator ? 'Yes' : 'No'}</div>
                `
                        : '<div class="error">No connection information available</div>'
                }
            </div>
        </div>

        <div class="section">
            <div class="section-title">Query</div>
            <div class="query-content">${parsedContent.query || 'No query specified'}</div>
        </div>

        <div class="section">
            <div class="section-title">Results</div>
            <div class="results">
                ${parsedContent.results ? JSON.stringify(parsedContent.results, null, 2) : 'No results yet'}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Metadata</div>
            <div>
                <div><strong>Timestamp:</strong> ${parsedContent.timestamp ? new Date(parsedContent.timestamp).toLocaleString() : 'Not available'}</div>
                <div><strong>Document URI:</strong> ${document.uri.toString()}</div>
            </div>
        </div>

        ${
            parsedContent.error
                ? `
        <div class="section">
            <div class="section-title error">Error</div>
            <div class="error">${parsedContent.error}</div>
            <div class="section-title">Raw Content</div>
            <div class="query-content">${parsedContent.rawContent}</div>
        </div>
        `
                : ''
        }
    </div>
</body>
</html>`;
    }
}
