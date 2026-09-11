/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'node:fs';
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
    const skillPath = './skills/cosmosdb-data-model-recommendation/SKILL.md';
    const skill = readFileSync(new URL(`../../${skillPath}`, import.meta.url), 'utf8');

    it('is contributed as a bundled skill with a discoverable name and workflow', () => {
        expect(packageJson.contributes.chatSkills).toContainEqual({ path: skillPath });
        expect(skill).toContain('name: cosmosdb-data-model-recommendation');
        expect(skill).toContain('Load `cosmosdb-best-practices`');
        expect(skill).toContain('Reading only the skill overview is not sufficient');
        expect(skill).toContain('stop and report failure');
    });

    it('documents hint-first ordering, edited models, and the authoritative report-tool contract', () => {
        expect(skill).toContain('use the hint as the first recommendation');
        expect(skill).toContain('first candidate, with verdict `recommended`');
        expect(skill).toContain('When `defaultsUnchanged` is false or absent');
        expect(skill).toContain('Preserve hierarchical key order');
        expect(skill).toContain('violates a hard constraint');
        expect(skill).toContain('authoritative machine-readable contract');
        expect(skill).toContain('Do not introduce read/write/storage priority weights');
        expect(skill).toContain('direct Chat requests without a wizard/report tool');
    });

    it('requires explicit failure instead of guesses or provisional recommendations', () => {
        expect(skill).toContain('**stop and report failure**');
        expect(skill).toContain('precedence over the default-hint preference');
        expect(skill).toContain('Do not report partial success');
        expect(skill).toContain('a non-empty `error` explanation');
        expect(skill).toContain('Omit `summary` and `containers`');
        expect(skill).toContain('specific information or clarification needed to proceed');
        expect(skill).not.toContain('label the recommendation as provisional');
        expect(skill).not.toContain('analyze that container provisionally');
        expect(skill).not.toContain('label illustrative estimates');
    });

    it('enforces hard guardrails before scoring and reports relevant rules last', () => {
        expect(skill).toContain('Never recommend a key that violates an applicable hard constraint');
        expect(skill).toContain('neither a high score nor an unchanged scenario hint can');
        expect(skill).toContain('Unknown evidence needed to establish compliance is not a pass');
        expect(skill).toContain('Derive the applicable guardrails at request time');
        expect(skill).toContain('hard constraints, conditional requirements, and optimization');
        expect(skill).toContain('CRITICAL alone does not establish that a rule is absolute');
        expect(skill).toContain('If sources conflict');
        expect(skill).toContain('**Check every candidate:**');
        expect(skill).toContain('source actually read');
        expect(skill).toContain('**Absolute rules (guardrails)**, after the code sample');
        expect(skill).toContain('`guardrails`');
    });

    it('does not maintain a duplicate guardrail catalog or service limits', () => {
        const guardrails = skill.split('## 3. Enforce absolute rules (guardrails)')[1].split('## 4.')[0];
        expect(guardrails).toContain('does not maintain a separate rule catalog');
        expect(guardrails).toContain('scope, applicability conditions, units');
        expect(guardrails).toContain('Do not substitute remembered limits');
        expect(guardrails).not.toContain('| Absolute rule |');
        expect(guardrails).not.toContain('../cosmosdb-best-practices/rules/');
        expect(skill).not.toMatch(/\b\d[\d,.]*\s*(?:GB|bytes|RU\/s)\b/);
    });

    it('uses only bundled best-practices guidance without fetching external documentation', () => {
        expect(skill).toContain('**Do not fetch external documentation or search the web.**');
        expect(skill).toContain('local references only');
        expect(skill).toContain('do not open');
        expect(skill).toContain('even if a bundled rule suggests consulting the latest documentation');
        expect(skill).toContain('Do not fill gaps from general model knowledge');
        expect(skill).toContain('Do not fetch documentation to resolve the gap');
        expect(skill).toContain('local rule title/path');
        expect(skill).not.toContain('official documentation URL');
        expect(skill).not.toContain('authoritative references it links to');
        expect(skill).not.toContain('check the relevant authoritative');
    });
});
