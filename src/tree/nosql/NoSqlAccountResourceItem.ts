/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseDefinition, type Resource } from '@azure/cosmos';
import { type Experience } from '../../AzureDBExperiences';
import { type TreeElement } from '../TreeElement';
import { type AccountInfo } from '../cosmosdb/AccountInfo';
import { CosmosDBAccountResourceItem } from '../cosmosdb/CosmosDBAccountResourceItem';
import { type CosmosDBAccountModel } from '../cosmosdb/models/CosmosDBAccountModel';
import { NoSqlDatabaseResourceItem } from './NoSqlDatabaseResourceItem';

export class NoSqlAccountResourceItem extends CosmosDBAccountResourceItem {
    constructor(account: CosmosDBAccountModel, experience: Experience) {
        super(account, experience);
    }

    protected getChildrenImpl(
        accountInfo: AccountInfo,
        databases: (DatabaseDefinition & Resource)[],
    ): Promise<TreeElement[]> {
        return Promise.resolve(
            databases.map((db) => {
                return new NoSqlDatabaseResourceItem(
                    {
                        accountInfo: accountInfo,
                        database: db,
                    },
                    this.experience,
                );
            }),
        );
    }
}
