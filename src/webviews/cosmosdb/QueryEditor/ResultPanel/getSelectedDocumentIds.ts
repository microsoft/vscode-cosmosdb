/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type PartitionKeyDefinition } from '@azure/cosmos';
import { type CosmosDBRecordIdentifier, type SerializedQueryResult } from '../../../../cosmosdb/types/queryResult';
import { getDocumentId } from '../../../../utils/document';

/**
 * Resolves the {@link CosmosDBRecordIdentifier}s for the currently selected result rows.
 *
 * `selectedRows` holds 0-based indices into `queryResult.documents` (the data grid stores its
 * selection as `rowId - 1`, and the table converter emits rows in document order, so the indices
 * line up 1:1).
 *
 * Identity is resolved with {@link getDocumentId}, which only needs a `_rid` (or an `id` plus the
 * partition key) — the same lenient check the row double-click handler uses via the pre-computed
 * `__documentId`. We deliberately do NOT gate on the stricter `isCosmosDBRecord` here: that guard
 * additionally requires `_ts`/`_self`/`_etag`/`_attachments`, which are not always present on
 * returned documents (e.g. `_attachments` can be absent), and would silently drop otherwise-valid
 * rows — making Edit/View/Delete (button and hotkey) no-op while double-click still worked.
 */
export const getSelectedDocumentIds = (
    selectedRows: number[],
    queryResult: SerializedQueryResult | null,
    partitionKey: PartitionKeyDefinition | undefined,
): CosmosDBRecordIdentifier[] =>
    selectedRows
        .map((rowIndex): CosmosDBRecordIdentifier | undefined => {
            const document = queryResult?.documents[rowIndex];
            if (document === undefined || document === null) {
                return undefined;
            }
            return getDocumentId(document as unknown as ItemDefinition, partitionKey);
        })
        .filter((document): document is CosmosDBRecordIdentifier => document !== undefined);
