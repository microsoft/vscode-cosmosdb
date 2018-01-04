/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as os from 'os'
import * as path from 'path';
import * as vscode from 'vscode';
import { DialogBoxResponses } from './constants';
import { UserCancelledError } from 'vscode-azureextensionui';
import * as util from './utils/vscodeUtils';
import { randomUtils } from './utils/randomUtils';
import { MessageItem } from 'vscode';

export interface ICosmosEditor<T = {}> {
    label: string;
    getData(): Promise<T>;
    update(data: T): Promise<T>;
}

export class CosmosEditorManager implements vscode.Disposable {
    private fileMap: { [key: string]: [vscode.TextDocument, ICosmosEditor] } = {};
    private ignoreSave: boolean = false;

    private readonly showSavePromptKey: string = 'cosmosDB.showSavePrompt';

    public async showDocument(editor: ICosmosEditor, fileName: string): Promise<void> {
        const localDocPath = path.join(os.tmpdir(), 'vscode-cosmosdb-editor', fileName);
        await fse.ensureFile(localDocPath);

        const document = await vscode.workspace.openTextDocument(localDocPath);
        if (localDocPath in this.fileMap) {
            if (this.fileMap[localDocPath][0].isDirty) {
                const overwriteFlag = await vscode.window.showWarningMessage(`You are about to overwrite "${fileName}", which has unsaved changes. Do you want to continue?`, DialogBoxResponses.Yes, DialogBoxResponses.Cancel);
                if (overwriteFlag !== DialogBoxResponses.Yes) {
                    throw new UserCancelledError();
                }
            }
        }
        this.fileMap[localDocPath] = [document, editor];
        const textEditor = await vscode.window.showTextDocument(document);
        const data = await editor.getData();
        await this.updateEditor(data, textEditor);
    }

    public async updateMatchingNode(doc): Promise<void> {
        const filePath = Object.keys(this.fileMap).find((filePath) => path.relative(doc.fsPath, filePath) === '');
        if (filePath) {
            await this.updateToCloud(this.fileMap[filePath][1], this.fileMap[filePath][0]);
        } else {
            await vscode.window.showWarningMessage(`Editing Cosmos DB entities across sessions is currently not supported.`)
        }
    }

    public async dispose(): Promise<void> {
        Object.keys(this.fileMap).forEach((key) => {
            const backupFileName = key.substring(0, key.lastIndexOf('.')) + "-backup.json";
            fse.ensureFileSync(backupFileName);
            fse.copySync(key, backupFileName);
            fse.writeFileSync(key, `// We do not support editing entities across sessions.\n// Reopen the entity or view your previous changes here: ${backupFileName}`);
        });
    }

    private async updateToCloud(editor: ICosmosEditor, doc: vscode.TextDocument): Promise<void> {
        const updatedDoc: {} = await editor.update(JSON.parse(doc.getText()));
        const output = util.getOutputChannel();
        const timestamp = (new Date()).toLocaleTimeString();
        output.appendLine(`${timestamp}: Updated entity "${editor.label}"`);
        output.show();
        await this.updateEditor(updatedDoc, vscode.window.activeTextEditor);
    }

    private async updateEditor(data: {}, textEditor: vscode.TextEditor): Promise<void> {
        await util.writeToEditor(textEditor, JSON.stringify(data, null, 2));
        this.ignoreSave = true;
        try {
            await textEditor.document.save();
        } finally {
            this.ignoreSave = false;
        }
    }

    public async onDidSaveTextDocument(trackTelemetry: () => void, globalState: vscode.Memento, doc: vscode.TextDocument): Promise<void> {
        const filePath = Object.keys(this.fileMap).find((filePath) => path.relative(doc.uri.fsPath, filePath) === '');
        if (!this.ignoreSave && filePath) {
            trackTelemetry();
            const editor: ICosmosEditor = this.fileMap[filePath][1];
            const showSaveWarning: boolean | undefined = vscode.workspace.getConfiguration().get(this.showSavePromptKey);
            if (showSaveWarning !== false) {
                const message: string = `Saving 'cosmos-editor.json' will update the entity "${editor.label}" to the Cloud.`;
                const result: MessageItem | undefined = await vscode.window.showWarningMessage(message, DialogBoxResponses.upload, DialogBoxResponses.uploadDontWarn, DialogBoxResponses.Cancel);

                if (result === DialogBoxResponses.uploadDontWarn) {
                    await vscode.workspace.getConfiguration().update(this.showSavePromptKey, false, vscode.ConfigurationTarget.Global);
                } else if (result !== DialogBoxResponses.upload) {
                    throw new UserCancelledError();
                }
            }

            await this.updateToCloud(editor, doc);
        }
    }

}
