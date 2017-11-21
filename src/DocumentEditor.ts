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

    public async showDocument(docNode: IEditableNode, fileName: string): Promise<void> {
        const localDocPath = path.join(os.tmpdir(), randomUtils.getRandomHexString(12), fileName);
        await fse.ensureFile(localDocPath);

        const document = await vscode.workspace.openTextDocument(localDocPath);
        this.fileMap[localDocPath] = [document, docNode];
        const textEditor = await vscode.window.showTextDocument(document);
        await this.updateEditor(docNode.data, textEditor);
    }

    public async updateMatchingNode(doc): Promise<void> {
        const filePath = Object.keys(this.fileMap).find((filePath) => path.relative(doc.fsPath, filePath) === '');
        await this.udpateDocumentToNode(this.fileMap[filePath][1], this.fileMap[filePath][0]);
    }

    public async dispose(): Promise<void> {
        Object.keys(this.fileMap).forEach(async (key) => await fse.unlink(key));
    }

    private async udpateDocumentToNode(node: IEditableNode, doc: vscode.TextDocument): Promise<void> {
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
                const message: string = `Saving this file will update the entity "${node.label}" in Azure.`;
                const result: string | undefined = await vscode.window.showWarningMessage(message, DialogBoxResponses.OK, DialogBoxResponses.DontShowAgain);

                if (!result) {
                    throw new UserCancelledError();
                } else if (result === DialogBoxResponses.DontShowAgain) {
                    await globalState.update(this.dontShowKey, true);
                }
            }

            await this.udpateDocumentToNode(node, doc);
        }
    }

}
