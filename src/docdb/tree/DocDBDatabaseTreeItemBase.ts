/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerDefinition, ContainerResponse, CosmosClient, DatabaseDefinition, FeedOptions, QueryIterator, Resource } from '@azure/cosmos';
import * as vscode from 'vscode';
import { AzureTreeItem, DialogResponses, ICreateChildImplContext, UserCancelledError } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { nonNullProp } from '../../utils/nonNull';
import { DocDBAccountTreeItemBase } from './DocDBAccountTreeItemBase';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import { IDocDBTreeRoot } from './IDocDBTreeRoot';

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
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('DocDatabase.svg');
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
    public async deleteTreeItemImpl(): Promise<void> {
        const message: string = `Are you sure you want to delete database '${this.label}' and its contents?`;
        const result = await ext.ui.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (result === DialogResponses.deleteResponse) {
            const client = this.root.getCosmosClient();
            await client.database(this.id).delete();
        } else {
            throw new UserCancelledError();
        }
    }

    // Create a DB collection
    public async createChildImpl(context: ICreateChildImplContext): Promise<AzureTreeItem<IDocDBTreeRoot>> {
        const containerName = await ext.ui.showInputBox({
            placeHolder: `Enter an id for your ${this.childTypeLabel}`,
            ignoreFocusOut: true,
            validateInput: validateCollectionName
        });

        const containerDefinition: ContainerDefinition = {
            id: containerName
        };

        let partitionKey: string | undefined = await ext.ui.showInputBox({
            prompt: 'Enter the partition key for the collection, or leave blank for fixed size.',
            ignoreFocusOut: true,
            validateInput: validatePartitionKey,
            placeHolder: 'e.g. address/zipCode'
        });

        if (partitionKey && partitionKey.length && partitionKey[0] !== '/') {
            partitionKey = '/' + partitionKey;
        }
        if (!!partitionKey) {
            containerDefinition.partitionKey = {
                paths: [partitionKey]
            };
        }
        const isFixed: boolean = !(containerDefinition.partitionKey);
        const minThroughput = isFixed ? minThroughputFixed : minThroughputPartitioned;
        const throughput: number = Number(await ext.ui.showInputBox({
            value: minThroughput.toString(),
            ignoreFocusOut: true,
            prompt: `Initial throughput capacity, between ${minThroughput} and ${maxThroughput}`,
            validateInput: (input: string) => validateThroughput(isFixed, input)
        }));

        const options = { offerThroughput: throughput };

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
