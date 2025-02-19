/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseDefinition, type Resource } from '@azure/cosmos';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type AccountInfo } from '../docdb/AccountInfo';
import { DocumentDBAccountAttachedResourceItem } from '../docdb/DocumentDBAccountAttachedResourceItem';
import { type CosmosDBAttachedAccountModel } from '../workspace/CosmosDBAttachedAccountModel';
import { GraphDatabaseResourceItem } from './GraphDatabaseResourceItem';

export class GraphAccountAttachedResourceItem extends DocumentDBAccountAttachedResourceItem {
    constructor(account: CosmosDBAttachedAccountModel, experience: Experience) {
        super(account, experience);
    }

    protected getChildrenImpl(
        accountInfo: AccountInfo,
        databases: (DatabaseDefinition & Resource)[],
    ): Promise<CosmosDBTreeElement[]> {
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
