/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { DialogBoxResponses } from './constants';
import { UserCancelledError } from './errors';
import { IDocumentNode } from './nodes';
import * as util from './util';

export class DocumentEditor implements vscode.Disposable {
    private lastOpenedDocNode: IDocumentNode | undefined;
    private localDocPath: string;
    private localDocEditor: vscode.TextEditor | undefined;

    private ignoreSave: boolean = false;
    private isLocalDocOpen: boolean = false;

    private recoveredDocsFolder: string;
    private recoveredFileName: string | undefined;

    private readonly dontShowKey: string = 'cosmosDB.dontShow.SaveEqualsUpdateToAzure';

    constructor(context: vscode.ExtensionContext) {
        // Use a workspace-specific path unique to our extension if possible. Otherwise, just use the main folder for our extension
        this.localDocPath = path.resolve(path.join(context.storagePath || context.extensionPath, 'cosmos-document.json'));
        this.recoveredDocsFolder = path.join(context.extensionPath, 'recoveredDocs');

        this.promptForRecoveredDocs();
    }

    public async showDocument(docNode: IDocumentNode): Promise<void> {
        // Prompt to update opened doc if it's dirty
        if (this.lastOpenedDocNode && this.localDocEditor) {
            // soft-copy the node and doc to avoid race conditions
            const doc: vscode.TextDocument = this.localDocEditor.document;
            const node: IDocumentNode = this.lastOpenedDocNode;

            if (doc.isDirty) {
                const message: string = `Your changes to document '${this.lastOpenedDocNode.label}' will be lost. Update to Azure?`;
                const result: string | undefined = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes, DialogBoxResponses.No);
                if (result === DialogBoxResponses.Yes) {
                    await this.udpateDocumentToNode(node, doc);
                } else if (result === undefined) {
                    throw new UserCancelledError();
                }
            }
        }

        await fse.ensureFile(this.localDocPath);
        const textDocument: vscode.TextDocument = await vscode.workspace.openTextDocument(this.localDocPath);
        this.localDocEditor = await vscode.window.showTextDocument(textDocument);
        this.lastOpenedDocNode = docNode;
        this.isLocalDocOpen = true;
        await this.updateEditor(docNode.data);
    }

    public async updateLastDocument(): Promise<void> {
        if (this.lastOpenedDocNode && this.localDocEditor) {
            await this.udpateDocumentToNode(this.lastOpenedDocNode, this.localDocEditor.document);
        } else {
            throw new Error('You must select a Document in the CosmosDB explorer before updating to Azure.');
        }
    }

    public async dispose(): Promise<void> {
        if (this.recoveredFileName) {
            await fse.ensureDir(this.recoveredDocsFolder);
            await fse.move(this.localDocPath, path.join(this.recoveredDocsFolder, this.recoveredFileName));
        } else {
            await fse.unlink(this.localDocPath);
        }
    }

    private async promptForRecoveredDocs(): Promise<void> {
        if (await fse.pathExists(this.recoveredDocsFolder)) {
            const docs: string[] = await fse.readdir(this.recoveredDocsFolder);
            for (const fileName of docs) {
                const recoveredFilePath: string = path.join(this.recoveredDocsFolder, fileName);
                const textDocument: vscode.TextDocument = await vscode.workspace.openTextDocument(recoveredFilePath);
                await vscode.window.showTextDocument(textDocument);

                const message: string = `The data in "${fileName}" may not have been updated to your CosmosDB account.`;
                const saveFile: string = 'Save File';
                const deleteFile: string = 'Delete File';
                const result: string | undefined = await vscode.window.showWarningMessage(message, saveFile, deleteFile);
                if (result === saveFile) {
                    const savedPath: vscode.Uri | undefined = await vscode.window.showSaveDialog({ filters: { JSON: ['json'] } });
                    if (savedPath) {
                        await fse.move(recoveredFilePath, savedPath.fsPath);
                    }
                } else if (result === deleteFile) {
                    await fse.unlink(recoveredFilePath);
                }
            }
        }
    }

    private async udpateDocumentToNode(node: IDocumentNode, doc: vscode.TextDocument): Promise<void> {
        const updatedDoc: {} = await node.update(JSON.parse(doc.getText()));
        await this.updateEditor(updatedDoc);
    }

    private async updateEditor(data: {}): Promise<void> {
        if (this.isLocalDocOpen && this.localDocEditor) {
            await util.writeToEditor(this.localDocEditor, JSON.stringify(data, null, 2));

            this.ignoreSave = true;
            try {
                await this.localDocEditor.document.save();
            } finally {
                this.ignoreSave = false;
            }
        }
    }

    public async onDidSaveTextDocument(globalState: vscode.Memento, doc: vscode.TextDocument): Promise<void> {
        if (!this.ignoreSave && this.isLocalDocPath(doc) && this.lastOpenedDocNode) {
            // soft-copy the node to avoid race conditions
            const node: IDocumentNode = this.lastOpenedDocNode;

            // If the user saved the file as a part of closing VS Code, we might not be able to 'Update to Azure' in time
            // However, we can copy the file to this path and prompt user about it on next activation
            this.recoveredFileName = `${this.lastOpenedDocNode.label}${Date.now().toString()}.json`;
            try {
                const dontShow: boolean | undefined = globalState.get(this.dontShowKey);
                if (dontShow !== true) {
                    const message: string = `Saving "cosmos-document.json" will update the CosmosDB document "${node.label}" in Azure.`;
                    const result: string | undefined = await vscode.window.showWarningMessage(message, DialogBoxResponses.OK, DialogBoxResponses.DontShowAgain);

                    if (!result) {
                        throw new UserCancelledError();
                    } else if (result === DialogBoxResponses.DontShowAgain) {
                        await globalState.update(this.dontShowKey, true);
                    }
                }

                await this.udpateDocumentToNode(node, doc);
            } finally {
                this.recoveredFileName = undefined;
            }
        }
    }

    public async onDidCloseTextDocument(doc: vscode.TextDocument): Promise<void> {
        if (this.isLocalDocPath(doc)) {
            this.isLocalDocOpen = false;
        }
    }

    private isLocalDocPath(doc: vscode.TextDocument): boolean {
        // VSCode can return a uri with various schemes, resulting in an fsPath like 'cosmos-document.json.git'
        // Since the local doc is saved in our extension's directory, we can just use 'startsWith' to check if this is the right file
        return path.resolve(doc.uri.fsPath).startsWith(this.localDocPath);
    }
}
