/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tryGetGremlinEndpointFromAzure } from '../../graph/gremlinEndpoints';
import { nonNullProp } from '../../utils/nonNull';
import { type IGremlinEndpoint } from '../../vscode-cosmosdbgraph.api';
import { DocumentDBAccountResourceItem } from '../DocumentDBAccountResourceItem';

export class GraphAccountResourceItem extends DocumentDBAccountResourceItem {
    public gremlinEndpoint?: IGremlinEndpoint;

    protected override async init(): Promise<void> {
        await super.init();

        const name = nonNullProp(this.account, 'name');
        const resourceGroup = nonNullProp(this.account, 'resourceGroup');
        const client = await this.getClient();

        if (!client) {
            return;
        }

        this.gremlinEndpoint = await tryGetGremlinEndpointFromAzure(client, resourceGroup, name);
    }

    // here, we can add more methods or properties specific to MongoDB
}
