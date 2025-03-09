/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type PartitionKeyDefinition, type Resource } from '@azure/cosmos';
import { parse as parseQuery, type ParsedUrlQuery, type ParsedUrlQueryInput } from 'querystring';
import { FileSystemError, type Uri } from 'vscode';
import { getExperienceFromApi, type API, type Experience } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { extractPartitionKey, generateUniqueId } from '../../utils/document';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { getCosmosClientByConnection } from '../getCosmosClient';
import { type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';
import { ItemService } from '../services/ItemService';
import { validateDocument } from '../utils/validateDocument';
import { CosmosFileSystem, type EditableFileSystemItem } from './CosmosFileSystem';

export class DocumentFileDescriptor implements EditableFileSystemItem {
    public readonly cTime: number = Date.now();
    public readonly type = 'Document';

    public mTime: number = Date.now();
    public isReadOnly: boolean = false;
    public size: number = 0;

    private readonly itemService: ItemService;

    constructor(
        public readonly id: string,
        public readonly experience: Experience,
        private readonly connection: NoSqlQueryConnection,
        private readonly partitionKey?: PartitionKeyDefinition | undefined,
        private item?: ItemDefinition & Resource,
    ) {
        this.itemService = new ItemService(this.connection);
        if (item) {
            this.size = Buffer.byteLength(JSON.stringify(item));
        }
    }

    public static async fromURI(uri: Uri): Promise<DocumentFileDescriptor> {
        const query: ParsedUrlQuery = parseQuery(uri.query);
        const id = query['id'];
        const type = query['type'];
        const api = query['api'];
        const databaseId = query['databaseId'];
        const containerId = query['containerId'];
        const endpoint = query['endpoint'];
        const isEmulator = query['isEmulator'];
        let masterKey = query['masterKey'];
        let tenantId = query['tenantId'];
        let itemId = query['itemId'];
        let partitionKeyValue = query['partitionKeyValue'];

        if (id === undefined || Array.isArray(id) || id === '') {
            throw new Error('The query parameter "id" is required');
        }

        if (api === undefined || Array.isArray(api) || id === '') {
            throw new Error('The query parameter "api" is required');
        }

        if (type === undefined || Array.isArray(type) || type === '') {
            throw new Error('The query parameter "api" is required');
        }

        if (databaseId === undefined || Array.isArray(databaseId) || id === '') {
            throw new Error('The query parameter "databaseId" is required');
        }

        if (containerId === undefined || Array.isArray(containerId) || id === '') {
            throw new Error('The query parameter "containerId" is required');
        }

        if (endpoint === undefined || Array.isArray(endpoint) || id === '') {
            throw new Error('The query parameter "endpoint" is required');
        }

        if (isEmulator === undefined || Array.isArray(isEmulator) || id === '') {
            throw new Error('The query parameter "isEmulator" is required');
        }

        if (Array.isArray(masterKey)) {
            throw new Error('The query parameter "masterKey" should not be an array');
        } else if (masterKey === '') {
            masterKey = undefined;
        }

        if (Array.isArray(tenantId)) {
            throw new Error('The query parameter "tenantId" should not be an array');
        } else if (tenantId === '') {
            tenantId = undefined;
        }

        if (Array.isArray(itemId)) {
            throw new Error('The query parameter "itemId" should not be an array');
        } else if (itemId === '') {
            itemId = undefined;
        }

        if (partitionKeyValue === '') {
            partitionKeyValue = undefined;
        }

        if (type !== 'Document') {
            throw new Error(`Document file descriptor expected type "Document" but received "${type}"`);
        }

        const connection: NoSqlQueryConnection = {
            databaseId,
            containerId,
            endpoint,
            masterKey,
            isEmulator: isEmulator.toLowerCase() === 'true',
            tenantId,
        };

        const cosmosClient = getCosmosClientByConnection(connection);
        const container = await cosmosClient.database(databaseId).container(containerId).read();

        if (!container.resource) {
            throw new Error(`Container with id "${containerId}" not found`);
        }

        const partitionKey = container.resource.partitionKey;

        let item: (ItemDefinition & Resource) | undefined;
        if (itemId) {
            const itemResponse = await cosmosClient
                .database(databaseId)
                .container(containerId)
                .item(itemId, partitionKeyValue)
                .read<ItemDefinition & Resource>();

            if (!itemResponse.resource) {
                throw new Error(
                    `Item with id "${itemId}" ${partitionKeyValue ? `and partition key ${partitionKeyValue}` : ''} not found`,
                );
            }

            item = itemResponse.resource;
        }

        return new DocumentFileDescriptor(id, getExperienceFromApi(api as API), connection, partitionKey, item);
    }

    public get filePath(): string {
        if (this.item) {
            return getDocumentTreeItemLabel(this.item) + '.cosmos-document.json';
        }

        return 'New item.cosmos-document.json';
    }

    public getFileQuery(): ParsedUrlQueryInput {
        return {
            id: this.item
                ? generateUniqueId(this.item, this.partitionKey).replaceAll('+', '').replaceAll('%2B', '')
                : CosmosFileSystem.newFileName,
            api: this.experience.api,
            type: this.type,
            databaseId: this.connection.databaseId,
            containerId: this.connection.containerId,
            endpoint: this.connection.endpoint,
            masterKey: this.connection.masterKey,
            isEmulator: this.connection.isEmulator.toString(),
            tenantId: this.connection.tenantId,
            itemId: this.item?.id ?? CosmosFileSystem.newFileName,
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            partitionKeyValue:
                this.partitionKey && this.item ? extractPartitionKey(this.item, this.partitionKey) : undefined,
            _rid: (this.item?._rid as string) || undefined,
        };
    }

    public async create(data: string): Promise<void> {
        if (this.item) {
            return Promise.reject(FileSystemError.FileExists());
        }

        await this.validate(data);

        this.item = await this.itemService.create(JSON.parse(data) as ItemDefinition);
        if (this.item) {
            this.mTime = Date.now();
            this.size = Buffer.byteLength(JSON.stringify(this.item));
        } else {
            throw new Error('Failed to create the item');
        }
    }

    public async read(readFromServer?: boolean): Promise<string> {
        if (readFromServer) {
            if (!this.item) {
                throw FileSystemError.FileNotFound();
            }

            const itemResponse = await this.itemService.read(this.item);
            if (itemResponse) {
                this.item = itemResponse;
                this.mTime = Date.now();
                this.size = Buffer.byteLength(JSON.stringify(this.item));
            } else {
                throw new Error('Failed to read the item');
            }
        }

        return JSON.stringify(this.item ?? (await this.itemService.generateNewItemTemplate()), null, 2);
    }

    public async update(data: string): Promise<void> {
        if (!this.item) {
            throw FileSystemError.FileNotFound();
        }

        await this.validate(data);

        this.item = await this.itemService.update(JSON.parse(data) as ItemDefinition & Resource);
        if (this.item) {
            this.mTime = Date.now();
            this.size = Buffer.byteLength(JSON.stringify(this.item));
        } else {
            throw new Error('Failed to update the item');
        }
    }

    public async delete(): Promise<void> {
        if (!this.item) {
            throw FileSystemError.FileNotFound();
        }

        if (!this.item['id'] || typeof this.item['id'] !== 'string') {
            throw new Error('The "id" field is required to delete the item');
        }

        await this.itemService.delete(this.item);
    }

    public async validate(data: string): Promise<void> {
        const errors = validateDocument(data, this.partitionKey);

        if (errors.length > 0) {
            ext.outputChannel.appendLog(`Item validation failed`);
            ext.outputChannel.appendLog(errors.join('\n'));
            ext.outputChannel.show();

            throw new Error(errors.join('\n'));
        }
    }
}
