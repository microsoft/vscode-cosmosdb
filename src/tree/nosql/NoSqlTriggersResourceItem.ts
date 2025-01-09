/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Resource, type TriggerDefinition } from '@azure/cosmos';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { DocumentDBTriggersResourceItem } from '../docdb/DocumentDBTriggersResourceItem';
import { type DocumentDBTriggersModel } from '../docdb/models/DocumentDBTriggersModel';
import { NoSqlTriggerResourceItem } from './NoSqlTriggerResourceItem';

export class NoSqlTriggersResourceItem extends DocumentDBTriggersResourceItem {
    constructor(model: DocumentDBTriggersModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenImpl(triggers: (TriggerDefinition & Resource)[]): Promise<CosmosDBTreeElement[]> {
        return Promise.resolve(
            triggers.map((trigger) => new NoSqlTriggerResourceItem({ ...this.model, trigger }, this.experience)),
        );
    }
}
