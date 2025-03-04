/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    type AzExtItemChangeEvent,
    type AzExtItemQuery,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import {
    parse as parseQuery,
    stringify as stringifyQuery,
    type ParsedUrlQuery,
    type ParsedUrlQueryInput,
} from 'querystring';
import vscode, {
    Disposable,
    EventEmitter,
    FileSystemError,
    FileType,
    l10n,
    Uri,
    window,
    type Event,
    type FileChangeEvent,
    type FileStat,
    type FileSystemProvider,
    type TextDocumentShowOptions,
} from 'vscode';
import { nonNullProp } from './utils/nonNull';

const unsupportedError: Error = new Error(l10n.t('This operation is not supported.'));

export interface TreeFileSystemItem {
    /**
     * Warning: the identifier cannot contain plus sign '+'. No matter if it's exactly '+' or if it's URL encoded "%2B".
     */
    id: string;
    refresh?(context: IActionContext): Promise<void>;
}

export abstract class AzureDBFileSystemProvider<TItem extends TreeFileSystemItem>
    implements FileSystemProvider, Disposable
{
    private readonly itemCache: Map<string, TItem> = new Map<string, TItem>();

    public abstract scheme: string;

    private readonly disposables: Disposable[] = [];
    private readonly _emitter: EventEmitter<FileChangeEvent[]> = new EventEmitter<FileChangeEvent[]>();
    private readonly _bufferedEvents: FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timeout;

    constructor() {
        const closeSub = vscode.workspace.onDidCloseTextDocument((e) => {
            if (e.uri.scheme === this.scheme) {
                const query = this.getQueryFromUri(e.uri);
                const item = this.findItem(query);
                if (item) {
                    this.itemCache.delete(query.id);
                }
            }
        });

        this.disposables.push(closeSub);
    }

    public dispose(): void {
        this._emitter.dispose();
        this.disposables.forEach((d) => void d.dispose());
        this.itemCache.clear();
    }

    public get onDidChangeFile(): Event<FileChangeEvent[]> {
        return this._emitter.event;
    }

    protected abstract validateImpl(item: TItem, content: string): Promise<void>;
    protected abstract statImpl(item: TItem, originalUri: Uri): Promise<FileStat>;
    protected abstract readFileImpl(item: TItem, originalUri: Uri): Promise<string>;
    protected abstract writeFileImpl(item: TItem, content: string, originalUri: Uri): Promise<void>;
    protected abstract deleteFileImpl(item: TItem, originalUri: Uri): Promise<void>;
    protected abstract getFilePath(item: TItem): string;
    protected abstract getFileQuery(item: TItem): ParsedUrlQueryInput;

    public async showTextDocument(item: TItem, options?: TextDocumentShowOptions): Promise<void> {
        const document = await this.openTextDocument(item);
        await window.showTextDocument(document, options);
        //await vscode.commands.executeCommand('vscode.open', uri);
    }

    public openTextDocument(item: TItem): Thenable<vscode.TextDocument> {
        const uri = this.getUriFromItem(item);
        const query = this.getQueryFromUri(uri);
        this.itemCache.set(query.id, item);

        return vscode.workspace.openTextDocument(uri);
    }

    public watch(): Disposable {
        return new Disposable((): void => {
            // Since we're not actually watching "in Azure" (i.e. polling for changes),
            // there's no need to selectively watch based on the Uri passed in here. Thus, there's nothing to dispose
        });
    }

    public async stat(uri: Uri): Promise<FileStat> {
        return (
            (await callWithTelemetryAndErrorHandling('stat', async (context) => {
                context.telemetry.suppressIfSuccessful = true;
                context.telemetry.eventVersion = 2;
                context.errorHandling.rethrow = true;

                const item = this.findItem(this.getQueryFromUri(uri));
                if (item) {
                    return await this.statImpl(item, uri);
                }

                return { type: FileType.Unknown, ctime: 0, mtime: 0, size: 0 };
            })) || { type: FileType.Unknown, ctime: 0, mtime: 0, size: 0 }
        );
    }

    public async readFile(uri: Uri): Promise<Uint8Array> {
        return (
            (await callWithTelemetryAndErrorHandling('readFile', async (context) => {
                context.telemetry.suppressIfSuccessful = true;
                context.telemetry.eventVersion = 2;
                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = true;

                const item = await this.lookup(uri);
                const content = await this.readFileImpl(item, uri);
                return Buffer.from(content);
            })) || Buffer.from('')
        );
    }

    public async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
        await callWithTelemetryAndErrorHandling('writeFile', async (context) => {
            context.telemetry.suppressIfSuccessful = true;
            context.telemetry.eventVersion = 2;
            context.errorHandling.rethrow = true;

            const item = await this.lookup(uri);
            await this.writeFileImpl(item, content.toString(), uri);
            await item.refresh?.(context);
        });
    }

    public async readDirectory(_uri: Uri): Promise<[string, FileType][]> {
        throw unsupportedError;
    }

    public async createDirectory(_uri: Uri): Promise<void> {
        throw unsupportedError;
    }

    public async delete(uri: Uri): Promise<void> {
        await callWithTelemetryAndErrorHandling('deleteFile', async (context) => {
            context.telemetry.suppressIfSuccessful = true;
            context.telemetry.eventVersion = 2;
            context.errorHandling.rethrow = true;

            const item = await this.lookup(uri);
            await this.deleteFileImpl(item, uri);
            this.itemCache.delete(this.getQueryFromUri(uri).id);
        });
    }

    public async rename(oldUri: Uri, newUri: Uri, _options: { readonly overwrite: boolean }): Promise<void> {
        await callWithTelemetryAndErrorHandling('renameFile', async (context) => {
            context.telemetry.suppressIfSuccessful = true;
            context.telemetry.eventVersion = 2;
            context.errorHandling.rethrow = true;

            const oldItem = this.itemCache.get(this.getQueryFromUri(oldUri).id);
            const newItem = this.itemCache.get(this.getQueryFromUri(newUri).id);

            if (!oldItem) {
                throw FileSystemError.FileNotFound(oldUri);
            }

            if (newItem) {
                // Ignore overwrite option and throw error if newItem already exists
                throw FileSystemError.FileExists(newUri);
            }

            this.itemCache.delete(this.getQueryFromUri(oldUri).id);
            this.itemCache.set(this.getQueryFromUri(newUri).id, oldItem);
        });
    }

    /**
     * Uses a simple buffer to group events that occur within a few milliseconds of each other
     * Adapted from https://github.com/microsoft/vscode-extension-samples/blob/master/fsprovider-sample/src/fileSystemProvider.ts
     */
    protected fireSoon(...events: AzExtItemChangeEvent<TItem>[]): void {
        this._bufferedEvents.push(
            ...events.map((e) => {
                return {
                    type: e.type,
                    uri: this.getUriFromItem(e.item),
                };
            }),
        );

        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }

        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents.length = 0; // clear buffer
        }, 5);
    }

    protected findItem(query: AzExtItemQuery): TItem | undefined {
        return this.itemCache.get(query.id);
    }

    protected getUriFromItem(item: TItem): Uri {
        const query: string = stringifyQuery(this.getFileQuery(item));
        const filePath: string = encodeURIComponent(this.getFilePath(item));
        return Uri.parse(`${this.scheme}:///${filePath}/?${query}`);
    }

    protected async lookup(uri: Uri): Promise<TItem> {
        const item = this.findItem(this.getQueryFromUri(uri));
        if (!item) {
            throw FileSystemError.FileNotFound();
        } else {
            return item;
        }
    }

    protected getQueryFromUri(uri: Uri): AzExtItemQuery {
        const query: ParsedUrlQuery = parseQuery(uri.query);
        const id: string | string[] = nonNullProp(query, 'id');
        if (typeof id === 'string') {
            return Object.assign(query, { id }); // Not technically necessary to use `Object.assign`, but it's better than casting which would lose type validation
        } else {
            throw new Error('Internal Error: Expected "id" to be type string.');
        }
    }
}
