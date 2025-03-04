/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, DialogResponses } from '@microsoft/vscode-azext-utils';
import { type ParsedUrlQueryInput } from 'querystring';
import vscode, {
    FilePermission,
    type FileStat,
    FileSystemError,
    FileType,
    type MessageItem,
    type Uri,
    window,
    workspace,
} from 'vscode';
import { FileChangeType } from 'vscode-languageclient';
import { AzureDBFileSystemProvider, type TreeFileSystemItem } from '../../AzureDBFileSystemProvider';
import { ext } from '../../extensionVariables';
import { SettingsService } from '../../services/SettingsService';
import { localize } from '../../utils/localize';
import { getNodeEditorLabel, writeToEditor } from '../../utils/vscodeUtils';
import { DocumentFileDescriptor } from './DocumentFileDescriptor';

export type EditableFileSystemItemType = 'Document' | 'StoredProcedure' | 'Trigger';

export interface EditableFileSystemItem extends TreeFileSystemItem {
    id: string;
    filePath: string;
    cTime: number;
    mTime: number;
    isReadOnly: boolean;
    size: number;
    type: EditableFileSystemItemType;
    create(data: string): Promise<void>;
    read(): Promise<string>;
    update(data: string): Promise<void>;
    delete(): Promise<void>;
    validate(data: string): Promise<void>;
    getFileQuery(): ParsedUrlQueryInput;
}

export class CosmosFileSystem extends AzureDBFileSystemProvider<EditableFileSystemItem> {
    public static newFileName: string = '<new-file>';
    public static scheme: string = 'cosmosdb';
    public scheme: string = CosmosFileSystem.scheme;

    private _showSaveConfirmation: boolean = true;

    protected async statImpl(item: EditableFileSystemItem): Promise<FileStat> {
        const permissions = item.isReadOnly ? FilePermission.Readonly : undefined;
        return { type: FileType.File, ctime: item.cTime, mtime: item.mTime, size: item.size, permissions };
    }

    protected async readFileImpl(item: EditableFileSystemItem): Promise<string> {
        return item.read();
    }

    protected async writeFileImpl(item: EditableFileSystemItem, content: string, originalUri: Uri): Promise<void> {
        const showSavePromptKey: string = 'showSavePrompt';
        // NOTE: Using "cosmosDB" instead of "azureDatabases" here for the sake of backwards compatibility.
        const prefix: string = 'cosmosDB';
        const nodeEditorLabel: string = getNodeEditorLabel(item);
        if (this._showSaveConfirmation && SettingsService.getSetting<boolean>(showSavePromptKey, prefix)) {
            const message: string = localize(
                'saveConfirmation',
                'Saving "{0}" will update the entity "{1}" to the cloud.',
                item.filePath,
                nodeEditorLabel,
            );
            const result: MessageItem | undefined = await window.showWarningMessage(
                message,
                DialogResponses.upload,
                DialogResponses.alwaysUpload,
                DialogResponses.dontUpload,
            );
            if (result === undefined || result === DialogResponses.cancel || result === DialogResponses.dontUpload) {
                throw FileSystemError.NoPermissions(localize('userCancelledError', 'Operation cancelled.'));
            } else if (result === DialogResponses.alwaysUpload) {
                await SettingsService.updateGlobalSetting(showSavePromptKey, false, prefix);
            }
        }

        const query = this.getFileQuery(item);
        if (query.id === CosmosFileSystem.newFileName) {
            await item.create(content);
            this.fireSoon({ type: FileChangeType.Created, item: item });

            const updatedMessage: string = localize('createdEntity', 'Created entity "{0}".', nodeEditorLabel);
            ext.outputChannel.appendLog(updatedMessage);
            setTimeout(() => {
                // Rename the file to remove the "<new-file>" suffix. Need gap between creation and renaming
                void vscode.workspace.fs.rename(originalUri, this.getUriFromItem(item), { overwrite: true });
            }, 0);
        } else {
            await item.update(content);
            this.fireSoon({ type: FileChangeType.Changed, item: item });

            const updatedMessage: string = localize('updatedEntity', 'Updated entity "{0}".', nodeEditorLabel);
            ext.outputChannel.appendLog(updatedMessage);
        }

        await vscode.commands.executeCommand('azureDatabases.refresh', item);
    }

    protected async deleteFileImpl(item: EditableFileSystemItem): Promise<void> {
        const query = this.getFileQuery(item);
        if (query.id === CosmosFileSystem.newFileName) {
            // Do nothing if renaming a new file
            return;
        }

        await item.delete();

        this.fireSoon({ type: FileChangeType.Deleted, item });
    }

    protected async validateImpl(item: EditableFileSystemItem, content: string): Promise<void> {
        return item.validate(content);
    }

    protected getFilePath(item: EditableFileSystemItem): string {
        return item.filePath;
    }

    protected getFileQuery(item: EditableFileSystemItem): ParsedUrlQueryInput {
        return item.getFileQuery();
    }

    public async save(uri: Uri): Promise<boolean> {
        if (uri.scheme === CosmosFileSystem.scheme) {
            const textDoc = await workspace.openTextDocument(uri);
            return textDoc.save();
        }

        return false;
    }

    public async revert(uri: Uri): Promise<void> {
        await callWithTelemetryAndErrorHandling('deleteFile', async (context) => {
            context.telemetry.suppressIfSuccessful = true;

            const item = await this.lookup(uri);
            const activeTextEditor = vscode.window.activeTextEditor;
            if (activeTextEditor?.document.uri === uri) {
                const text = await item.read();
                await writeToEditor(activeTextEditor, text);
            }
        });
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

    public fireChangedEvent(item: EditableFileSystemItem): void {
        item.mTime = Date.now();
        this.fireSoon({ type: FileChangeType.Changed, item: item });
    }

    protected async lookup(uri: Uri): Promise<EditableFileSystemItem> {
        const item = this.findItem(this.getQueryFromUri(uri));
        if (!item) {
            const parsedQuery = this.getQueryFromUri(uri);
            const type = parsedQuery.type as EditableFileSystemItemType;
            switch (type) {
                case 'Document': {
                    const newItem = await DocumentFileDescriptor.fromURI(uri);
                    this.openTextDocument(newItem);
                    return newItem;
                }
                case 'StoredProcedure':
                case 'Trigger':
                default:
                    throw FileSystemError.FileNotFound();
            }
        } else {
            return item;
        }
    }
}
