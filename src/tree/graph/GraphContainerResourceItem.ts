/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { DocumentDBContainerResourceItem } from '../docdb/DocumentDBContainerResourceItem';
import { type DocumentDBContainerModel } from '../docdb/models/DocumentDBContainerModel';
import { GraphItemsResourceItem } from './GraphItemsResourceItem';
import { GraphStoredProceduresResourceItem } from './GraphStoredProceduresResourceItem';

export class GraphContainerResourceItem extends DocumentDBContainerResourceItem {
    constructor(model: DocumentDBContainerModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenTriggersImpl(): Promise<CosmosDBTreeElement | undefined> {
        return Promise.resolve(undefined);
    }

    protected getChildrenStoredProceduresImpl(): Promise<CosmosDBTreeElement | undefined> {
        return Promise.resolve(new GraphStoredProceduresResourceItem({ ...this.model }, this.experience));
    }

    protected getChildrenItemsImpl(): Promise<CosmosDBTreeElement | undefined> {
        return Promise.resolve(new GraphItemsResourceItem({ ...this.model }, this.experience));
    }
}
