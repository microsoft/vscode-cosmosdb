/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { DocumentDBContainerResourceItem } from '../docdb/DocumentDBContainerResourceItem';
import { type DocumentDBContainerModel } from '../docdb/models/DocumentDBContainerModel';
import { NoSqlItemsResourceItem } from './NoSqlItemsResourceItem';
import { NoSqlStoredProceduresResourceItem } from './NoSqlStoredProceduresResourceItem';
import { NoSqlTriggersResourceItem } from './NoSqlTriggersResourceItem';

export class NoSqlContainerResourceItem extends DocumentDBContainerResourceItem {
    constructor(model: DocumentDBContainerModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenTriggersImpl(): Promise<CosmosDBTreeElement | undefined> {
        return Promise.resolve(new NoSqlTriggersResourceItem({ ...this.model }, this.experience));
    }

    protected getChildrenStoredProceduresImpl(): Promise<CosmosDBTreeElement | undefined> {
        return Promise.resolve(new NoSqlStoredProceduresResourceItem({ ...this.model }, this.experience));
    }

    protected getChildrenItemsImpl(): Promise<CosmosDBTreeElement | undefined> {
        return Promise.resolve(new NoSqlItemsResourceItem({ ...this.model }, this.experience));
    }
}
