/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeFileSystem, AzExtTreeItem, DialogResponses, IActionContext, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { FileStat, FileType, MessageItem, Uri, workspace } from "vscode";
import { FileChangeType } from "vscode-languageclient";
import { ext } from "./extensionVariables";
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
        // NOTE: Using "cosmosDB" instead of "azureDatabases" here for the sake of backwards compatibility. If/when this file system adds support for non-cosmosdb items, we should consider changing this to "azureDatabases"
        const prefix: string = 'cosmosDB';
        const nodeEditorLabel: string = getNodeEditorLabel(node);
        if (this._showSaveConfirmation && getWorkspaceSetting<boolean>(showSavePromptKey, undefined, prefix)) {
            const message: string = localize('saveConfirmation', 'Saving "{0}" will update the entity "{1}" to the cloud.', node.filePath, nodeEditorLabel);
            const result: MessageItem | undefined = await context.ui.showWarningMessage(message, { stepName: 'writeFile' }, DialogResponses.upload, DialogResponses.alwaysUpload, DialogResponses.dontUpload);
            if (result === DialogResponses.alwaysUpload) {
                await updateGlobalSetting(showSavePromptKey, false, prefix);
            } else if (result === DialogResponses.dontUpload) {
                throw new UserCancelledError('dontUpload');
            }
        }

        await node.writeFileContent(context, content.toString());
        await node.refresh(context);

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
}
