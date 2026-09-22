/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import {
    applyScenario,
    buildDataModel,
    createBlankContainer,
    createInitialState,
    type WizardState,
    withDerivedCandidates,
} from '../webviews/cosmosdb/DataModeling/dataModel';
import { DATA_MODEL_DEFAULTS } from '../webviews/cosmosdb/DataModeling/dataModelDefaults';
import { getScenarioList } from '../webviews/cosmosdb/DataModeling/scenarios';
import { WizardStateSchema } from './modelingAdvisorSchema';
import { getRecommendationScenarioContext } from './recommendationContext';

const builtInScenarios = getScenarioList().filter(({ id }) => id !== 'other');

describe('recommendation scenario context', () => {
    it.each(builtInScenarios)('provides exact container hints for unchanged $id defaults', ({ id, hint }) => {
        const wizard = applyScenario(createInitialState(), id);
        const original = structuredClone(wizard);
        expect(getRecommendationScenarioContext(wizard)).toEqual({
            scenario: id,
            defaultsUnchanged: true,
            hint,
            containerHints: DATA_MODEL_DEFAULTS[id].containers.map(({ entity, partitionKey }) => ({
                entity,
                partitionKey,
            })),
        });
        expect(wizard).toEqual(original);
    });

    it('ignores generated row IDs, navigation, and serialization property order after restore', () => {
        const wizard = applyScenario(createInitialState(), 'chat');
        wizard.step = 5;
        wizard.reachedSteps = ['workload', 'review'];
        wizard.dataModel = buildDataModel('chat');
        wizard.dataModel.activeContainerId = wizard.dataModel.containers[1].id;
        wizard.dataModel = withDerivedCandidates(wizard.dataModel);
        const restored = WizardStateSchema.parse(JSON.parse(JSON.stringify(wizard)));
        expect(getRecommendationScenarioContext(restored).defaultsUnchanged).toBe(true);
    });

    const edits: { name: string; edit: (state: WizardState) => void }[] = [
        {
            name: 'container name',
            edit: (state) => {
                state.dataModel.containers[0].entity = 'Renamed';
            },
        },
        {
            name: 'partition key',
            edit: (state) => {
                state.dataModel.containers[0].partitionKey = '/id';
            },
        },
        {
            name: 'schema field',
            edit: (state) => {
                state.dataModel.containers[0].properties[0].name = 'newId';
            },
        },
        {
            name: 'property type',
            edit: (state) => {
                state.dataModel.containers[0].properties[0].type = 'number';
            },
        },
        {
            name: 'property role',
            edit: (state) => {
                state.dataModel.containers[0].properties[0].role = 'payload';
            },
        },
        {
            name: 'candidate flag',
            edit: (state) => {
                state.dataModel.containers[0].properties[0].pkCandidate = true;
            },
        },
        {
            name: 'added property',
            edit: (state) => {
                state.dataModel.containers[0].properties.push({
                    id: 'new',
                    name: 'new',
                    type: 'string',
                    role: 'payload',
                    pkCandidate: false,
                });
            },
        },
        {
            name: 'removed property',
            edit: (state) => {
                state.dataModel.containers[0].properties.pop();
            },
        },
        {
            name: 'attribute count',
            edit: (state) => {
                state.dataModel.containers[0].document.attributeCount++;
            },
        },
        {
            name: 'average document size',
            edit: (state) => {
                state.dataModel.containers[0].document.avgSizeKb++;
            },
        },
        {
            name: 'maximum document size',
            edit: (state) => {
                state.dataModel.containers[0].document.maxSizeKb++;
            },
        },
        {
            name: 'array presence',
            edit: (state) => {
                state.dataModel.containers[0].arrays.hasArrays = false;
            },
        },
        {
            name: 'average array size',
            edit: (state) => {
                state.dataModel.containers[0].arrays.avgItems++;
            },
        },
        {
            name: 'maximum array size',
            edit: (state) => {
                state.dataModel.containers[0].arrays.maxItems++;
            },
        },
        {
            name: 'array update pattern',
            edit: (state) => {
                state.dataModel.containers[0].arrays.updatePattern = 'patch';
            },
        },
        {
            name: 'query description',
            edit: (state) => {
                state.dataModel.containers[0].reads[0].pattern = 'Changed';
            },
        },
        {
            name: 'query filter',
            edit: (state) => {
                state.dataModel.containers[0].reads[0].filters = 'id = @id';
            },
        },
        {
            name: 'query QPS',
            edit: (state) => {
                state.dataModel.containers[0].reads[0].qps++;
            },
        },
        {
            name: 'removed query',
            edit: (state) => {
                state.dataModel.containers[0].reads.pop();
            },
        },
        {
            name: 'insert rate',
            edit: (state) => {
                state.dataModel.containers[0].writes.insertsPerSec++;
            },
        },
        {
            name: 'update rate',
            edit: (state) => {
                state.dataModel.containers[0].writes.updatesPerSec++;
            },
        },
        {
            name: 'delete rate',
            edit: (state) => {
                state.dataModel.containers[0].writes.deletesPerSec++;
            },
        },
        {
            name: 'cardinality',
            edit: (state) => {
                state.dataModel.containers[0].scale.candidates[0].distinctValues++;
            },
        },
        {
            name: 'items per partition',
            edit: (state) => {
                state.dataModel.containers[0].scale.items = 'very-high';
            },
        },
        {
            name: 'write distribution',
            edit: (state) => {
                state.dataModel.containers[0].scale.writes = 'skewed';
            },
        },
        {
            name: 'growth',
            edit: (state) => {
                state.dataModel.containers[0].scale.growth = 'rapid';
            },
        },
        {
            name: 'sibling container input',
            edit: (state) => {
                state.dataModel.containers[1].reads[0].qps++;
            },
        },
        {
            name: 'added container',
            edit: (state) => {
                state.dataModel.containers.push(createBlankContainer());
            },
        },
        {
            name: 'removed container',
            edit: (state) => {
                state.dataModel.containers.pop();
            },
        },
        {
            name: 'different scenario',
            edit: (state) => {
                state.scenario = 'chat';
            },
        },
    ];

    it.each(edits)('disables automatic hint preference after changing $name', ({ edit }) => {
        const wizard = applyScenario(createInitialState(), 'ecommerce');
        edit(wizard);
        expect(getRecommendationScenarioContext(wizard)).toMatchObject({
            defaultsUnchanged: false,
            containerHints: [],
        });
    });

    it('re-enables hints when the user returns to the exact default values', () => {
        const wizard = applyScenario(createInitialState(), 'chat');
        const read = wizard.dataModel.containers[0].reads[0];
        read.qps++;
        expect(getRecommendationScenarioContext(wizard).defaultsUnchanged).toBe(false);
        read.qps--;
        expect(getRecommendationScenarioContext(wizard).defaultsUnchanged).toBe(true);
    });

    it('does not infer unchanged defaults from the scenario name on older or incomplete models', () => {
        const wizard = applyScenario(createInitialState(), 'chat');
        wizard.dataModel.containers[1].partitionKey = '/sessionId';
        expect(getRecommendationScenarioContext(wizard).defaultsUnchanged).toBe(false);
        wizard.dataModel.containers = [];
        expect(getRecommendationScenarioContext(wizard).defaultsUnchanged).toBe(false);
    });

    it('does not apply a default hint to custom or unspecified scenarios', () => {
        expect(getRecommendationScenarioContext(applyScenario(createInitialState(), 'other'))).toEqual({
            scenario: 'other',
            defaultsUnchanged: false,
            hint: null,
            containerHints: [],
        });
        expect(getRecommendationScenarioContext(createInitialState())).toEqual({
            scenario: null,
            defaultsUnchanged: false,
            hint: null,
            containerHints: [],
        });
    });

    it('resolves summary hints to individual container keys and preserves hierarchical order', () => {
        const context = getRecommendationScenarioContext(applyScenario(createInitialState(), 'chat'));
        expect(context.hint).toBe('/sessionId · /userId');
        expect(context.containerHints).toEqual([
            { entity: 'ChatSession', partitionKey: '/sessionId' },
            { entity: 'Message', partitionKey: '/sessionId, /messageId' },
            { entity: 'User', partitionKey: '/userId' },
        ]);
    });
});

describe('bundled recommendation skill', () => {
    it('registers the skill and includes its source file', () => {
        const skillPath = './skills/cosmosdb-data-model-recommendation/SKILL.md';
        expect(packageJson.contributes.chatSkills).toContainEqual({ path: skillPath });
        expect(statSync(new URL(`../../${skillPath}`, import.meta.url)).isFile()).toBe(true);
    });
});
