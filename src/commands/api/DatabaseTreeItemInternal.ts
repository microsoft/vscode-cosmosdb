/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type AzExtTreeItem, type IActionContext } from '@microsoft/vscode-azext-utils';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import  { type DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import  { type DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { ext } from '../../extensionVariables';
import  { type MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import  { type MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import  { type ParsedConnectionString } from '../../ParsedConnectionString';
import  { type PostgresDatabaseTreeItem } from '../../postgres/tree/PostgresDatabaseTreeItem';
import  { type PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import  { type DatabaseTreeItem } from '../../vscode-cosmosdb.api';
import { DatabaseAccountTreeItemInternal } from './DatabaseAccountTreeItemInternal';

export class DatabaseTreeItemInternal extends DatabaseAccountTreeItemInternal implements DatabaseTreeItem {
    public databaseName: string;
    private _dbNode: AzExtTreeItem | undefined;

    constructor(
        parsedCS: ParsedConnectionString,
        databaseName: string,
        accountNode?: MongoAccountTreeItem | DocDBAccountTreeItemBase | PostgresServerTreeItem,
        dbNode?: MongoDatabaseTreeItem | DocDBDatabaseTreeItemBase | PostgresDatabaseTreeItem,
    ) {
        super(parsedCS, accountNode);
        this.databaseName = databaseName;
        this._dbNode = dbNode;
    }

    public async reveal(): Promise<void> {
        await callWithTelemetryAndErrorHandling('api.db.reveal', async (context: IActionContext) => {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.rethrow = true;

            const accountNode: MongoAccountTreeItem | DocDBAccountTreeItemBase | PostgresServerTreeItem =
                await this.getAccountNode(context);
            if (!this._dbNode) {
                const databaseId = `${accountNode.fullId}/${this.databaseName}`;
                this._dbNode = await ext.rgApi.workspaceResourceTree.findTreeItem(databaseId, context);
            }

            await ext.rgApi.workspaceResourceTreeView.reveal(this._dbNode || accountNode);
        });
    }
}
