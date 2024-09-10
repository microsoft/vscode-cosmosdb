/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type ContainerDefinition,
    type CosmosClient,
    type Database,
    type DatabaseDefinition,
    type Resource,
} from '@azure/cosmos';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { type IGremlinEndpoint } from '../../vscode-cosmosdbgraph.api';
import { getPossibleGremlinEndpoints } from '../gremlinEndpoints';
import { type GraphAccountTreeItem } from './GraphAccountTreeItem';
import { GraphCollectionTreeItem } from './GraphCollectionTreeItem';

export class GraphDatabaseTreeItem extends DocDBDatabaseTreeItemBase {
    public static contextValue: string = 'cosmosDBGraphDatabase';
    public readonly contextValue: string = GraphDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Graph';

    constructor(
        parent: GraphAccountTreeItem,
        private _gremlinEndpoint: IGremlinEndpoint | undefined,
        database: DatabaseDefinition & Resource,
    ) {
        super(parent, database);
    }

    public initChild(collection: ContainerDefinition & Resource): GraphCollectionTreeItem {
        return new GraphCollectionTreeItem(this, collection);
    }

    // Gremlin endpoint, if definitely known
    get gremlinEndpoint(): IGremlinEndpoint | undefined {
        return this._gremlinEndpoint;
    }

    get possibleGremlinEndpoints(): IGremlinEndpoint[] {
        return getPossibleGremlinEndpoints(this.root.endpoint);
    }

    public getDatabaseClient(client: CosmosClient): Database {
        return client.database(this.id);
    }

    protected override async getNewPartitionKey(context: IActionContext): Promise<string | undefined> {
        let partitionKey: string | undefined = await context.ui.showInputBox({
            prompt: 'Enter the partition key for the collection, or leave blank for fixed size.',
            stepName: 'partitionKeyForCollection',
            validateInput: this.validatePartitionKey,
            placeHolder: 'e.g. /address',
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
        if (/.+\//.test(key)) {
            return 'Cannot be a nested path';
        }
        return undefined;
    }
}
