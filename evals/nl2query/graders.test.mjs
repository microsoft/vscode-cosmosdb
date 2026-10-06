/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    computeMetrics,
    createDefaultGraderRegistry,
    gradeTrajectory,
    loadEvalSpec,
    resolveGradePass,
} from '@microsoft/vally';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const spec = await loadEvalSpec(fileURLToPath(new URL('./eval.yaml', import.meta.url)));
const skillName = 'cosmosdb-nosql-query-generation';
const completedEvents = [
    { type: 'skill_activation', data: { name: skillName, path: skillName } },
    { type: 'turn_end', data: { turnId: 'test-turn' } },
];
const explainCompletedEvents = completedEvents.filter((event) => event.type !== 'skill_activation');

const queryFormats = [
    (query) => query,
    (query) => `\`\`\`sql\n${query}\n\`\`\``,
    (query) => `\`\`\`\n${query}\n\`\`\``,
    (query) => ` \r\n\`\`\`sql \t\r\n${query.replace(/\r?\n/g, '\r\n')}\r\n \`\`\`\r\n`,
];

const cases = [
    {
        name: 'filter-and-sort-products',
        accepted: [
            'SELECT * FROM c WHERE c.price > 100 ORDER BY c.price ASC',
            'select * from c where c.price > 100 order by c.price',
            '\nSELECT *\nFROM c\nWHERE c["price"] > 100.0\nORDER BY c["price"] ASC\n',
        ],
        rejected: [
            'SELECT * FROM c WHERE c.price >= 100 ORDER BY c.price ASC',
            'SELECT * FROM c WHERE c.price > 100 ORDER BY c.price DESC',
            'SELECT * FROM c WHERE c.price > 100',
            'SELECT TOP 10 * FROM c WHERE c.price > 100 ORDER BY c.price',
            'SELECT c.name FROM c WHERE c.price > 100 ORDER BY c.price',
            'SELECT * FROM c WHERE c.cost > 100 ORDER BY c.cost',
            'SELECT * FROM c WHERE c.Price > 100 ORDER BY c.price',
            'SELECT * FROM c WHERE c.price > 100 ORDER BY c.Price',
            'SELECT * FROM c WHERE c["Price"] > 100 ORDER BY c["price"]',
            'SELECT * FROM C WHERE c.price > 100 ORDER BY c.price',
        ],
    },
    {
        name: 'count-in-stock-products',
        accepted: [
            'SELECT VALUE COUNT(1) FROM c WHERE c.inStock = true',
            'select value count( 1 ) from c where c.inStock=true',
            '\nSELECT VALUE COUNT(1)\nFROM c\nWHERE c["inStock"] = true\n',
            'SELECT VALUE COUNT(1) FROM c WHERE c.inStock',
        ],
        rejected: [
            'SELECT COUNT(1) FROM c WHERE c.inStock = true',
            'SELECT VALUE COUNT(*) FROM c WHERE c.inStock = true',
            'SELECT VALUE COUNT(c) FROM c WHERE c.inStock = true',
            'SELECT VALUE COUNT(1) AS count FROM c WHERE c.inStock = true',
            'SELECT VALUE COUNT(1) FROM c WHERE c.inStock = false',
            'SELECT VALUE COUNT(1) FROM c WHERE c.inStock = "true"',
            'SELECT VALUE COUNT(1) FROM c WHERE c.inStock == true',
            'SELECT VALUE COUNT(1) FROM c WHERE c.instock = true',
            'SELECT VALUE COUNT(1) FROM c WHERE c["Instock"] = true',
            'SELECT VALUE COUNT(1) FROM c',
            'SELECT VALUE COUNT(1) FROM C WHERE C.inStock = true',
        ],
    },
];

const explainCases = [
    {
        name: 'explain-filter-and-sort-products',
        output:
            'Returns complete product documents with price strictly greater than 100, excluding 100 itself, ' +
            'ordered by price from lowest to highest. This explanation does not execute or change the query.',
    },
    {
        name: 'explain-selected-in-stock-count',
        output:
            'The selected active query counts product documents whose inStock property is boolean true. ' +
            'SELECT VALUE returns a single scalar number, not documents or an object. If none match, it returns 0. ' +
            'The unselected price query does not affect this count. No query was executed or changed.',
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
            skillsLoaded: stimulus.tags.feature === 'generate' ? [skillName] : [],
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

test('the suite has exactly the four tested prompts and requires every grader to pass', () => {
    assert.deepEqual(
        spec.stimuli.map((stimulus) => stimulus.name),
        [...cases, ...explainCases].map((entry) => entry.name),
    );
    assert.equal(spec.scoring.threshold, 1);
});

test('only generation stimuli load and request the query-generation skill', () => {
    assert.deepEqual(spec.environment?.skills ?? [], []);
    for (const stimulus of spec.stimuli) {
        if (stimulus.tags.feature === 'generate') {
            assert.deepEqual(stimulus.environment.skills, [`../../skills/${skillName}`]);
            assert.ok(stimulus.prompt.includes(skillName));
        } else {
            assert.deepEqual(stimulus.environment?.skills ?? [], []);
            assert.ok(!stimulus.prompt.includes(skillName));
        }
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
        { name: 'also allows optional skill activation', score: 1, events: completedEvents, passed: true },
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
                    assert.ok(evidence.some((content) => content.includes(entry.output)));
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
            const { result, passed } = await grade(stimulus, entry.output, scenario.events, { registry });
            assert.equal(judgeCalls, 1);
            assert.equal(passed, scenario.passed, result.evidence);
        });
    }
}
