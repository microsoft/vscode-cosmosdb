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

export interface ICosmosEditor<T = {}> {
    label: string;
    getData(): Promise<T>;
    update(data: T): Promise<T>;
}

export class CosmosEditorManager implements vscode.Disposable {
    private fileMap: { [key: string]: [vscode.TextDocument, ICosmosEditor] } = {};
    private ignoreSave: boolean = false;

    private readonly dontShowKey: string = 'cosmosDB.dontShow.SaveEqualsUpdateToAzure';

    public async showDocument(editor: ICosmosEditor): Promise<void> {
        const localDocPath = path.join(os.tmpdir(), randomUtils.getRandomHexString(12), 'cosmos-editor.json');
        await fse.ensureFile(localDocPath);

        const document = await vscode.workspace.openTextDocument(localDocPath);
        this.fileMap[localDocPath] = [document, editor];
        const textEditor = await vscode.window.showTextDocument(document);
        const data = await editor.getData();
        await this.updateEditor(data, textEditor);
    }

    public async updateMatchingNode(doc): Promise<void> {
        const filePath = Object.keys(this.fileMap).find((filePath) => path.relative(doc.fsPath, filePath) === '');
        await this.updateToCloud(this.fileMap[filePath][1], this.fileMap[filePath][0]);
    }

    public async dispose(): Promise<void> {
        Object.keys(this.fileMap).forEach(async (key) => await fse.remove(path.dirname(key)));
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

    public async onDidSaveTextDocument(globalState: vscode.Memento, doc: vscode.TextDocument): Promise<void> {
        const filePath = Object.keys(this.fileMap).find((filePath) => path.relative(doc.uri.fsPath, filePath) === '');
        if (!this.ignoreSave && filePath) {
            const editor: ICosmosEditor = this.fileMap[filePath][1];
            const dontShow: boolean | undefined = globalState.get(this.dontShowKey);
            if (dontShow !== true) {
                const message: string = `Saving 'cosmos-editor.json' will update the entity "${editor.label}" to the Cloud.`;
                const result: string | undefined = await vscode.window.showWarningMessage(message, DialogBoxResponses.OK, DialogBoxResponses.DontShowAgain);

                if (!result) {
                    throw new UserCancelledError();
                } else if (result === DialogBoxResponses.DontShowAgain) {
                    await globalState.update(this.dontShowKey, true);
                }
            }

            await this.updateToCloud(editor, doc);
        }
    }

}
