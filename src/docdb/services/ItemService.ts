/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AbortError,
    ErrorResponse,
    TimeoutError,
    type CosmosClient,
    type ItemDefinition,
    type JSONObject,
    type PartitionKey,
    type PartitionKeyDefinition,
    type Resource,
} from '@azure/cosmos';
import { parseError } from '@microsoft/vscode-azext-utils';
import vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { extractPartitionKey } from '../../utils/document';
import { localize } from '../../utils/localize';
import { type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';
import { getCosmosClientByConnection } from '../getCosmosClient';

export class ItemService implements vscode.Disposable {
    private readonly client: CosmosClient;
    private readonly databaseId: string;
    private readonly containerId: string;

    private abortControllers: WeakSet<AbortController> = new WeakSet();
    private partitionKey: PartitionKeyDefinition | undefined;
    private isDisposed = false;

    constructor(public readonly connection: NoSqlQueryConnection) {
        const { databaseId, containerId } = connection;

        this.client = getCosmosClientByConnection(connection);
        this.databaseId = databaseId;
        this.containerId = containerId;
    }

    public async create(
        item: ItemDefinition,
        abortController?: AbortController,
    ): Promise<(ItemDefinition & Resource) | undefined> {
        if (this.isDisposed) {
            throw new Error('Session is disposed');
        }

        abortController ??= new AbortController();

        this.abortControllers.add(abortController);

        try {
            const result = await this.client
                .database(this.databaseId)
                .container(this.containerId)
                .items.create<ItemDefinition>(item, {
                    abortSignal: abortController.signal,
                });

            return result.resource;
        } catch (error) {
            await this.errorHandling(error);
        } finally {
            this.abortControllers.delete(abortController);
        }

        return undefined;
    }

    public async read(
        item: ItemDefinition & Resource,
        abortController?: AbortController,
    ): Promise<(ItemDefinition & Resource) | undefined>;
    public async read(
        itemId: string,
        partitionKeyValue?: PartitionKey,
        resourceId?: string, // _rid
        abortController?: AbortController,
    ): Promise<(ItemDefinition & Resource) | undefined>;
    public async read(
        arg1: (ItemDefinition & Resource) | string,
        arg2?: PartitionKey | AbortController,
        arg3?: string,
        arg4?: AbortController,
    ): Promise<(ItemDefinition & Resource) | undefined> {
        if (this.isDisposed) {
            throw new Error('Session is disposed');
        }

        let itemId: string | undefined;
        let resourceId: string | undefined;
        let partitionKeyValue: PartitionKey | undefined;
        let abortController: AbortController | undefined;

        if (typeof arg1 === 'object') {
            itemId = arg1.id;
            resourceId = arg1._rid;
            const partitionKey = await this.getPartitionKey();
            partitionKeyValue = partitionKey ? extractPartitionKey(arg1, partitionKey) : undefined;
            abortController = arg2 as AbortController;
        } else {
            itemId = arg1 as string;
            partitionKeyValue = arg2 as PartitionKey;
            resourceId = arg3;
            abortController = arg4;
        }

        abortController ??= new AbortController();

        this.abortControllers.add(abortController);

        try {
            const response = await this.client
                .database(this.databaseId)
                .container(this.containerId)
                .item(itemId, partitionKeyValue)
                .read<ItemDefinition & Resource>({
                    abortSignal: abortController.signal,
                });

            if (response?.resource) {
                return response.resource;
            }

            // TODO: Should we try to read the document by _rid if the above fails?
            if (resourceId) {
                const queryResult = await this.client
                    .database(this.databaseId)
                    .container(this.containerId)
                    .items.query<ItemDefinition & Resource>(`SELECT * FROM c WHERE c._rid = "${resourceId}"`, {
                        abortSignal: abortController.signal,
                        bufferItems: true,
                    })
                    .fetchAll();

                if (queryResult.resources?.length === 1) {
                    return queryResult.resources[0];
                }
            }
        } catch (error) {
            await this.errorHandling(error);
        } finally {
            this.abortControllers.delete(abortController);
        }

        return undefined;
    }

    public async update(
        item: ItemDefinition & Resource,
        partitionKeyValue?: PartitionKey,
        abortController?: AbortController,
    ): Promise<(ItemDefinition & Resource) | undefined> {
        if (this.isDisposed) {
            throw new Error('Session is disposed');
        }

        if (!partitionKeyValue) {
            const partitionKey = await this.getPartitionKey();
            partitionKeyValue = partitionKey ? extractPartitionKey(item, partitionKey) : undefined;
        }

        abortController ??= new AbortController();

        this.abortControllers.add(abortController);

        try {
            const response = await this.client
                .database(this.databaseId)
                .container(this.containerId)
                .item(item.id, partitionKeyValue)
                .replace<ItemDefinition & Resource>(item, {
                    abortSignal: abortController.signal,
                });

            return response.resource;
        } catch (error) {
            await this.errorHandling(error);
        } finally {
            this.abortControllers.delete(abortController);
        }

        return undefined;
    }

    public async delete(item: ItemDefinition & Resource, abortController?: AbortController): Promise<boolean>;
    public async delete(
        itemId: string,
        partitionKeyValue?: PartitionKey,
        abortController?: AbortController,
    ): Promise<boolean>;
    public async delete(
        arg1: (ItemDefinition & Resource) | string,
        arg2?: PartitionKey | AbortController,
        arg3?: AbortController,
    ): Promise<boolean> {
        if (this.isDisposed) {
            throw new Error('Session is disposed');
        }

        let itemId: string | undefined;
        let partitionKeyValue: PartitionKey | undefined;
        let abortController: AbortController | undefined;

        if (typeof arg1 === 'string') {
            itemId = arg1;
            partitionKeyValue = arg2 as PartitionKey;
            abortController = arg3;
        } else {
            const partitionKey = await this.getPartitionKey();
            itemId = arg1.id;
            partitionKeyValue = partitionKey ? extractPartitionKey(arg1, partitionKey) : undefined;
            abortController = arg2 as AbortController;
        }

        abortController ??= new AbortController();

        this.abortControllers.add(abortController);

        try {
            const result = await this.client
                .database(this.databaseId)
                .container(this.containerId)
                .item(itemId, partitionKeyValue)
                .delete({
                    abortSignal: abortController.signal,
                });

            if (result?.statusCode === 204) {
                return true;
            }
        } catch (error) {
            await this.errorHandling(error);
        } finally {
            this.abortControllers.delete(abortController);
        }

        return false;
    }

    public async generateNewItemTemplate(): Promise<JSONObject> {
        if (this.isDisposed) {
            throw new Error('Session is disposed');
        }

        const partitionKey = await this.getPartitionKey();
        const newItem: JSONObject = {
            id: 'replace_with_new_item_id',
        };

        partitionKey?.paths.forEach((partitionKeyProperty) => {
            let target = newItem;
            const keySegments = partitionKeyProperty.split('/').filter((segment) => segment.length > 0);
            const finalSegment = keySegments.pop();

            if (!finalSegment) {
                return;
            }

            // Initialize nested objects as needed
            keySegments.forEach((segment) => {
                target[segment] ??= {};
                target = target[segment] as JSONObject;
            });

            target[finalSegment] = 'replace_with_new_partition_key_value';
        });

        return newItem;
    }

    public async getPartitionKey(): Promise<PartitionKeyDefinition | undefined> {
        if (this.partitionKey) {
            return this.partitionKey;
        }

        const container = await this.client.database(this.databaseId).container(this.containerId).read();

        this.partitionKey = container.resource?.partitionKey;

        return this.partitionKey;
    }

    public dispose(): void {
        this.isDisposed = true;
        Set.prototype.forEach.call(this.abortControllers, (abortController: AbortController) => {
            if (abortController.signal.aborted) {
                return;
            }
            abortController.abort();
        });
    }

    private async errorHandling(error: unknown): Promise<void> {
        const isObject = error && typeof error === 'object';
        if (error instanceof ErrorResponse) {
            await this.logAndThrowError('Query failed', error);
        } else if (error instanceof TimeoutError) {
            await this.logAndThrowError('Query timed out', error);
        } else if (error instanceof AbortError || (isObject && 'name' in error && error.name === 'AbortError')) {
            await this.logAndThrowError('Query was aborted', error);
        } else {
            await this.logAndThrowError('Unknown error', error);
        }
    }

    // Should always throw an error
    private async logAndThrowError(message: string, error: unknown): Promise<never> | never {
        // TODO: parseError does not handle "Message : {JSON}" format coming from Cosmos DB SDK
        //  we need to parse the error message and show it in a better way in the UI
        const parsedError = parseError(error);
        ext.outputChannel.error(`${message}: ${parsedError.message}`);

        if (parsedError.message) {
            message = `${message}\n${parsedError.message}`;
        }

        if (error instanceof ErrorResponse && error.message.indexOf('ActivityId:') === 0) {
            message = `${message}\nActivityId: ${error.ActivityId}`;
        }

        const showLogButton = localize('goToOutput', 'Go to output');
        if (await vscode.window.showErrorMessage(message, showLogButton)) {
            ext.outputChannel.show();
        }
        throw new Error(`${message}, ${parsedError.message}`);
    }
}
