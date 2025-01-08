/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type PickAppResourceOptions } from '@microsoft/vscode-azext-utils/hostapi';
import { databaseAccountType } from '../../constants';
import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { DocDBDatabaseTreeItem } from '../../docdb/tree/DocDBDatabaseTreeItem';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { ext } from '../../extensionVariables';
import { GraphDatabaseTreeItem } from '../../graph/tree/GraphDatabaseTreeItem';
import { type MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { type ParsedConnectionString } from '../../ParsedConnectionString';
import { PostgresDatabaseTreeItem } from '../../postgres/tree/PostgresDatabaseTreeItem';
import { PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import { localize } from '../../utils/localize';
import {
    type AzureDatabasesApiType,
    type DatabaseAccountTreeItem,
    type DatabaseTreeItem,
    type PickTreeItemOptions,
} from '../../vscode-cosmosdb.api';
import { cacheTreeItem } from './apiCache';
import { DatabaseAccountTreeItemInternal } from './DatabaseAccountTreeItemInternal';
import { DatabaseTreeItemInternal } from './DatabaseTreeItemInternal';

/**
 * TODO: This needs a rewrite to match v2
 */

const databaseContextValues = [
    DocDBDatabaseTreeItem.contextValue,
    GraphDatabaseTreeItem.contextValue,
    PostgresDatabaseTreeItem.contextValue,
];
function getDatabaseContextValue(apiType: AzureDatabasesApiType): string {
    switch (apiType) {
        case 'SQL':
            return DocDBDatabaseTreeItem.contextValue;
        case 'Graph':
            return GraphDatabaseTreeItem.contextValue;
        case 'Postgres':
            return PostgresDatabaseTreeItem.contextValue;
        default:
            throw new RangeError(`Unsupported api type "${apiType}".`);
    }
}

export async function pickTreeItem(
    pickTreeOptions: PickTreeItemOptions,
): Promise<DatabaseTreeItem | DatabaseAccountTreeItem | undefined> {
    return await callWithTelemetryAndErrorHandling('api.pickTreeItem', async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = true;

        const options: PickAppResourceOptions = {};
        switch (pickTreeOptions.resourceType) {
            case 'Database':
                options.filter = { type: databaseAccountType };
                options.expectedChildContextValue = pickTreeOptions.apiType
                    ? pickTreeOptions.apiType.map(getDatabaseContextValue)
                    : databaseContextValues;
                break;
            case 'DatabaseAccount':
                options.filter = { type: databaseAccountType };
                break;
            default:
                throw new RangeError(`Unsupported resource type "${pickTreeOptions.resourceType}".`);
        }

        const pickedItem = await ext.rgApi.pickAppResource(context, options);

        let parsedCS: ParsedConnectionString;
        let accountNode: MongoAccountTreeItem | DocDBAccountTreeItemBase | PostgresServerTreeItem;
        let databaseNode: DocDBDatabaseTreeItemBase | PostgresDatabaseTreeItem | undefined;
        // if (pickedItem instanceof MongoAccountTreeItem) {
        //     parsedCS = await parseMongoConnectionString(pickedItem.connectionString);
        //     accountNode = pickedItem;
        // } else
        if (pickedItem instanceof DocDBAccountTreeItemBase) {
            parsedCS = parseDocDBConnectionString(pickedItem.connectionString);
            accountNode = pickedItem;
        } else if (pickedItem instanceof PostgresServerTreeItem) {
            parsedCS = await pickedItem.getFullConnectionString();
            accountNode = pickedItem;
        } else if (pickedItem instanceof DocDBDatabaseTreeItemBase) {
            parsedCS = parseDocDBConnectionString(pickedItem.connectionString);
            accountNode = pickedItem.parent;
            databaseNode = pickedItem;
        } else if (pickedItem instanceof PostgresDatabaseTreeItem) {
            parsedCS = await pickedItem.parent.getFullConnectionString();
            accountNode = pickedItem.parent;
            databaseNode = pickedItem;
        } else {
            throw new RangeError(localize('invalidItem', 'Invalid item "{0}".', pickedItem.constructor.name));
        }

        const result = databaseNode
            ? new DatabaseTreeItemInternal(parsedCS, databaseNode.databaseName, accountNode, databaseNode)
            : new DatabaseAccountTreeItemInternal(parsedCS, accountNode);
        cacheTreeItem(parsedCS, result);
        return result;
    });
}
