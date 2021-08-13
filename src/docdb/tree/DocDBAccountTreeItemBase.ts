/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccountGetResults } from '@azure/arm-cosmosdb/src/models';
import { CosmosClient, DatabaseDefinition, DatabaseResponse, FeedOptions, QueryIterator, Resource } from '@azure/cosmos';
import * as vscode from 'vscode';
import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, ICreateChildImplContext } from 'vscode-azureextensionui';
import { deleteCosmosDBAccount } from '../../commands/deleteCosmosDBAccount';
import { getThemeAgnosticIconPath, SERVERLESS_CAPABILITY_NAME } from '../../constants';
import { nonNullProp } from '../../utils/nonNull';
import { rejectOnTimeout } from '../../utils/timeout';
import { getCosmosClient } from '../getCosmosClient';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import { IDocDBTreeRoot } from './IDocDBTreeRoot';

/**
 * This class provides common logic for DocumentDB, Graph, and Table accounts
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export abstract class DocDBAccountTreeItemBase extends DocDBTreeItemBase<DatabaseDefinition & Resource> {
    public readonly id: string;
    public readonly label: string;
    public readonly childTypeLabel: string = "Database";

    private _root: IDocDBTreeRoot;

    constructor(parent: AzExtParentTreeItem, id: string, label: string, endpoint: string, masterKey: string, isEmulator: boolean | undefined, readonly databaseAccount?: DatabaseAccountGetResults) {
        super(parent);
        this.id = id;
        this.label = label;
        this._root = {
            endpoint,
            masterKey,
            isEmulator,
            getCosmosClient: () => getCosmosClient(endpoint, masterKey, isEmulator)
        };
        this.valuesToMask.push(id, endpoint, masterKey);
    }

    public get root(): IDocDBTreeRoot {
        return this._root;
    }

    public get connectionString(): string {
        return `AccountEndpoint=${this.root.endpoint};AccountKey=${this.root.masterKey}`;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('CosmosDBAccount.svg');
    }

    public get isServerless(): boolean {
        return this.databaseAccount?.capabilities ? this.databaseAccount.capabilities.some(cap => cap.name === SERVERLESS_CAPABILITY_NAME) : false;

    }

    public getIterator(client: CosmosClient, feedOptions: FeedOptions): QueryIterator<DatabaseDefinition & Resource> {
        return client.databases.readAll(feedOptions);
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<AzExtTreeItem> {
        const databaseName = await context.ui.showInputBox({
            placeHolder: 'Database Name',
            validateInput: validateDatabaseName,
            stepName: 'createDatabase'
        });

        context.showCreatingTreeItem(databaseName);
        const client = this.root.getCosmosClient();
        const database: DatabaseResponse = await client.databases.create({ id: databaseName });
        return this.initChild(nonNullProp(database, 'resource'));
    }

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (this._root.isEmulator) {
            const unableToReachEmulatorMessage: string = "Unable to reach emulator. Please ensure it is started and connected to the port specified by the 'cosmosDB.emulator.port' setting, then try again.";
            return await rejectOnTimeout(2000, () => super.loadMoreChildrenImpl(clearCache), unableToReachEmulatorMessage);
        } else {
            return await super.loadMoreChildrenImpl(clearCache);
        }
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        await deleteCosmosDBAccount(context, this);
    }
}

function validateDatabaseName(name: string): string | undefined | null {
    if (!name || name.length < 1 || name.length > 255) {
        return "Name has to be between 1 and 255 chars long";
    }
    if (name.endsWith(" ")) {
        return "Database name cannot end with space";
    }
    if (/[/\\?#]/.test(name)) {
        return `Database name cannot contain the characters '\\', '/', '#', '?'`;
    }
    return undefined;
}
