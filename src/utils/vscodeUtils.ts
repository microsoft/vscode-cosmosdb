/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { type EditableFileSystemItem } from '../DatabasesFileSystem';
import { ext } from '../extensionVariables';
import { type TreeElement } from '../tree/TreeElement';
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

    throw new Error(l10n.t('Could not find unique name for new file.'));
}

export function getNodeEditorLabel(node: TreeElement | EditableFileSystemItem): string {
    return node.id;
}

export function getItemTreeItemLabel(itemDefinition: ItemDefinition): string {
    for (const field of getDocumentLabelFields()) {
        // eslint-disable-next-line no-prototype-builtins
        if (itemDefinition.hasOwnProperty(field)) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const value = itemDefinition[field];
            if (value !== undefined && typeof value !== 'object') {
                return String(value);
            }
        }
    }
    return String(itemDefinition._id ?? itemDefinition.id);
}

function getDocumentLabelFields(): string[] {
    const settingKey: string = ext.settingsKeys.documentLabelFields;
    return vscode.workspace.getConfiguration().get(settingKey) || [];
}
