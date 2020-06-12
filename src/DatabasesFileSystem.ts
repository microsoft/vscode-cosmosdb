/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileStat, FileType, MessageItem, Uri, workspace } from "vscode";
import { AzExtItemQuery, AzExtItemUriParts, AzExtTreeFileSystem, AzExtTreeItem, DialogResponses, IActionContext, UserCancelledError } from 'vscode-azureextensionui';
import { FileChangeType } from "vscode-languageclient";
import { ext } from "./extensionVariables";
import { MongoCollectionTreeItem } from "./mongo/tree/MongoCollectionTreeItem";
import { localize } from "./utils/localize";
import { getWorkspaceSetting, updateGlobalSetting } from "./utils/settingUtils";
import { getNodeEditorLabel } from "./utils/vscodeUtils";

export interface IEditableTreeItem extends AzExtTreeItem {
    filePath: string;
    cTime: number;
    mTime: number;
    getFileContent(context: IActionContext): Promise<string>;
    writeFileContent(context: IActionContext, data: string): Promise<void>;
}

export class DatabasesFileSystem extends AzExtTreeFileSystem<IEditableTreeItem> {
    public static scheme: string = 'azureDatabases';
    public scheme: string = DatabasesFileSystem.scheme;
    private _showSaveConfirmation: boolean = true;

    public async statImpl(context: IActionContext, node: IEditableTreeItem): Promise<FileStat> {
        const size: number = Buffer.byteLength(await node.getFileContent(context));
        return { type: FileType.File, ctime: node.cTime, mtime: node.mTime, size };
    }

    public async readFileImpl(context: IActionContext, node: IEditableTreeItem): Promise<Uint8Array> {
        return Buffer.from(await node.getFileContent(context));
    }

    public async writeFileImpl(context: IActionContext, node: IEditableTreeItem, content: Uint8Array, _originalUri: Uri): Promise<void> {
        const showSavePromptKey: string = 'showSavePrompt';
        const prefix: string = 'cosmosDB';
        const nodeEditorLabel: string = getNodeEditorLabel(node);
        if (this._showSaveConfirmation && getWorkspaceSetting<boolean>(showSavePromptKey, undefined, prefix)) {
            const message: string = localize('saveConfirmation', 'Saving "{0}" will update the entity "{1}" to the cloud.', node.filePath, nodeEditorLabel);
            const result: MessageItem | undefined = await ext.ui.showWarningMessage(message, DialogResponses.upload, DialogResponses.alwaysUpload, DialogResponses.dontUpload);
            if (result === DialogResponses.alwaysUpload) {
                await updateGlobalSetting(showSavePromptKey, false, prefix);
            } else if (result === DialogResponses.dontUpload) {
                throw new UserCancelledError();
            }
        }

        await node.writeFileContent(context, content.toString());
        await node.refresh();

        const updatedMessage: string = localize('updatedEntity', 'Updated entity "{0}".', nodeEditorLabel);
        ext.outputChannel.appendLog(updatedMessage);
    }

    public getFilePath(node: IEditableTreeItem): string {
        return node.filePath;
    }

    public async updateWithoutPrompt(uri: Uri): Promise<void> {
        const textDoc = await workspace.openTextDocument(uri);
        this._showSaveConfirmation = false;
        try {
            await textDoc.save();
        } finally {
            this._showSaveConfirmation = true;
        }
    }

    public fireChangedEvent(node: IEditableTreeItem): void {
        node.mTime = Date.now();
        this.fireSoon({ type: FileChangeType.Changed, item: node });
    }

    protected getUriParts(node: IEditableTreeItem): AzExtItemUriParts {
        const uriParts: AzExtItemUriParts = super.getUriParts(node);
        if (node instanceof MongoCollectionTreeItem && node.findArgs) {
            addFindArgsToQuery(uriParts.query, node.findArgs);
        }
        return uriParts;
    }

    protected async findItem(context: IActionContext, query: AzExtItemQuery): Promise<IEditableTreeItem | undefined> {
        const node: IEditableTreeItem | undefined = await super.findItem(context, query);
        if (node && node instanceof MongoCollectionTreeItem) {
            const findArgs: {}[] | undefined = getFindArgsFromQuery(query);
            if (findArgs) {
                return new MongoCollectionTreeItem(node.parent, node.collection, findArgs);
            }
        }
        return node;
    }
}

function addFindArgsToQuery(query: AzExtItemQuery, commandArgs: {}[]): void {
    let count: number = 0;
    for (const arg of commandArgs) {
        const key: string = getFindArgKey(count);
        query[key] = JSON.stringify(arg);
        count += 1;
    }
}

function getFindArgsFromQuery(query: AzExtItemQuery): {}[] | undefined {
    const result: {}[] = [];
    let count: number = 0;
    // tslint:disable-next-line: no-constant-condition
    while (true) {
        const key: string = getFindArgKey(count);
        const value: string | string[] | undefined = query[key];
        if (typeof value === 'string') {
            result.push(JSON.parse(value));
        } else if (!value) {
            break;
        }
        count += 1;
    }
    return result.length > 0 ? result : undefined;
}

function getFindArgKey(count: number): string {
    return 'arg' + String(count);
}
