/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    DialogResponses,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { parse as parseQuery, stringify as stringifyQuery, type ParsedUrlQuery } from 'querystring';
import * as vscode from 'vscode';
import {
    type Disposable,
    type Event,
    type FileChangeEvent,
    type FileChangeType,
    type FileStat,
    type FileSystemProvider,
    type MessageItem,
    type TextDocumentShowOptions,
    type Uri,
} from 'vscode';
import { ext } from './extensionVariables';
import { SettingsService } from './services/SettingsService';
import { nonNullProp } from './utils/nonNull';
import { getNodeEditorLabel } from './utils/vscodeUtils';

const unsupportedError: Error = new Error(l10n.t('This operation is not supported.'));

export interface EditableFileSystemItem {
    id: string;
    filePath: string;
    cTime: number;
    mTime: number;
    getFileContent(context: IActionContext): Promise<string>;
    writeFileContent(context: IActionContext, data: string): Promise<void>;
    refresh?(context: IActionContext): Promise<void>;
}

export class DatabasesFileSystem implements FileSystemProvider {
    public static scheme: string = 'azureDatabases';
    public scheme: string = DatabasesFileSystem.scheme;

    private showSaveConfirmation: boolean = true;
    private readonly itemCache = new Map<string, EditableFileSystemItem>();
    private readonly eventEmitter = new vscode.EventEmitter<FileChangeEvent[]>();
    private readonly bufferedEvents: FileChangeEvent[] = [];
    private fireSoonHandle?: NodeJS.Timeout;

    // region FileSystemProvider Members
    public get onDidChangeFile(): Event<FileChangeEvent[]> {
        return this.eventEmitter.event;
    }

    public watch(): Disposable {
        return new vscode.Disposable((): void => {
            // Since we're not actually watching "in Azure" (i.e. polling for changes), there's no need to selectively watch based on the UriUri passed in here. Thus, there's nothing to dispose
        });
    }

    public async stat(uri: Uri): Promise<FileStat> {
        return (
            (await callWithTelemetryAndErrorHandling('stat', async (context) => {
                context.telemetry.suppressIfSuccessful = true;

                const item = this.lookup(context, uri);
                const size = Buffer.byteLength(await item.getFileContent(context));
                return { type: vscode.FileType.File, ctime: item.cTime, mtime: item.mTime, size };
            })) || { type: vscode.FileType.Unknown, ctime: 0, mtime: 0, size: 0 }
        );
    }

    public readDirectory(): never {
        throw unsupportedError;
    }

    public createDirectory(): never {
        throw unsupportedError;
    }

    public async readFile(uri: Uri): Promise<Uint8Array> {
        return (
            (await callWithTelemetryAndErrorHandling('readFile', async (context) => {
                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = true;
                context.telemetry.eventVersion = 2;

                const item = this.lookup(context, uri);
                return Buffer.from(await item.getFileContent(context));
            })) || Buffer.from('')
        );
    }

    public async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
        await callWithTelemetryAndErrorHandling('writeFile', async (context) => {
            const item = this.lookup(context, uri);

            const showSavePromptKey: string = 'showSavePrompt';
            // NOTE: Using "cosmosDB" instead of "azureDatabases" here for the sake of backwards compatibility. If/when this file system adds support for non-cosmosdb items, we should consider changing this to "azureDatabases"
            const prefix: string = 'cosmosDB';
            const nodeEditorLabel: string = getNodeEditorLabel(item);
            if (this.showSaveConfirmation && SettingsService.getSetting<boolean>(showSavePromptKey, prefix)) {
                const message: string = l10n.t('Saving "{path}" will update the entity "{name}" to the cloud.', {
                    path: item.filePath,
                    name: nodeEditorLabel,
                });
                const result: MessageItem | undefined = await context.ui.showWarningMessage(
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

            await item.writeFileContent(context, content.toString());

            this.fireChangedEvent(item);
            await vscode.commands.executeCommand('azureDatabases.refresh', item);

            const updatedMessage: string = l10n.t('Updated entity "{name}".', { name: nodeEditorLabel });
            ext.outputChannel.appendLog(updatedMessage);

            await item.refresh?.(context);
        });
    }

    public delete(): never {
        throw unsupportedError;
    }

    public rename(): never {
        throw unsupportedError;
    }
    // endregion

    // region Public Methods
    public async updateWithoutPrompt(uri: Uri): Promise<void> {
        const textDoc = await vscode.workspace.openTextDocument(uri);
        this.showSaveConfirmation = false;
        try {
            await textDoc.save();
        } finally {
            this.showSaveConfirmation = true;
        }
    }

    public async showTextDocument(item: EditableFileSystemItem, options?: TextDocumentShowOptions): Promise<void> {
        const uri = this.getUriFromItem(item);
        this.itemCache.set(item.id, item);
        await vscode.window.showTextDocument(uri, options);
    }
    // endregion

    private fireChangedEvent(item: EditableFileSystemItem): void {
        item.mTime = Date.now();
        this.fireSoon({ type: vscode.FileChangeType.Changed, item });
    }

    /**
     * Uses a simple buffer to group events that occur within a few milliseconds of each other
     * Adapted from https://github.com/microsoft/vscode-extension-samples/blob/master/fsprovider-sample/src/fileSystemProvider.ts
     */
    private fireSoon(...events: { type: FileChangeType; item: EditableFileSystemItem }[]): void {
        this.bufferedEvents.push(
            ...events.map((e) => {
                return {
                    type: e.type,
                    uri: this.getUriFromItem(e.item),
                };
            }),
        );

        if (this.fireSoonHandle) {
            clearTimeout(this.fireSoonHandle);
        }

        this.fireSoonHandle = setTimeout(() => {
            this.eventEmitter.fire(this.bufferedEvents);
            this.bufferedEvents.length = 0; // clear buffer
        }, 5);
    }

    private getUriFromItem(item: EditableFileSystemItem): Uri {
        const query: string = stringifyQuery({ id: item.id });
        const filePath: string = encodeURIComponent(item.filePath);
        return vscode.Uri.parse(`${this.scheme}:///${filePath}?${query}`);
    }

    private lookup(context: IActionContext, uri: Uri): EditableFileSystemItem | never {
        const item = this.itemCache.get(this.getQueryFromUri(uri).id);
        if (!item) {
            context.telemetry.suppressAll = true;
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;
            throw vscode.FileSystemError.FileNotFound(uri);
        } else {
            return item;
        }
    }

    private getQueryFromUri(uri: Uri): { id: string; [key: string]: string | string[] | undefined } {
        const query: ParsedUrlQuery = parseQuery(uri.query);
        const id: string | string[] = nonNullProp(query, 'id');
        if (typeof id === 'string') {
            return Object.assign(query, { id }); // Not technically necessary to use `Object.assign`, but it's better than casting which would lose type validation
        } else {
            throw new Error('Internal Error: Expected "id" to be type string.');
        }
    }
}
