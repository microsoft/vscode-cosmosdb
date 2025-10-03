/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseDefinition, type Resource } from '@azure/cosmos';
import { type Experience } from '../../AzureDBExperiences';
import { type TreeElement } from '../TreeElement';
import { type AccountInfo } from '../cosmosdb/AccountInfo';
import { CosmosDBAccountAttachedResourceItem } from '../cosmosdb/CosmosDBAccountAttachedResourceItem';
import { type CosmosDBAttachedAccountModel } from '../workspace-view/cosmosdb/CosmosDBAttachedAccountModel';
import { GraphDatabaseResourceItem } from './GraphDatabaseResourceItem';

export class GraphAccountAttachedResourceItem extends CosmosDBAccountAttachedResourceItem {
    constructor(account: CosmosDBAttachedAccountModel, experience: Experience) {
        super(account, experience);
    }

    protected getChildrenImpl(
        accountInfo: AccountInfo,
        databases: (DatabaseDefinition & Resource)[],
    ): Promise<TreeElement[]> {
        return Promise.resolve(
            databases.map((db) => {
                return new GraphDatabaseResourceItem(
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
