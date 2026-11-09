/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { createBlankContainer, type DataModel } from './dataModel';
import { type SchemaProperty } from './models';
import { SchemaImportTracker } from './schemaImports';

describe('SchemaImportTracker', () => {
    const imported: SchemaProperty[] = [
        { id: 'prop-id', name: 'id', type: 'string', role: 'key', pkCandidate: true },
        { id: 'prop-amount', name: 'amount', type: 'number', role: 'payload', pkCandidate: false },
    ];
    const added: SchemaProperty = {
        id: 'prop-added',
        name: 'added',
        type: 'string',
        role: 'payload',
        pkCandidate: false,
    };

    // A field edit queued in the same batch as the import rebuilds the properties array around the imported entries.
    it.each([
        ['an unchanged rebuilt list', () => [...imported]],
        ['a field added in the same batch', () => [...imported, added]],
    ])('acknowledges a committed import once when %s replaces its array', (_, committedProperties) => {
        const container = createBlankContainer('Orders');
        const tracker = new SchemaImportTracker();
        const request = tracker.start(container.id, 'orders.json');
        request.properties = imported;
        const before: DataModel = { containers: [container], activeContainerId: container.id };
        expect(tracker.acknowledge(before)).toEqual([]);

        const after: DataModel = {
            containers: [{ ...container, properties: committedProperties() }],
            activeContainerId: container.id,
        };
        expect(tracker.acknowledge(after)).toEqual([request]);
        expect(tracker.acknowledge(after)).toEqual([]);
    });
});
