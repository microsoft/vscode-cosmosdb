/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBCredential } from '../../docdb/getCosmosClient';
import { CosmosAccountResourceItemBase } from '../CosmosAccountResourceItemBase';
import { type TableAccountModel } from './TableAccountModel';

export class TableAccountResourceItem extends CosmosAccountResourceItemBase {
    constructor(
        account: TableAccountModel,
        private readonly credentials: CosmosDBCredential[],
        private readonly documentEndpoint: string,
    ) {
        super(account);
    }

    // here, we can add more methods or properties specific to MongoDB
}
