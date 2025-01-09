/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type Resource } from '@azure/cosmos';
import { type Experience } from '../../AzureDBExperiences';
import { DocumentDBDatabaseResourceItem } from '../docdb/DocumentDBDatabaseResourceItem';
import { type DocumentDBDatabaseModel } from '../docdb/models/DocumentDBDatabaseModel';
import { NoSqlContainerResourceItem } from './NoSqlContainerResourceItem';

export class NoSqlDatabaseResourceItem extends DocumentDBDatabaseResourceItem {
    constructor(model: DocumentDBDatabaseModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenImpl(containers: (ContainerDefinition & Resource)[]): Promise<NoSqlContainerResourceItem[]> {
        return Promise.resolve(
            containers.map(
                (container) => new NoSqlContainerResourceItem({ ...this.model, container }, this.experience),
            ),
        );
    }
}
