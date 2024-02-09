/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccountGetResults } from '@azure/arm-cosmosdb/src/models';
import { CosmosClient, DatabaseDefinition, DatabaseResponse, FeedOptions, QueryIterator, Resource } from '@azure/cosmos';
import { AzExtParentTreeItem, AzExtTreeItem, ICreateChildImplContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { IDeleteWizardContext } from '../../commands/deleteDatabaseAccount/IDeleteWizardContext';
import { deleteCosmosDBAccount } from '../../commands/deleteDatabaseAccount/deleteCosmosDBAccount';
import { SERVERLESS_CAPABILITY_NAME, getThemeAgnosticIconPath } from '../../constants';
import { nonNullProp } from '../../utils/nonNull';
import { rejectOnTimeout } from '../../utils/timeout';
import { CosmosDBCredential, CosmosDBKeyCredential, getCosmosClient } from '../getCosmosClient';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';

/**
 * This class provides common logic for DocumentDB, Graph, and Table accounts
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export abstract class DocDBAccountTreeItemBase extends DocDBTreeItemBase<DatabaseDefinition & Resource> {
    public readonly label: string;
    public readonly childTypeLabel: string = "Database";


    constructor(
        parent: AzExtParentTreeItem,
        id: string,
        label: string,
        endpoint: string,
        credentials: CosmosDBCredential[],
        isEmulator: boolean | undefined,
        readonly databaseAccount?: DatabaseAccountGetResults
    ) {
        super(parent);
        this.id = id;
        this.label = label;
        this.root = {
            endpoint,
            credentials,
            isEmulator,
            getCosmosClient: () => getCosmosClient(endpoint, credentials, isEmulator)
        };

        const keys = credentials
            .map((cred) => cred.type === "key" ? cred.key : undefined)
            .filter((value): value is string => value !== undefined);
        this.valuesToMask.push(id, endpoint, ...keys);
    }

    public get connectionString(): string {
        const firstKey = this.root.credentials.filter((cred): cred is CosmosDBKeyCredential => cred.type === "key")[0];
        if (firstKey) {
            return `AccountEndpoint=${this.root.endpoint};AccountKey=${firstKey}`;
        } else {
            return `AccountEndpoint=${this.root.endpoint}`;
        }
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

        const client = this.root.getCosmosClient();
        const database: DatabaseResponse = await client.databases.create({ id: databaseName });
        return this.initChild(nonNullProp(database, 'resource'));
    }

    public async loadMoreChildrenImpl(clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (this.root.isEmulator) {
            const unableToReachEmulatorMessage: string = "Unable to reach emulator. Please ensure it is started and connected to the port specified by the 'cosmosDB.emulator.port' setting, then try again.";
            return await rejectOnTimeout(2000, () => super.loadMoreChildrenImpl(clearCache), unableToReachEmulatorMessage);
        } else {
            return await super.loadMoreChildrenImpl(clearCache);
        }
    }

    public async deleteTreeItemImpl(context: IDeleteWizardContext): Promise<void> {
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
    if (/[/\\?#=]/.test(name)) {
        return `Database name cannot contain the characters '\\', '/', '#', '?', '='`;
    }
    return undefined;
}
