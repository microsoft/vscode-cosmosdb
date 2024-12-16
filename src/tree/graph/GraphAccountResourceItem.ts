/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBCredential } from '../../docdb/getCosmosClient';
import { CosmosAccountResourceItemBase } from '../CosmosAccountResourceItemBase';
import { type GraphAccountModel } from './GraphAccountModel';

export class GraphAccountResourceItem extends CosmosAccountResourceItemBase {
    constructor(
        account: GraphAccountModel,
        private readonly credentials: CosmosDBCredential[],
        private readonly documentEndpoint: string,
        private readonly gremlinEndpoint: string,
    ) {
        super(account);
    }

    // here, we can add more methods or properties specific to MongoDB
}
