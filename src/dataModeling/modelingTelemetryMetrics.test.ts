/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import {
    applyScenario,
    buildDataModel,
    createBlankContainer,
    createInitialState,
    type WizardState,
} from '../webviews/cosmosdb/DataModeling/dataModel';
import { DATA_MODEL_DEFAULTS } from '../webviews/cosmosdb/DataModeling/dataModelDefaults';
import { type ContainerModel } from '../webviews/cosmosdb/DataModeling/models';
import { getScenarioList } from '../webviews/cosmosdb/DataModeling/scenarios';
import { WizardStateSchema } from './modelingAdvisorSchema';
import { modelingInputsEqual, summarizeCoverage, summarizeModel } from './modelingTelemetryMetrics';

const unchanged = {
    differsFromDefault: false,
    dataChanged: false,
    queriesChanged: false,
    scaleChanged: false,
    customizedContainerCount: 0,
};

describe('modeling usage metrics', () => {
    it.each(getScenarioList())('recognizes unchanged $id defaults without mutation or generated IDs', ({ id }) => {
        const wizard = applyScenario(createInitialState(), id);
        const original = structuredClone(wizard);
        const defaults = DATA_MODEL_DEFAULTS[id].containers;
        const randomUUID = vi.spyOn(crypto, 'randomUUID');
        try {
            expect(summarizeModel(wizard)).toEqual({
                ...unchanged,
                scenario: id,
                containerCount: defaults.length,
                propertyCount: defaults.reduce((count, container) => count + container.properties.length, 0),
                queryCount: defaults.reduce((count, container) => count + container.reads.length, 0),
            });
            expect(wizard).toEqual(original);
            expect(randomUUID).not.toHaveBeenCalled();
        } finally {
            randomUUID.mockRestore();
        }
    });

    it('ignores regenerated IDs, active selection and navigation, including restored defaults', () => {
        const wizard = applyScenario(createInitialState(), 'chat');
        wizard.dataModel = buildDataModel('chat');
        wizard.step = 5;
        wizard.reachedSteps = ['workload', 'review'];
        for (const container of wizard.dataModel.containers) {
            container.id = `restored-${container.id}`;
            container.properties.forEach((property) => (property.id = `restored-${property.id}`));
            container.reads.forEach((read) => (read.id = `restored-${read.id}`));
            container.scale.candidates.forEach((candidate) => (candidate.id = `restored-${candidate.id}`));
        }
        wizard.dataModel.activeContainerId = wizard.dataModel.containers[1].id;
        const restored = WizardStateSchema.parse(JSON.parse(JSON.stringify(wizard)));
        expect(summarizeModel(restored)).toMatchObject(unchanged);
    });

    const edits: { name: string; section: 'data' | 'queries' | 'scale'; edit: (container: ContainerModel) => void }[] =
        [
            { name: 'container name', section: 'data', edit: (container) => (container.entity += 'Renamed') },
            { name: 'partition key', section: 'data', edit: (container) => (container.partitionKey = '/different') },
            {
                name: 'property name',
                section: 'data',
                edit: (container) => (container.properties[0].name += 'Renamed'),
            },
            { name: 'property type', section: 'data', edit: (container) => (container.properties[0].type = 'number') },
            { name: 'property role', section: 'data', edit: (container) => (container.properties[0].role = 'payload') },
            {
                name: 'candidate flag',
                section: 'data',
                edit: (container) => (container.properties[0].pkCandidate = true),
            },
            { name: 'property removal', section: 'data', edit: (container) => container.properties.pop() },
            { name: 'document size', section: 'data', edit: (container) => container.document.avgSizeKb++ },
            { name: 'array size', section: 'data', edit: (container) => container.arrays.avgItems++ },
            {
                name: 'read pattern',
                section: 'queries',
                edit: (container) => (container.reads[0].pattern += 'Changed'),
            },
            { name: 'read filter', section: 'queries', edit: (container) => (container.reads[0].filters += 'Changed') },
            { name: 'read rate', section: 'queries', edit: (container) => container.reads[0].qps++ },
            { name: 'query removal', section: 'queries', edit: (container) => container.reads.pop() },
            { name: 'insert rate', section: 'queries', edit: (container) => container.writes.insertsPerSec++ },
            { name: 'update rate', section: 'queries', edit: (container) => container.writes.updatesPerSec++ },
            { name: 'delete rate', section: 'queries', edit: (container) => container.writes.deletesPerSec++ },
            {
                name: 'cardinality',
                section: 'scale',
                edit: (container) => container.scale.candidates[0].distinctValues++,
            },
            {
                name: 'candidate attribute',
                section: 'scale',
                edit: (container) => (container.scale.candidates[0].attribute += 'X'),
            },
            {
                name: 'candidate role',
                section: 'scale',
                edit: (container) => (container.scale.candidates[0].role = 'payload'),
            },
            { name: 'candidate removal', section: 'scale', edit: (container) => container.scale.candidates.pop() },
            {
                name: 'items per partition',
                section: 'scale',
                edit: (container) => (container.scale.items = 'very-high'),
            },
            { name: 'write distribution', section: 'scale', edit: (container) => (container.scale.writes = 'time') },
            { name: 'growth', section: 'scale', edit: (container) => (container.scale.growth = 'bounded') },
        ];

    it.each(edits)('detects and clears a $name edit in its section', ({ section, edit }) => {
        const wizard = applyScenario(createInitialState(), 'chat');
        const originalModel = structuredClone(wizard.dataModel);
        const original = structuredClone(wizard.dataModel.containers[0]);
        edit(wizard.dataModel.containers[0]);
        expect(modelingInputsEqual(wizard.dataModel, originalModel)).toBe(false);
        expect(summarizeModel(wizard)).toMatchObject({
            differsFromDefault: true,
            dataChanged: section === 'data',
            queriesChanged: section === 'queries',
            scaleChanged: section === 'scale',
            customizedContainerCount: 1,
        });
        wizard.dataModel.containers[0] = original;
        expect(modelingInputsEqual(wizard.dataModel, originalModel)).toBe(true);
        expect(summarizeModel(wizard)).toMatchObject(unchanged);
    });

    it('counts added containers and restores defaults after removing them', () => {
        const wizard = applyScenario(createInitialState(), 'chat');
        const baseline = summarizeModel(wizard);
        wizard.dataModel.containers.push(createBlankContainer());
        expect(summarizeModel(wizard)).toEqual({
            scenario: 'chat',
            differsFromDefault: true,
            dataChanged: true,
            queriesChanged: true,
            scaleChanged: true,
            containerCount: baseline.containerCount + 1,
            propertyCount: baseline.propertyCount + 1,
            queryCount: baseline.queryCount + 1,
            customizedContainerCount: 1,
        });
        wizard.dataModel.containers.pop();
        expect(summarizeModel(wizard)).toEqual(baseline);
    });

    it('detects removals, reorderings, and switching to different scenario defaults', () => {
        const wizard = applyScenario(createInitialState(), 'chat');
        wizard.dataModel.containers.pop();
        expect(summarizeModel(wizard)).toMatchObject({
            differsFromDefault: true,
            dataChanged: true,
            queriesChanged: true,
            scaleChanged: true,
            customizedContainerCount: 0,
        });
        wizard.dataModel = buildDataModel('chat');
        wizard.dataModel.containers.reverse();
        expect(summarizeModel(wizard)).toMatchObject({
            differsFromDefault: true,
            customizedContainerCount: 2,
        });
        wizard.dataModel.containers.reverse();
        expect(summarizeModel(wizard)).toMatchObject(unchanged);
        wizard.scenario = 'ecommerce';
        expect(summarizeModel(wizard).differsFromDefault).toBe(true);
    });

    it('distinguishes an empty unspecified model from custom data with no scenario', () => {
        const wizard: WizardState = createInitialState();
        expect(summarizeModel(wizard)).toEqual({
            ...unchanged,
            scenario: 'none',
            containerCount: 0,
            propertyCount: 0,
            queryCount: 0,
        });
        wizard.dataModel.containers.push(createBlankContainer('PrivateContainer'));
        expect(summarizeModel(wizard)).toEqual({
            scenario: 'none',
            differsFromDefault: true,
            dataChanged: true,
            queriesChanged: true,
            scaleChanged: true,
            containerCount: 1,
            propertyCount: 1,
            queryCount: 1,
            customizedContainerCount: 1,
        });
    });

    it('returns only bounded scenario, boolean and numeric values, never model content', () => {
        const wizard = applyScenario(createInitialState(), 'chat');
        wizard.dataModel.containers[0].entity = 'private name';
        wizard.dataModel.containers[0].reads[0].pattern = 'private query';
        const summary = summarizeModel(wizard);
        expect(Object.values(summary).every((value) => typeof value !== 'string' || value === 'chat')).toBe(true);
        expect(Object.keys(summary)).toHaveLength(9);
    });
});

describe('modeling input equality', () => {
    it('ignores freshly generated IDs and active selection without modifying either model', () => {
        const first = buildDataModel('chat');
        const second = buildDataModel('chat');
        second.activeContainerId = second.containers[1].id;
        const originals = structuredClone([first, second]);
        expect(first.containers[0].id).not.toBe(second.containers[0].id);
        expect(modelingInputsEqual(first, second)).toBe(true);
        expect(modelingInputsEqual(first, first)).toBe(true);
        expect([first, second]).toEqual(originals);
    });

    it('ignores equivalent object replacements and serialization property order', () => {
        const first = buildDataModel('chat');
        const second = structuredClone(first);
        const read = second.containers[0].reads[0];
        second.containers[0].reads[0] = {
            qps: read.qps,
            filters: read.filters,
            pattern: read.pattern,
            id: 'replacement',
        };
        expect(modelingInputsEqual(first, second)).toBe(true);
    });

    it('detects additions, removals, and reordered containers', () => {
        const first = buildDataModel('chat');
        const second = buildDataModel('chat');
        second.containers.push(createBlankContainer());
        expect(modelingInputsEqual(first, second)).toBe(false);
        second.containers.pop();
        second.containers.pop();
        expect(modelingInputsEqual(first, second)).toBe(false);
        expect(modelingInputsEqual(first, { ...first, containers: [...first.containers].reverse() })).toBe(false);
        expect(modelingInputsEqual({ containers: [] }, { containers: [], activeContainerId: undefined })).toBe(true);
    });
});

describe('modeling section coverage', () => {
    it('counts actual sections once and excludes removed containers while including new containers in the denominator', () => {
        const visits = new Map<string, Set<'data' | 'queries' | 'scale'>>([
            ['first', new Set(['data', 'queries'])],
            ['second', new Set(['data', 'scale'])],
            ['removed', new Set(['data', 'queries', 'scale'])],
        ]);
        visits.get('first')?.add('data');
        const original = structuredClone(visits);
        const ids = ['first', 'second', 'new'];
        expect(summarizeCoverage(ids, visits)).toEqual({
            dataViewedCount: 2,
            queriesViewedCount: 1,
            scaleViewedCount: 1,
            dataNeverViewedCount: 1,
            queriesNeverViewedCount: 2,
            scaleNeverViewedCount: 2,
            dataCoverage: 0.667,
            queriesCoverage: 0.333,
            scaleCoverage: 0.333,
        });
        expect(visits).toEqual(original);
        expect(ids).toEqual(['first', 'second', 'new']);
    });

    it('reports no coverage before any visits, and full coverage after all sections are visited', () => {
        expect(summarizeCoverage(['first'], new Map())).toEqual({
            dataViewedCount: 0,
            queriesViewedCount: 0,
            scaleViewedCount: 0,
            dataNeverViewedCount: 1,
            queriesNeverViewedCount: 1,
            scaleNeverViewedCount: 1,
            dataCoverage: 0,
            queriesCoverage: 0,
            scaleCoverage: 0,
        });
        expect(
            summarizeCoverage(['first'], new Map([['first', new Set(['data', 'queries', 'scale'] as const)]])),
        ).toEqual({
            dataViewedCount: 1,
            queriesViewedCount: 1,
            scaleViewedCount: 1,
            dataNeverViewedCount: 0,
            queriesNeverViewedCount: 0,
            scaleNeverViewedCount: 0,
            dataCoverage: 1,
            queriesCoverage: 1,
            scaleCoverage: 1,
        });
    });

    it('uses zero rather than NaN for no current containers even when removed containers were visited', () => {
        expect(summarizeCoverage([], new Map([['removed', new Set(['data'] as const)]]))).toEqual({
            dataViewedCount: 0,
            queriesViewedCount: 0,
            scaleViewedCount: 0,
            dataNeverViewedCount: 0,
            queriesNeverViewedCount: 0,
            scaleNeverViewedCount: 0,
            dataCoverage: 0,
            queriesCoverage: 0,
            scaleCoverage: 0,
        });
    });
});
