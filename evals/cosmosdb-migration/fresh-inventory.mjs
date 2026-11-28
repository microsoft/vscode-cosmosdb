/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { sourceFieldId } from '../../skills/cosmosdb-migration/scripts/source-contract.mjs';

// The phase validators also accept historical IDs. Only trials that start without an inventory require new IDs.
export function assertFreshInventory(inventory) {
    assert.equal(inventory.version, 2, 'Fresh preflight must write source inventory version 2');
    for (const dataset of inventory.datasets) {
        for (const field of dataset.fields) {
            assert.equal(
                field.id,
                sourceFieldId(field.path),
                `Fresh field ID must match its typed path in ${dataset.id}`,
            );
        }
    }
}
