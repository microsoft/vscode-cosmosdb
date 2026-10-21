/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { ModelingAdvisorSnapshotSchema } from '../../../dataModeling/modelingAdvisorSchema';
import { buildCandidates, createBlankContainer, createInitialState, withDerivedCandidates } from './dataModel';
import { inferSchemaFromJson } from './jsonInference';
import { type SchemaProperty } from './models';

describe('partition-key candidate eligibility', () => {
    const properties: SchemaProperty[] = [
        { id: 'id', name: 'id', type: 'string', role: 'key', pkCandidate: true },
        { id: 'items', name: 'items', type: 'array', role: 'filter', pkCandidate: false },
        { id: 'product', name: 'items/productId', type: 'string', role: 'key', pkCandidate: false },
        { id: 'customer', name: 'customer', type: 'object', role: 'key', pkCandidate: false },
        { id: 'customer-id', name: 'customer/customerId', type: 'string', role: 'key', pkCandidate: false },
        { id: 'vector', name: 'embedding', type: 'number[]', role: 'filter', pkCandidate: false },
        {
            id: 'mixed',
            name: 'mixedId',
            type: 'string',
            role: 'key',
            pkCandidate: false,
            hasNonScalarValues: true,
        },
        {
            id: 'orphan',
            name: 'removedArray/childId',
            type: 'string',
            role: 'key',
            pkCandidate: false,
            hasArrayAncestor: true,
        },
    ];

    it('excludes non-scalar values and array paths, including legacy fields without ancestry metadata', () => {
        expect(buildCandidates({ properties }).map((candidate) => candidate.attribute)).toEqual([
            'id',
            'customer/customerId',
        ]);
    });

    it('drops stale invalid candidates while preserving eligible IDs and cardinalities', () => {
        const container = createBlankContainer();
        container.properties = properties;
        container.scale.candidates = properties.map((property) => ({
            id: `candidate-${property.id}`,
            attribute: property.name,
            role: property.role,
            distinctValues: 42,
        }));
        const derived = withDerivedCandidates({ containers: [container], activeContainerId: container.id });
        expect(derived.containers[0].scale.candidates).toEqual([
            container.scale.candidates[0],
            container.scale.candidates[4],
        ]);
    });

    it('preserves inferred restrictions across a saved-project round trip', () => {
        const inferred = inferSchemaFromJson(
            JSON.stringify([
                { id: '1', items: [{ productId: 'p1' }], customerId: 'customer-1' },
                { id: '2', items: [], customerId: 'customer-2' },
                { id: '3', items: [], customerId: [] },
            ]),
        );
        const container = createBlankContainer();
        container.properties = inferred.properties.map((property) => ({ ...property, id: property.name }));
        container.partitionKey = inferred.partitionKey;
        const wizard = {
            ...createInitialState(),
            dataModel: withDerivedCandidates({ containers: [container], activeContainerId: container.id }),
        };
        const snapshot = { wizard, recommendation: { status: 'idle' } };
        const restored = ModelingAdvisorSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
        expect(restored).toEqual(snapshot);
        expect(restored.wizard.dataModel.containers[0].properties).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'items/productId', hasArrayAncestor: true }),
                expect.objectContaining({ name: 'customerId', hasNonScalarValues: true }),
            ]),
        );
        expect(
            buildCandidates(restored.wizard.dataModel.containers[0]).map((candidate) => candidate.attribute),
        ).toEqual(['id']);
    });
});
