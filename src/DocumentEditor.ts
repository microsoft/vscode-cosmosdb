/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as os from 'os'
import * as path from 'path';
import * as vscode from 'vscode';
import { DialogBoxResponses } from './constants';
import { UserCancelledError } from './errors';
import { IEditableNode } from './nodes';
import * as util from './util';
import { randomUtils } from './utils/randomUtils';


export class DocumentEditor implements vscode.Disposable {
    private fileMap: { [key: string]: [vscode.TextDocument, IEditableNode] } = {};
    private ignoreSave: boolean = false;

    private readonly dontShowKey: string = 'cosmosDB.dontShow.SaveEqualsUpdateToAzure';

    public async showDocument(docNode: IEditableNode, extensionPath: string, fileName: string): Promise<void> {
        const localDocPath = path.join(extensionPath, fileName);
        await fse.ensureFile(localDocPath);

        const document = await vscode.workspace.openTextDocument(localDocPath);
        if (localDocPath in this.fileMap) {
            if (this.fileMap[localDocPath][0].isDirty) {
                const overwriteFlag = await vscode.window.showWarningMessage(`You are about to overwrite ${fileName}, which has unsaved changes. Do you want to continue?`, DialogBoxResponses.Yes, DialogBoxResponses.No);
                if (!overwriteFlag) {
                    throw new UserCancelledError();
                }
                if (overwriteFlag === DialogBoxResponses.No) {
                    return;
                }
            }
        }
        this.fileMap[localDocPath] = [document, docNode];
        const textEditor = await vscode.window.showTextDocument(document);
        await this.updateEditor(docNode.data, textEditor);
    }

    public async updateMatchingNode(doc): Promise<void> {
        const filePath = Object.keys(this.fileMap).find((filePath) => path.relative(doc.fsPath, filePath) === '');
        if (filePath) {
            await this.updateToCloud(this.fileMap[filePath][1], this.fileMap[filePath][0]);
        } else {
            await vscode.window.showInformationMessage(`Editing Cosmos DB entities across sessions is currently not supported.`)
        }
    }

    public async dispose(): Promise<void> {
        Object.keys(this.fileMap).forEach(async (key) => await fse.remove(path.dirname(key)));
    }

    private async updateToCloud(node: IEditableNode, doc: vscode.TextDocument): Promise<void> {
        const updatedDoc: {} = await node.update(JSON.parse(doc.getText()));
        const output = util.getOutputChannel();
        const timestamp = (new Date()).toLocaleTimeString();
        const docLink = node.getSelfLink();
        output.appendLine(`${timestamp}: Updated entity "${docLink}"`);
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
            const node: IEditableNode = this.fileMap[filePath][1];
            const dontShow: boolean | undefined = globalState.get(this.dontShowKey);
            if (dontShow !== true) {
                const message: string = `Saving 'cosmos-editor.json' will update the entity "${node.label}" to the Cloud.`;
                const result: string | undefined = await vscode.window.showWarningMessage(message, DialogBoxResponses.OK, DialogBoxResponses.DontShowAgain);

                if (!result) {
                    throw new UserCancelledError();
                } else if (result === DialogBoxResponses.DontShowAgain) {
                    await globalState.update(this.dontShowKey, true);
                }
            }

            await this.updateToCloud(node, doc);
        }
    }

}
