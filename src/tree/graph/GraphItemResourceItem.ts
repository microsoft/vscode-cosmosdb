/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { DocumentDBItemResourceItem } from '../docdb/DocumentDBItemResourceItem';
import { type DocumentDBItemModel } from '../docdb/models/DocumentDBItemModel';

export class GraphItemResourceItem extends DocumentDBItemResourceItem {
    constructor(model: DocumentDBItemModel, experience: Experience) {
        super(model, experience);
    }
}
