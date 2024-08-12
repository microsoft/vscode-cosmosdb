/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ItemDefinition } from '@azure/cosmos';
import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { DocDBAccountTreeItemBase } from '../docdb/tree/DocDBAccountTreeItemBase';
import { ext } from '../extensionVariables';
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { IMongoDocument } from '../mongo/tree/MongoDocumentTreeItem';
import { getRootPath } from './workspacUtils';

export interface IDisposable {
    dispose(): void;
}

export function dispose<T extends IDisposable>(disposables: T[]): T[] {
    disposables.forEach((d) => d.dispose());
    return [];
}

export function toDisposable(dispose: () => void): IDisposable {
    return { dispose };
}

export async function showNewFile(
    data: string,
    fileName: string,
    fileExtension: string,
    column?: vscode.ViewColumn,
): Promise<void> {
    const folderPath: string = getRootPath() || ext.context.extensionPath;
    const fullFileName: string | undefined = await getUniqueFileName(folderPath, fileName, fileExtension);
    const uri: vscode.Uri = vscode.Uri.file(path.join(folderPath, fullFileName)).with({ scheme: 'untitled' });
    const textDocument = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(
        textDocument,
        column ? (column > vscode.ViewColumn.Three ? vscode.ViewColumn.One : column) : undefined,
        true,
    );
    await writeToEditor(editor, data);
}

export async function writeToEditor(editor: vscode.TextEditor, data: string): Promise<void> {
    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        if (editor.document.lineCount > 0) {
            const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
            editBuilder.delete(
                new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(lastLine.range.start.line, lastLine.range.end.character),
                ),
            );
        }

        editBuilder.insert(new vscode.Position(0, 0), data);
    });
}

async function getUniqueFileName(folderPath: string, fileName: string, fileExtension: string): Promise<string> {
    let count: number = 1;
    const maxCount: number = 1024;

    while (count < maxCount) {
        const fileSuffix = count === 0 ? '' : '-' + count.toString();
        const fullFileName: string = fileName + fileSuffix + fileExtension;

        const fullPath: string = path.join(folderPath, fullFileName);
        const pathExists: boolean = await fse.pathExists(fullPath);
        const editorExists: boolean =
            vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === fullPath) !== undefined;
        if (!pathExists && !editorExists) {
            return fullFileName;
        }
        count += 1;
    }

    throw new Error('Could not find unique name for new file.');
}

export function getNodeEditorLabel(node: AzExtTreeItem): string {
    const labels = [node.label];
    while (node.parent) {
        node = node.parent;
        labels.unshift(node.label);
        if (isAccountTreeItem(node)) {
            break;
        }
    }
    return labels.join('/');
}

function isAccountTreeItem(treeItem: AzExtTreeItem): boolean {
    return treeItem instanceof MongoAccountTreeItem || treeItem instanceof DocDBAccountTreeItemBase;
}

export function getDocumentTreeItemLabel(document: IMongoDocument | ItemDefinition): string {
    for (const field of getDocumentLabelFields()) {
        // eslint-disable-next-line no-prototype-builtins
        if (document.hasOwnProperty(field)) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const value = document[field];
            if (value !== undefined && typeof value !== 'object') {
                return String(value);
            }
        }
    }
    return String(document._id);
}

function getDocumentLabelFields(): string[] {
    const settingKey: string = ext.settingsKeys.documentLabelFields;
    return vscode.workspace.getConfiguration().get(settingKey) || [];
}
