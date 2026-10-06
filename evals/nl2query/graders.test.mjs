/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    computeMetrics,
    createDefaultGraderRegistry,
    gradeTrajectory,
    loadEvalSpec,
    materializeWorkspace,
    resolveGradePass,
} from '@microsoft/vally';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const spec = await loadEvalSpec(fileURLToPath(new URL('./eval.yaml', import.meta.url)));
const skillName = 'cosmosdb-nosql-query-generation';
const bestPracticesSkillName = 'cosmosdb-best-practices';
const completedEvents = [
    { type: 'skill_activation', data: { name: skillName, path: skillName } },
    { type: 'turn_end', data: { turnId: 'test-turn' } },
];
const explainCompletedEvents = completedEvents.filter((event) => event.type !== 'skill_activation');
const explainSkillEvents = [
    { type: 'skill_activation', data: { name: bestPracticesSkillName, path: bestPracticesSkillName } },
    ...explainCompletedEvents,
];

const queryFormats = [
    (query) => query,
    (query) => `\`\`\`sql\n${query}\n\`\`\``,
    (query) => `\`\`\`\n${query}\n\`\`\``,
    (query) => ` \r\n\`\`\`sql \t\r\n${query.replace(/\r?\n/g, '\r\n')}\r\n \`\`\`\r\n`,
];

const cases = [
    {
        name: 'product-tag-rows',
        accepted: [
            'SELECT c.id, t AS tag FROM c JOIN t IN c.tags',
            'select c.id as id, t as tag from c join t in c.tags',
            '\nSELECT c["id"], t AS tag\nFROM c\nJOIN t IN c["tags"]\n',
        ],
        rejected: [
            'SELECT * FROM c JOIN t IN c.tags',
            'SELECT c.id, c.tags AS tag FROM c',
            'SELECT c.id, t AS tag FROM c JOIN tags t ON t.productId = c.id',
            'SELECT c.id, t AS tag FROM c LEFT JOIN t IN c.tags',
            'SELECT DISTINCT c.id, t AS tag FROM c JOIN t IN c.tags',
            'SELECT TOP 1 c.id, t AS tag FROM c JOIN t IN c.tags',
            'SELECT c.id, t FROM c JOIN t IN c.tags',
            'SELECT c.id, t AS Tag FROM c JOIN t IN c.tags',
            'SELECT c.id AS Id, t AS tag FROM c JOIN t IN c.tags',
            'SELECT c.Id, t AS tag FROM c JOIN t IN c.tags',
            'SELECT c["ID"], t AS tag FROM c JOIN t IN c["tags"]',
            'SELECT c.id, t AS tag FROM c JOIN t IN c.Tags',
            'SELECT c.id, T AS tag FROM c JOIN t IN c.tags',
            'SELECT c.id, t AS tag FROM C JOIN t IN c.tags',
            'SELECT c.id, t AS tag FROM c JOIN t IN c.tags WHERE t != ""',
        ],
    },
    {
        name: 'product-eco-tags',
        accepted: [
            'SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE StartsWith(t, "eco", true)) AS matchingTags FROM c',
            "select c.id as id, array(select value t from t in c.tags where startswith(t, 'ECO', true)) as matchingTags from c",
            '\nSELECT c["id"], ARRAY(\nSELECT VALUE t FROM t IN c["tags"]\nWHERE StartsWith(t, "eco", true)\n) AS matchingTags FROM c\n',
        ],
        rejected: [
            'SELECT c.id, t AS matchingTags FROM c JOIN t IN c.tags WHERE StartsWith(t, "eco", true)',
            'SELECT c.id, ARRAY(SELECT t FROM t IN c.tags WHERE StartsWith(t, "eco", true)) AS matchingTags FROM c',
            'SELECT c.id, ARRAY(SELECT DISTINCT VALUE t FROM t IN c.tags WHERE StartsWith(t, "eco", true)) AS matchingTags FROM c',
            'SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE StartsWith(t, "eco")) AS matchingTags FROM c',
            'SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE StartsWith(t, "eco", false)) AS matchingTags FROM c',
            'SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE StartsWith(t, "eco", "true")) AS matchingTags FROM c',
            'SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE Contains(t, "eco", true)) AS matchingTags FROM c',
            "SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE t ILIKE 'eco%') AS matchingTags FROM c",
            'SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE StartsWith(t, "eco", true)) AS matchingTags FROM c WHERE ARRAY_LENGTH(c.tags) > 0',
            'SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE StartsWith(t, "eco", true)) AS matchingtags FROM c',
            'SELECT c.Id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE StartsWith(t, "eco", true)) AS matchingTags FROM c',
            'SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c["Tags"] WHERE StartsWith(t, "eco", true)) AS matchingTags FROM c',
            'SELECT c.id, ARRAY(SELECT VALUE T FROM t IN c.tags WHERE StartsWith(t, "eco", true)) AS matchingTags FROM c',
        ],
    },
    {
        name: 'product-availability',
        accepted: [
            'SELECT VALUE {"id": c.id, "availability": c.inStock ? "available" : "unavailable"} FROM c',
            "select value {'availability': c.inStock ? 'available' : 'unavailable', 'id': c.id} from c",
            '\nSELECT VALUE {\n"id": c["id"],\n"availability": (c["inStock"] = true) ? "available" : "unavailable"\n} FROM c\n',
            'SELECT VALUE {id: c.id, availability: c.inStock = true ? "available" : "unavailable"} FROM c',
        ],
        rejected: [
            'SELECT {"id": c.id, "availability": c.inStock ? "available" : "unavailable"} FROM c',
            'SELECT VALUE {"id": c.id, "availability": CASE WHEN c.inStock THEN "available" ELSE "unavailable" END} FROM c',
            'SELECT VALUE {"id": c.id, "availability": c.inStock ? "unavailable" : "available"} FROM c',
            'SELECT VALUE {"id": c.id, "availability": c.inStock ? "Available" : "unavailable"} FROM c',
            'SELECT VALUE {"id": c.id, "availability": c.inStock ? "available" : "Unavailable"} FROM c',
            'SELECT VALUE {"ID": c.id, "availability": c.inStock ? "available" : "unavailable"} FROM c',
            'SELECT VALUE {"id": c.id, "Availability": c.inStock ? "available" : "unavailable"} FROM c',
            'SELECT VALUE {"id": c.id, "availability": c.instock ? "available" : "unavailable"} FROM c',
            'SELECT VALUE {"id": c.id, "availability": c["Instock"] ? "available" : "unavailable"} FROM c',
            'SELECT VALUE {"id": c.id, "availability": c.inStock ? "available" : "unavailable"} FROM c WHERE c.inStock',
            'SELECT VALUE {"id": c.id, "availability": c.inStock ? "available" : "unavailable", "name": c.name} FROM c',
            'SELECT VALUE {"id": c.id, "availability": c.inStock ? "available" : "unavailable"} AS product FROM c',
            'SELECT VALUE {"id": c.id, "availability": (c.inStock ? "available" : "unavailable"} FROM c',
            'SELECT VALUE {"id": c.id, "availability": c.inStock) ? "available" : "unavailable"} FROM c',
            'SELECT VALUE {"id": c.id, "availability": c.inStock ? "available\' : "unavailable"} FROM c',
        ],
    },
];

const explainCases = [
    {
        name: 'explain-product-tag-rows',
        generation: 'product-tag-rows',
        output:
            'JOIN expands the tags array within each product, not another table, document, or container. ' +
            'Each tag element produces an object with the product id and a tag string. Duplicate tags produce ' +
            'duplicate results. Empty arrays produce no results. No query was executed or changed.',
        incorrectOutput:
            'This joins the products container to a separate tags table and returns one full product per match. ' +
            'Duplicate tags are removed and products with empty arrays are kept.',
        rubricTerms: ['not another table', 'duplicate tag', 'empty tags array'],
    },
    {
        name: 'explain-product-eco-tags',
        generation: 'product-eco-tags',
        output:
            'Each product produces one object with id and a nested matchingTags array. ARRAY collects the ' +
            'correlated subquery results, and SELECT VALUE t makes each element a string rather than an object. ' +
            'StartsWith matches the eco prefix case-insensitively because its third argument is true. ' +
            'Products with no matches, including empty tags arrays, remain with an empty matchingTags array. ' +
            'Duplicate matching strings are preserved. No query was executed or changed.',
        incorrectOutput:
            'This returns one row per matching tag and removes products with no matches. ' +
            'The true flag makes the substring search case-sensitive, and matchingTags contains objects wrapping t.',
        rubricTerms: ['one object per product', 'tag strings', 'case-insensitive', 'empty array', 'duplicate'],
    },
    {
        name: 'explain-selected-product-availability',
        generation: 'product-availability',
        output:
            'The selected query returns one constructed object per product with id and availability directly, ' +
            'without an extra wrapper or other product fields. The ternary returns available for Boolean true ' +
            'inStock and unavailable for false. Both groups remain: it computes a label, not a filter. ' +
            'The unselected array JOIN does not expand these results. No query was executed or changed.',
        incorrectOutput:
            'The selected query expands tags and filters out out-of-stock products. SELECT VALUE wraps the ' +
            'entire product, and the conditional returns unavailable when inStock is true.',
        rubricTerms: ['selected activeQuery', 'without an extra wrapper', 'Boolean true', 'rather than filtering'],
    },
];

async function grade(stimulus, output, events = completedEvents, options = {}) {
    const trajectory = {
        id: 'grader-test',
        stimulus,
        output,
        events,
        metrics: computeMetrics(events),
        workDir: import.meta.dirname,
        metadata: {
            model: 'offline',
            executor: 'test',
            sessionID: 'test',
            skillsLoaded: stimulus.tags.feature === 'generate' ? [skillName] : [bestPracticesSkillName],
        },
    };
    const result = await gradeTrajectory(trajectory, stimulus.graders, {
        ...options,
        stimulus,
        weights: spec.scoring.weights,
    });
    assert.notEqual(result.status, 'error', result.evidence);
    return { result, passed: resolveGradePass(result, spec.scoring.threshold) };
}

test('the suite has exactly three paired generate/explain prompts and requires every grader to pass', () => {
    assert.deepEqual(
        spec.stimuli.map((stimulus) => stimulus.name),
        [...cases, ...explainCases].map((entry) => entry.name),
    );
    assert.equal(cases.length, 3);
    assert.equal(explainCases.length, 3);
    assert.deepEqual(
        explainCases.map((entry) => entry.generation),
        cases.map((entry) => entry.name),
    );
    assert.equal(spec.scoring.threshold, 1);
});

test('the suite pins a lower-cost GPT executor model and a mid-range GPT judge model', () => {
    assert.equal(spec.defaults.executor, 'copilot-sdk');
    assert.equal(spec.defaults.model, 'gpt-5.6-luna');
    assert.equal(spec.defaults.judge_model, 'gpt-5.6-terra');
});

test('skills are scoped by directory, with best practices available but not required for explain', async () => {
    assert.deepEqual(spec.environment?.skills ?? [], []);
    for (const stimulus of spec.stimuli) {
        if (stimulus.tags.feature === 'generate') {
            assert.deepEqual(stimulus.environment.skills, [`../../skills/${skillName}`]);
            assert.ok(stimulus.prompt.includes(skillName));
        } else {
            assert.deepEqual(stimulus.environment.skills, [`../../skills/${bestPracticesSkillName}`]);
            assert.ok(!stimulus.prompt.includes(skillName));
            assert.ok(!stimulus.prompt.includes(bestPracticesSkillName));
            assert.ok(!stimulus.graders.some((grader) => grader.type === 'skill-invocation'));
        }
        for (const skill of stimulus.environment.skills) {
            const content = await readFile(new URL(`${skill}/SKILL.md`, import.meta.url), 'utf8');
            assert.ok(content.startsWith('---'));
        }
    }
});

test('the synthetic schema defines required Boolean availability and possibly empty string arrays', async () => {
    const schema = JSON.parse(await readFile(new URL('./fixtures/products.schema.json', import.meta.url), 'utf8'));
    assert.deepEqual(schema.properties.inStock, { type: 'boolean' });
    assert.deepEqual(schema.properties.tags, { type: 'array', items: { type: 'string' } });
    assert.ok(schema.required.includes('inStock'));
    assert.ok(schema.required.includes('tags'));
});

test('the default trial workspace does not implicitly include repository skills', async () => {
    const workspace = await materializeWorkspace(spec.environment, import.meta.dirname);
    try {
        assert.deepEqual(await readdir(workspace.workDir), ['products.schema.json']);
    } finally {
        await workspace.cleanup();
    }
});

test('explain stages the whole best-practices directory, including supplementary files', async () => {
    const stimulus = spec.stimuli.find((candidate) => candidate.tags.feature === 'explain');
    const workspace = await materializeWorkspace({ ...spec.environment, ...stimulus.environment }, import.meta.dirname);
    try {
        assert.deepEqual((await readdir(workspace.workDir)).sort(), [bestPracticesSkillName, 'products.schema.json']);
        const source = fileURLToPath(new URL(`../../skills/${bestPracticesSkillName}`, import.meta.url));
        const staged = join(workspace.workDir, bestPracticesSkillName);
        const entries = (await readdir(source, { recursive: true })).sort();
        assert.deepEqual((await readdir(staged, { recursive: true })).sort(), entries);
        const markdownFiles = entries.filter((entry) => entry.endsWith('.md'));
        assert.ok(markdownFiles.length > 1, 'Expected supplementary guidance alongside SKILL.md');
        for (const entry of markdownFiles) {
            assert.equal(await readFile(join(staged, entry), 'utf8'), await readFile(join(source, entry), 'utf8'));
        }
    } finally {
        await workspace.cleanup();
    }
});

for (const entry of cases) {
    const stimulus = spec.stimuli.find((candidate) => candidate.name === entry.name);
    assert.ok(stimulus, `Missing stimulus: ${entry.name}`);

    for (const output of entry.accepted.flatMap((query) => queryFormats.map((format) => format(query)))) {
        test(`${entry.name} accepts ${JSON.stringify(output)}`, async () => {
            const { result, passed } = await grade(stimulus, output);
            assert.equal(passed, true, result.evidence);
            assert.equal(result.score, 1);
        });
    }

    const reference = entry.accepted[0];
    const rejectedQueries = [
        ...entry.rejected,
        '',
        'ERROR: Cannot generate a query.',
        `Here is your query:\n${reference}`,
        `${reference}\nHere is your query.`,
        `-- Query\n${reference}`,
        `${reference} /* Query */`,
        `${reference}\nSELECT * FROM c`,
        `${reference}; DROP TABLE c`,
    ];
    const fencedReference = `\`\`\`sql\n${reference}\n\`\`\``;
    const rejected = [
        ...rejectedQueries.flatMap((query) => queryFormats.map((format) => format(query))),
        `\`\`\`sql\n${reference}`,
        `\`\`\`\n${reference}`,
        `${reference}\n\`\`\``,
        `\`\`\`sql ${reference}\n\`\`\``,
        `\`\`\`sql\n${reference}\`\`\``,
        `\`\`\`sql\n${reference}\n\`\``,
        `\`\`\`sql\n${reference}\n\`\`\`\``,
        `\`\`\`\`sql\n${reference}\n\`\`\`\``,
        `\`\`\`javascript\n${reference}\n\`\`\``,
        `Here is your query:\n${fencedReference}`,
        `${fencedReference}\nHere is your query.`,
        `${fencedReference}\n${fencedReference}`,
        `${fencedReference}\nSELECT * FROM c`,
        `SELECT * FROM c\n${fencedReference}`,
        `\`\`\`sql\n${fencedReference}\n\`\`\``,
    ];
    for (const output of rejected) {
        test(`${entry.name} rejects ${JSON.stringify(output)}`, async () => {
            const { result, passed } = await grade(stimulus, output);
            assert.equal(passed, false, result.evidence);
            assert.ok(result.score < spec.scoring.threshold);
        });
    }

    for (const output of [reference, fencedReference]) {
        test(`${entry.name} rejects ${JSON.stringify(output)} when the skill was not invoked`, async () => {
            const { passed } = await grade(
                stimulus,
                output,
                completedEvents.filter((event) => event.type !== 'skill_activation'),
            );
            assert.equal(passed, false);
        });

        test(`${entry.name} rejects ${JSON.stringify(output)} from an incomplete session`, async () => {
            const { passed } = await grade(
                stimulus,
                output,
                completedEvents.filter((event) => event.type !== 'turn_end'),
            );
            assert.equal(passed, false);
        });

        test(`${entry.name} rejects ${JSON.stringify(output)} when the session reports an error`, async () => {
            const { passed } = await grade(stimulus, output, [
                ...completedEvents,
                { type: 'error', data: { message: 'Synthetic executor failure' } },
            ]);
            assert.equal(passed, false);
        });
    }
}

for (const entry of explainCases) {
    const stimulus = spec.stimuli.find((candidate) => candidate.name === entry.name);
    assert.ok(stimulus, `Missing stimulus: ${entry.name}`);

    test(`${entry.name} requires semantic grading with a strict rubric`, () => {
        assert.equal(stimulus.tags.feature, 'explain');
        assert.ok(stimulus.rubric.length >= 4);
        assert.deepEqual(
            stimulus.graders.map((grader) => grader.type),
            ['completed', 'prompt'],
        );
        const judgeConfig = stimulus.graders.find((grader) => grader.type === 'prompt').config;
        assert.equal(judgeConfig.scoring, 'binary');
        assert.equal(judgeConfig.threshold, 1);
        for (const term of entry.rubricTerms) {
            assert.ok(
                stimulus.rubric.some((criterion) => criterion.includes(term)),
                `Missing rubric coverage: ${term}`,
            );
        }
    });

    test(`${entry.name} explains its paired query from synthetic editor context`, () => {
        const contextJson = stimulus.prompt.match(/\n(\{[\s\S]*?\n\})\n/)?.[1];
        assert.ok(contextJson, 'Missing synthetic editor context');
        const context = JSON.parse(contextJson);
        const generation = cases.find((candidate) => candidate.name === entry.generation);
        assert.equal(context.activeQuery, generation.accepted[0]);
        assert.equal(context.activeQuery, context.selectedQuery ?? context.currentQuery);
        if (entry.name === 'explain-selected-product-availability') {
            assert.ok(context.selectedQuery);
            assert.notEqual(context.currentQuery, context.selectedQuery);
            assert.ok(context.currentQuery.includes('JOIN'));
        }
    });

    for (const scenario of [
        {
            name: 'passes without skill activation when the judge accepts every criterion',
            score: 1,
            events: explainCompletedEvents,
            passed: true,
        },
        {
            name: 'fails when the judge rejects the explanation',
            score: 0,
            events: explainCompletedEvents,
            passed: false,
        },
        { name: 'also allows optional best-practices activation', score: 1, events: explainSkillEvents, passed: true },
        {
            name: 'fails without session completion even when the judge accepts',
            score: 1,
            events: [],
            passed: false,
        },
        {
            name: 'fails on a session error even when the judge accepts',
            score: 1,
            events: [...explainCompletedEvents, { type: 'error', data: { message: 'Synthetic executor failure' } }],
            passed: false,
        },
    ]) {
        test(`${entry.name} ${scenario.name}`, async () => {
            let judgeCalls = 0;
            const output = scenario.score === 0 ? entry.incorrectOutput : entry.output;
            // Stub only the model verdict; exercise Vally's real evidence delivery, grader, and scoring.
            const registry = createDefaultGraderRegistry({
                supportsWorkspaceDelivery: true,
                async judge(options) {
                    judgeCalls++;
                    for (const criterion of stimulus.rubric) {
                        assert.ok(options.userMessage.includes(criterion));
                    }
                    const evidence = await Promise.all(
                        options.workspace.evidenceFiles.map((file) => readFile(file, 'utf8')),
                    );
                    assert.ok(evidence.some((content) => content.includes(output)));
                    return {
                        args: {
                            rubric_scores: stimulus.rubric.map((criterion) => ({
                                criterion,
                                score: scenario.score,
                                reasoning: 'Synthetic verdict for offline wiring validation.',
                            })),
                            overall_score: scenario.score,
                            overall_reasoning: 'Synthetic verdict for offline wiring validation.',
                        },
                        latencyMs: 0,
                        remindersUsed: 0,
                    };
                },
            });
            const { result, passed } = await grade(stimulus, output, scenario.events, { registry });
            assert.equal(judgeCalls, 1);
            assert.equal(passed, scenario.passed, result.evidence);
        });
    }
}
