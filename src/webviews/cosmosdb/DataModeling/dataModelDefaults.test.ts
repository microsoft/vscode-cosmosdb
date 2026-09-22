/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { getPartitionKeyPaths } from '../../../dataModeling/deploymentModel';
import { ModelingAdvisorSnapshotSchema } from '../../../dataModeling/modelingAdvisorSchema';
import { buildDataModel, createInitialState, withDerivedCandidates } from './dataModel';
import { DATA_MODEL_DEFAULTS } from './dataModelDefaults';
import { getScenarioList } from './scenarios';

const scenarios = getScenarioList().filter((scenario) => scenario.id !== 'other');

describe('scenario defaults', () => {
    it('covers all built-in scenarios and containers', () => {
        expect(scenarios).toHaveLength(15);
        expect(new Set(Object.keys(DATA_MODEL_DEFAULTS))).toEqual(
            new Set(getScenarioList().map((scenario) => scenario.id)),
        );
        expect(
            scenarios.reduce((count, scenario) => count + DATA_MODEL_DEFAULTS[scenario.id].containers.length, 0),
        ).toBe(24);
    });

    it.each(scenarios)('seeds every configured value for $id', ({ id: scenarioId }) => {
        const defaults = DATA_MODEL_DEFAULTS[scenarioId];
        const model = buildDataModel(scenarioId);
        expect(model.containers.map((container) => container.entity)).toEqual(
            defaults.containers.map((container) => container.entity),
        );
        expect(model.activeContainerId).toBe(model.containers[0].id);
        expect(
            ModelingAdvisorSnapshotSchema.safeParse({
                wizard: { ...createInitialState(), scenario: scenarioId, dataModel: model },
                recommendation: { status: 'idle' },
            }).success,
        ).toBe(true);

        defaults.containers.forEach((source, index) => {
            const container = model.containers[index];
            const keys = getPartitionKeyPaths(source.partitionKey).map((path) => path.slice(1));
            expect(container.partitionKey).toBe(source.partitionKey);
            expect(
                container.properties.map(({ name, type, role, pkCandidate }) => ({ name, type, role, pkCandidate })),
            ).toEqual(
                source.properties.map(({ name, type, role, pkCandidate }) => ({ name, type, role, pkCandidate })),
            );
            expect(
                container.properties
                    .filter((property) => property.pkCandidate)
                    .map((property) => property.name)
                    .sort(),
            ).toEqual([...keys].sort());
            expect(container.document).toEqual(source.document);
            expect(container.document.attributeCount).toBe(source.properties.length);
            expect(container.arrays).toEqual(source.arrays);
            expect(container.arrays.hasArrays).toBe(source.properties.some((field) => field.type === 'array'));
            expect(container.reads.map(({ pattern, filters, qps }) => ({ pattern, filters, qps }))).toEqual(
                source.reads,
            );
            expect(container.writes).toEqual(source.writes);
            expect(container.scale).toMatchObject(source.scale);
            for (const field of source.properties.filter((entry) => entry.distinctValues !== undefined)) {
                expect(
                    container.scale.candidates.find((candidate) => candidate.attribute === field.name)?.distinctValues,
                ).toBe(field.distinctValues);
            }
            for (const name of keys) {
                expect(container.scale.candidates.some((candidate) => candidate.attribute === name)).toBe(true);
            }
            const ids = [
                container.id,
                ...container.properties.map((property) => property.id),
                ...container.reads.map((read) => read.id),
                ...container.scale.candidates.map((candidate) => candidate.id),
            ];
            expect(ids.every(Boolean)).toBe(true);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });

    it('keeps hierarchical key order and bounded query predicates for inventory movements', () => {
        const movement = buildDataModel('inventory').containers[1];
        expect(movement.entity).toBe('InventoryMovement');
        expect(getPartitionKeyPaths(movement.partitionKey)).toEqual(['/skuId', '/movementId']);
        expect(movement.reads[0]).toMatchObject({
            pattern: 'Get movement history for a SKU in a bounded time range',
            filters: 'skuId = @skuId AND occurredAt >= @startDate AND occurredAt < @endDate',
            qps: 80,
        });
        expect(
            movement.scale.candidates.find((candidate) => candidate.attribute === 'movementType')?.distinctValues,
        ).toBe(8);
    });

    it('does not invent a filter for a query over the whole catalog', () => {
        expect(buildDataModel('catalog').containers[0].reads[2]).toMatchObject({
            pattern: 'List all products',
            filters: '',
            qps: 10,
        });
    });

    it('preserves planning baselines that the catalog does not replace', () => {
        const telemetry = buildDataModel('iot').containers[0];
        expect(telemetry.document).toEqual({ attributeCount: 7, avgSizeKb: 1, maxSizeKb: 4 });
        expect(telemetry.writes).toEqual({ insertsPerSec: 500, updatesPerSec: 60, deletesPerSec: 10 });
        expect(telemetry.scale).toMatchObject({ items: 'high', writes: 'time', growth: 'rapid' });
        const rag = buildDataModel('rag').containers[0];
        expect(rag.document).toEqual({ attributeCount: 6, avgSizeKb: 7, maxSizeKb: 28 });
        expect(rag.writes).toEqual({ insertsPerSec: 5, updatesPerSec: 3, deletesPerSec: 1 });
        expect(rag.scale).toMatchObject({ items: 'medium', writes: 'even', growth: 'bounded' });
    });

    it('keeps catalog cardinalities and user edits when deriving candidates again', () => {
        const model = buildDataModel('ecommerce');
        const candidate = model.containers[0].scale.candidates.find((entry) => entry.attribute === 'status')!;
        expect(candidate.distinctValues).toBe(5);
        expect(withDerivedCandidates(model).containers[0].scale.candidates).toContainEqual(candidate);
        candidate.distinctValues = 12;
        expect(withDerivedCandidates(model).containers[0].scale.candidates).toContainEqual(candidate);
    });

    it('does not share mutable defaults or runtime IDs across new models', () => {
        const defaults = structuredClone(DATA_MODEL_DEFAULTS.inventory);
        const first = buildDataModel('inventory');
        const second = buildDataModel('inventory');
        const container = first.containers[1];
        container.properties[0].name = 'changed';
        container.document.avgSizeKb = 99;
        container.arrays.avgItems = 999;
        container.reads[0].qps = 1234;
        container.writes.insertsPerSec = 1234;
        container.scale.candidates[0].distinctValues = 1;
        expect(DATA_MODEL_DEFAULTS.inventory).toEqual(defaults);
        expect(second.containers[1].properties[0].name).toBe('id');
        expect(second.containers[1].reads[0].qps).toBe(80);
        expect(second.containers[1].id).not.toBe(container.id);
    });

    it('preserves the custom workload fallback', () => {
        const model = buildDataModel('other');
        expect(model.containers).toHaveLength(1);
        expect(model.containers[0]).toMatchObject({
            entity: 'Entity',
            partitionKey: '/id',
            reads: [{ pattern: 'Describe your dominant query', filters: 'id', qps: 200 }],
        });
    });
});
