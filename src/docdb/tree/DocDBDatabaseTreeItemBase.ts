/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type ContainerDefinition,
    type ContainerResponse,
    type CosmosClient,
    type DatabaseDefinition,
    type FeedOptions,
    type QueryIterator,
    type RequestOptions,
    type Resource,
} from '@azure/cosmos';
import {
    DialogResponses,
    type AzExtTreeItem,
    type IActionContext,
    type ICreateChildImplContext,
    type TreeItemIconPath,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { nonNullProp } from '../../utils/nonNull';
import { type DocDBAccountTreeItemBase } from './DocDBAccountTreeItemBase';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';

const minThroughputFixed: number = 400;
const minThroughputPartitioned: number = 400;
const maxThroughput: number = 100000;
const throughputStepSize = 100;

/**
 * This class provides common logic for DocumentDB, Graph, and Table databases
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export abstract class DocDBDatabaseTreeItemBase extends DocDBTreeItemBase<ContainerDefinition & Resource> {
    public declare readonly parent: DocDBAccountTreeItemBase;
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
        await context.ui.showWarningMessage(
            message,
            { modal: true, stepName: 'deleteDatabase' },
            DialogResponses.deleteResponse,
        );
        const client = this.root.getCosmosClient();
        await client.database(this.id).delete();
    }

    // Create a DB collection
    public async createChildImpl(context: ICreateChildImplContext): Promise<AzExtTreeItem> {
        const containerName = await context.ui.showInputBox({
            placeHolder: `Enter an id for your ${this.childTypeLabel}`,
            validateInput: this.validateCollectionName.bind(this) as (name: string) => string | undefined | null,
            stepName: `create${this.childTypeLabel}`,
        });

        const containerDefinition: ContainerDefinition = {
            id: containerName,
        };

        const partitionKey = await this.getNewPartitionKey(context);
        if (partitionKey) {
            containerDefinition.partitionKey = {
                paths: [partitionKey],
            };
        }
        const options: RequestOptions = {};

        if (!this.parent.isServerless) {
            const isFixed: boolean = !containerDefinition.partitionKey;
            const minThroughput = isFixed ? minThroughputFixed : minThroughputPartitioned;
            const throughput: number = Number(
                await context.ui.showInputBox({
                    value: minThroughput.toString(),
                    prompt: `Initial throughput capacity, between ${minThroughput} and ${maxThroughput} inclusive in increments of ${throughputStepSize}. Enter 0 if the account doesn't support throughput.`,
                    stepName: 'throughputCapacity',
                    validateInput: (input: string) => validateThroughput(isFixed, input),
                }),
            );

            if (throughput !== 0) {
                options.offerThroughput = throughput;
            }
        }

        context.showCreatingTreeItem(containerName);
        const client = this.root.getCosmosClient();
        const container: ContainerResponse = await client
            .database(this.id)
            .containers.create(containerDefinition, options);

        return this.initChild(nonNullProp(container, 'resource'));
    }

    protected async getNewPartitionKey(context: IActionContext): Promise<string | undefined> {
        let partitionKey: string | undefined = await context.ui.showInputBox({
            prompt: 'Enter the partition key for the collection, or leave blank for fixed size.',
            stepName: 'partitionKeyForCollection',
            validateInput: this.validatePartitionKey,
            placeHolder: 'e.g. /address/zipCode',
        });

        if (partitionKey && partitionKey.length && partitionKey[0] !== '/') {
            partitionKey = '/' + partitionKey;
        }

        return partitionKey;
    }

    protected validatePartitionKey(key: string): string | undefined {
        if (/[#?\\]/.test(key)) {
            return 'Cannot contain these characters: ?,#,\\, etc.';
        }
        return undefined;
    }

    protected validateCollectionName(name: string): string | undefined | null {
        if (!name) {
            return `${this.childTypeLabel} name cannot be empty`;
        }
        if (name.endsWith(' ')) {
            return `${this.childTypeLabel} name cannot end with space`;
        }
        if (/[/\\?#]/.test(name)) {
            return `${this.childTypeLabel} name cannot contain the characters '\\', '/', '#', '?'`;
        }
        return undefined;
    }
}

function validateThroughput(isFixed: boolean, input: string): string | undefined | null {
    if (input === '0') {
        return undefined;
    }

    try {
        const minThroughput = isFixed ? minThroughputFixed : minThroughputPartitioned;
        const value = Number(input);
        if (value < minThroughput || value > maxThroughput || (value - minThroughput) % throughputStepSize !== 0) {
            return `Value must be between ${minThroughput} and ${maxThroughput} in increments of ${throughputStepSize}`;
        }
    } catch {
        return 'Input must be a number';
    }
    return undefined;
}
