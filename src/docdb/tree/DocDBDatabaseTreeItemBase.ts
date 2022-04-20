/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerDefinition, ContainerResponse, CosmosClient, DatabaseDefinition, FeedOptions, QueryIterator, RequestOptions, Resource } from '@azure/cosmos';
import { AzExtTreeItem, DialogResponses, IActionContext, ICreateChildImplContext, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { nonNullProp } from '../../utils/nonNull';
import { DocDBAccountTreeItemBase } from './DocDBAccountTreeItemBase';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';

const minThroughputFixed: number = 400;
const minThroughputPartitioned: number = 400;
const maxThroughput: number = 100000;

/**
 * This class provides common logic for DocumentDB, Graph, and Table databases
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export abstract class DocDBDatabaseTreeItemBase extends DocDBTreeItemBase<ContainerDefinition & Resource> {
    public readonly parent: DocDBAccountTreeItemBase;
    private readonly _database: DatabaseDefinition & Resource;

    constructor(parent: DocDBAccountTreeItemBase, database: DatabaseDefinition & Resource) {
        super(parent);
        this._database = database;
        this.root = this.parent.root;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('database');
    }

    public get id(): string {
        return nonNullProp(this._database, 'id');
    }

    public get label(): string {
        return nonNullProp(this._database, 'id');
    }

    public get link(): string {
        return nonNullProp(this._database, '_self');
    }

    public get connectionString(): string {
        return this.parent.connectionString.concat(`;Database=${this.id}`);
    }

    public get databaseName(): string {
        return this._database.id;
    }

    public getIterator(client: CosmosClient, feedOptions: FeedOptions): QueryIterator<ContainerDefinition & Resource> {
        return client.database(this._database.id).containers.readAll(feedOptions);
    }

    // Delete the database
    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const message: string = `Are you sure you want to delete database '${this.label}' and its contents?`;
        await context.ui.showWarningMessage(message, { modal: true, stepName: 'deleteDatabase' }, DialogResponses.deleteResponse);
        const client = this.root.getCosmosClient();
        await client.database(this.id).delete();
    }

    // Create a DB collection
    public async createChildImpl(context: ICreateChildImplContext): Promise<AzExtTreeItem> {
        const containerName = await context.ui.showInputBox({
            placeHolder: `Enter an id for your ${this.childTypeLabel}`,
            validateInput: validateCollectionName,
            stepName: `create${this.childTypeLabel}`
        });

        const containerDefinition: ContainerDefinition = {
            id: containerName
        };

        let partitionKey: string | undefined = await context.ui.showInputBox({
            prompt: 'Enter the partition key for the collection, or leave blank for fixed size.',
            stepName: 'partitionKeyForCollection',
            validateInput: validatePartitionKey,
            placeHolder: 'e.g. address/zipCode'
        });

        if (partitionKey && partitionKey.length && partitionKey[0] !== '/') {
            partitionKey = '/' + partitionKey;
        }
        if (partitionKey) {
            containerDefinition.partitionKey = {
                paths: [partitionKey]
            };
        }
        const options: RequestOptions = {};

        if (!this.parent.isServerless) {
            const isFixed: boolean = !(containerDefinition.partitionKey);
            const minThroughput = isFixed ? minThroughputFixed : minThroughputPartitioned;
            const throughput: number = Number(await context.ui.showInputBox({
                value: minThroughput.toString(),
                prompt: `Initial throughput capacity, between ${minThroughput} and ${maxThroughput}`,
                stepName: 'throughputCapacity',
                validateInput: (input: string) => validateThroughput(isFixed, input)
            }));

            options.offerThroughput = throughput;
        }

        context.showCreatingTreeItem(containerName);
        const client = this.root.getCosmosClient();
        const container: ContainerResponse = await client.database(this.id).containers.create(containerDefinition, options);

        return this.initChild(nonNullProp(container, 'resource'));
    }
}

function validatePartitionKey(key: string): string | undefined | null {
    if (/[#?\\]/.test(key)) {
        return "Cannot contain these characters: ?,#,\\, etc.";
    }
    return undefined;
}

function validateThroughput(isFixed: boolean, input: string): string | undefined | null {
    try {
        const minThroughput = isFixed ? minThroughputFixed : minThroughputPartitioned;
        const value = Number(input);
        if (value < minThroughput || value > maxThroughput) {
            return `Value must be between ${minThroughput} and ${maxThroughput}`;
        }
    } catch (err) {
        return "Input must be a number";
    }
    return undefined;
}

function validateCollectionName(name: string): string | undefined | null {
    if (!name) {
        return "Collection name cannot be empty";
    }
    if (name.endsWith(" ")) {
        return "Collection name cannot end with space";
    }
    if (/[/\\?#]/.test(name)) {
        return `Collection name cannot contain the characters '\\', '/', '#', '?'`;
    }
    return undefined;
}
