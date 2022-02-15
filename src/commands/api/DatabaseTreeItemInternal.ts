/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext } from '@microsoft/vscode-azext-utils';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { ext } from '../../extensionVariables';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { ParsedConnectionString } from '../../ParsedConnectionString';
import { PostgresDatabaseTreeItem } from '../../postgres/tree/PostgresDatabaseTreeItem';
import { PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import { DatabaseTreeItem } from '../../vscode-cosmosdb.api';
import { DatabaseAccountTreeItemInternal } from './DatabaseAccountTreeItemInternal';

export class DatabaseTreeItemInternal extends DatabaseAccountTreeItemInternal implements DatabaseTreeItem {
    public databaseName: string;
    private _dbNode: AzExtTreeItem | undefined;

    constructor(parsedCS: ParsedConnectionString, databaseName: string, accountNode?: MongoAccountTreeItem | DocDBAccountTreeItemBase | PostgresServerTreeItem, dbNode?: MongoDatabaseTreeItem | DocDBDatabaseTreeItemBase | PostgresDatabaseTreeItem) {
        super(parsedCS, accountNode);
        this.databaseName = databaseName;
        this._dbNode = dbNode;
    }

    public async reveal(): Promise<void> {
        await callWithTelemetryAndErrorHandling('api.db.reveal', async (context: IActionContext) => {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.rethrow = true;

            const accountNode: MongoAccountTreeItem | DocDBAccountTreeItemBase | PostgresServerTreeItem = await this.getAccountNode(context);
            if (!this._dbNode) {
                const databaseId = `${accountNode.fullId}/${this.databaseName}`;
                this._dbNode = await ext.tree.findTreeItem(databaseId, context);
            }

            await ext.treeView.reveal(this._dbNode || accountNode);
        });
    }
}
