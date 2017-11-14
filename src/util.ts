/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { reporter } from './telemetry';
import * as path from 'path';
import * as fse from 'fs-extra';
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

export async function showNewFile(data: string, extensionPath: string, fileName: string, fileExtension: string, column?: vscode.ViewColumn): Promise<void> {
	let uri: vscode.Uri = null;
	const folderPath: string = vscode.workspace.rootPath || extensionPath;
	const fullFileName: string | undefined = await getUniqueFileName(folderPath, fileName, fileExtension);
	uri = vscode.Uri.file(path.join(folderPath, fullFileName)).with({ scheme: 'untitled' });
	const textDocument = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(textDocument, column ? column > vscode.ViewColumn.Three ? vscode.ViewColumn.One : column : undefined, true)
	await writeToEditor(editor, data);
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

export async function getUniqueFileName(folderPath: string, fileName: string, fileExtension: string): Promise<string> {
	let count: number = 1;
	const maxCount: number = 1024;

	while (count < maxCount) {
		const fileSuffix = count === 0 ? '' : '-' + count.toString();
		const fullFileName: string = fileName + fileSuffix + fileExtension;

		const fullPath: string = path.join(folderPath, fullFileName);
		const pathExists: boolean = await fse.pathExists(fullPath);
		const editorExists: boolean = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === fullPath) !== undefined;
		if (!pathExists && !editorExists) {
			return fullFileName;
		}
		count += 1;
	}

	throw new Error('Could not find unique name for new file.');
}

export function removeDuplicatesById<T extends { id: string }>(entries: T[]): T[] {
	var mapById = new Map<string, T>();
	entries.forEach(n => {
		mapById.set(n.id, n);
	});

	return [...mapById.values()];
}

export function truncateWithEllipses(s: string, maxCharacters) {
	if (s && s.length > maxCharacters) {
		return `${s.slice(0, maxCharacters)}...`;
	}

	return s;
}
