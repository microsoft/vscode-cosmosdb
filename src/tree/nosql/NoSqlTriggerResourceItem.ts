/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { DocumentDBTriggerResourceItem } from '../docdb/DocumentDBTriggerResourceItem';
import { type DocumentDBTriggerModel } from '../docdb/models/DocumentDBTriggerModel';

export class NoSqlTriggerResourceItem extends DocumentDBTriggerResourceItem {
    constructor(model: DocumentDBTriggerModel, experience: Experience) {
        super(model, experience);
    }
}
