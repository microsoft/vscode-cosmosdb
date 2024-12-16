/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBCredential } from '../../docdb/getCosmosClient';
import { CosmosAccountResourceItemBase } from '../CosmosAccountResourceItemBase';
import { type NoSqlAccountModel } from './NoSqlAccountModel';

export class NoSqlAccountResourceItem extends CosmosAccountResourceItemBase {
    constructor(
        account: NoSqlAccountModel,
        private readonly credentials: CosmosDBCredential[],
        private readonly documentEndpoint: string,
    ) {
        super(account);
        //
        // // Default to DocumentDB, the base type for all Cosmos DB Accounts
        // return new DocDBAccountTreeItem(parent, id, label, documentEndpoint, credentials, isEmulator, databaseAccount);
    }

    // here, we can add more methods or properties specific to MongoDB
}
