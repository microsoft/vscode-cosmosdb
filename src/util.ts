/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { reporter } from './telemetry';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

export interface IDisposable {
	dispose(): void;
}

export function dispose<T extends IDisposable>(disposables: T[]): T[] {
	disposables.forEach(d => d.dispose());
	return [];
}

export function toDisposable(dispose: () => void): IDisposable {
	return { dispose };
}

// Telemetry for the extension
export function sendTelemetry(eventName: string, properties?: { [key: string]: string; }, measures?: { [key: string]: number; }) {
	if (reporter) {
		reporter.sendTelemetryEvent(eventName, properties, measures);
	}
}

const outputChannel = vscode.window.createOutputChannel("Azure CosmosDB");

export function getOutputChannel(): vscode.OutputChannel {
	return outputChannel;
}

export async function showResult(result: string, filename: string, column?: vscode.ViewColumn): Promise<void> {
	let uri: vscode.Uri = null;
	const currExtensionPath = vscode.extensions.getExtension("ms-azuretools.vscode-cosmosdb").extensionPath;
	const filepath = vscode.workspace.rootPath || currExtensionPath;
	if (filepath) {
		uri = vscode.Uri.file(path.join(filepath, filename));
		if (!fs.existsSync(uri.fsPath)) {
			uri = uri.with({ scheme: 'untitled' });
		}
	}

	const textDocument = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(textDocument, column ? column > vscode.ViewColumn.Three ? vscode.ViewColumn.One : column : undefined, true)
	await writeToEditor(editor, result);
}

export async function writeToEditor(editor: vscode.TextEditor, data: string): Promise<void> {
	await editor.edit((editBuilder: vscode.TextEditorEdit) => {
		if (editor.document.lineCount > 0) {
			const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
			editBuilder.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine.range.start.line, lastLine.range.end.character)));
		}

		editBuilder.insert(new vscode.Position(0, 0), data);
	});
}
