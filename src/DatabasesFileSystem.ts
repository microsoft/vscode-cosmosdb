/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzExtTreeFileSystem,
    DialogResponses,
    UserCancelledError,
    type AzExtTreeFileSystemItem,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from './extensionVariables';
import { SettingsService } from './services/SettingsService';
import { getNodeEditorLabel } from './utils/vscodeUtils';

export interface EditableFileSystemItem extends AzExtTreeFileSystemItem {
    id: string;
    filePath: string;
    cTime: number;
    mTime: number;
    getFileContent(context: IActionContext): Promise<string>;
    writeFileContent(context: IActionContext, data: string): Promise<void>;
}

export class DatabasesFileSystem extends AzExtTreeFileSystem<EditableFileSystemItem> {
    public static scheme: string = 'azureDatabases';
    public scheme: string = DatabasesFileSystem.scheme;
    private _showSaveConfirmation: boolean = true;

    public async statImpl(context: IActionContext, node: EditableFileSystemItem): Promise<vscode.FileStat> {
        const size: number = Buffer.byteLength(await node.getFileContent(context));
        return { type: vscode.FileType.File, ctime: node.cTime, mtime: node.mTime, size };
    }

    public async readFileImpl(context: IActionContext, node: EditableFileSystemItem): Promise<Uint8Array> {
        return Buffer.from(await node.getFileContent(context));
    }

    public async writeFileImpl(
        context: IActionContext,
        node: EditableFileSystemItem,
        content: Uint8Array,
        _originalUri: vscode.Uri,
    ): Promise<void> {
        const showSavePromptKey: string = 'showSavePrompt';
        // NOTE: Using "cosmosDB" instead of "azureDatabases" here for the sake of backwards compatibility. If/when this file system adds support for non-cosmosdb items, we should consider changing this to "azureDatabases"
        const prefix: string = 'cosmosDB';
        const nodeEditorLabel: string = getNodeEditorLabel(node);
        if (this._showSaveConfirmation && SettingsService.getSetting<boolean>(showSavePromptKey, prefix)) {
            const message: string = l10n.t('Saving "{path}" will update the entity "{name}" to the cloud.', {
                path: node.filePath,
                name: nodeEditorLabel,
            });
            const result: vscode.MessageItem | undefined = await context.ui.showWarningMessage(
                message,
                { stepName: 'writeFile' },
                DialogResponses.upload,
                DialogResponses.alwaysUpload,
                DialogResponses.dontUpload,
            );
            if (result === DialogResponses.alwaysUpload) {
                await SettingsService.updateGlobalSetting(showSavePromptKey, false, prefix);
            } else if (result === DialogResponses.dontUpload) {
                throw new UserCancelledError('dontUpload');
            }
        }

        await node.writeFileContent(context, content.toString());

        this.fireChangedEvent(node);
        await vscode.commands.executeCommand('azureDatabases.refresh', node);

        const updatedMessage: string = l10n.t('Updated entity "{name}".', { name: nodeEditorLabel });
        ext.outputChannel.appendLog(updatedMessage);
    }

    public getFilePath(node: EditableFileSystemItem): string {
        return node.filePath;
    }

    public async updateWithoutPrompt(uri: vscode.Uri): Promise<void> {
        const textDoc = await vscode.workspace.openTextDocument(uri);
        this._showSaveConfirmation = false;
        try {
            await textDoc.save();
        } finally {
            this._showSaveConfirmation = true;
        }
    }

    public fireChangedEvent(node: EditableFileSystemItem): void {
        node.mTime = Date.now();
        this.fireSoon({ type: vscode.FileChangeType.Changed, item: node });
    }
}
