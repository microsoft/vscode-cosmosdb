/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * NOTE: This function is async-friendly by design so it can be moved to the backend in the future.
 */

import { type SerializedQueryResult } from '../../cosmosdb/types/queryResult';

export const queryResultToJSON = (queryResult: SerializedQueryResult | null, selection?: number[]): string => {
    if (!queryResult) {
        return '';
    }

    if (selection) {
        const selectedDocs = queryResult.documents
            .map((doc, index) => {
                if (!selection.includes(index)) {
                    return null;
                }
                return doc;
            })
            .filter((doc) => doc !== null);

        return JSON.stringify(selectedDocs, null, 4);
    }

    return JSON.stringify(queryResult.documents, null, 4);
};
