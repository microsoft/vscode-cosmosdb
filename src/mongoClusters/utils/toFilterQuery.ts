/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document, type Filter } from 'mongodb';

export function toFilterQueryObj(queryString: string): Filter<Document> {
    let filterObj: Filter<Document> = {};
    try {
        filterObj = JSON.parse(queryString) as Filter<Document>;
    } catch (e) {
        console.error('Error parsing filter query', e);
        filterObj = {};
    }

    return filterObj;
}
