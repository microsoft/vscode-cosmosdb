/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBQueryEditorResourceItem } from '../cosmosdb/CosmosDBQueryEditorResourceItem';
import { type CosmosDBQueryEditorModel } from '../cosmosdb/models/CosmosDBQueryEditorModel';
import { type TreeElement } from '../TreeElement';

export class NoSqlQueryEditorResourceItem extends CosmosDBQueryEditorResourceItem {
    constructor(model: CosmosDBQueryEditorModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenImpl(): Promise<TreeElement[]> {
        return Promise.resolve([]);
    }
}
