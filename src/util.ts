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

export function errToString(error: any): string {
	if (error === null || error === undefined) {
		return '';
	}

	if (error instanceof Error) {
		return JSON.stringify({
			'Error': error.constructor.name,
			'Message': error.message
		});
	}

	if (typeof (error) === 'object') {
		return JSON.stringify({
			'object': error.constructor.name
		});
	}

	return error.toString();
}

export function showResult(result: string, filename: string, column?: vscode.ViewColumn): Thenable<void> {
	let uri: vscode.Uri = null;
	if (vscode.workspace.rootPath) {
		uri = vscode.Uri.file(path.join(vscode.workspace.rootPath, filename));
		if (!fs.existsSync(uri.fsPath)) {
			uri = uri.with({ scheme: 'untitled' });
		}
	} else {
		vscode.window.showErrorMessage(`No workspace present. Please create a workspace.`);
		return;
	}
	return vscode.workspace.openTextDocument(uri)
		.then(textDocument => vscode.window.showTextDocument(textDocument, column ? column > vscode.ViewColumn.Three ? vscode.ViewColumn.One : column : undefined, true))
		.then(editor => {
			editor.edit(editorBuilder => {
				if (editor.document.lineCount > 0) {
					const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
					editorBuilder.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine.range.start.line, lastLine.range.end.character)));
				}
				editorBuilder.insert(new vscode.Position(0, 0), result);
			});
		});
}
