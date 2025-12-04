/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { type TreeElement } from '../TreeElement';
import { type AccountInfo } from '../cosmosdb/AccountInfo';
import { CosmosDBAccountAttachedResourceItem } from '../cosmosdb/CosmosDBAccountAttachedResourceItem';
import { type DatabaseResource } from '../cosmosdb/models/CosmosDBTypes';
import { type CosmosDBAttachedAccountModel } from '../workspace-view/cosmosdb/CosmosDBAttachedAccountModel';
import { NoSqlDatabaseResourceItem } from './NoSqlDatabaseResourceItem';

export class NoSqlAccountAttachedResourceItem extends CosmosDBAccountAttachedResourceItem {
    constructor(account: CosmosDBAttachedAccountModel, experience: Experience) {
        super(account, experience);
    }

    protected getChildrenImpl(accountInfo: AccountInfo, databases: DatabaseResource[]): Promise<TreeElement[]> {
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
