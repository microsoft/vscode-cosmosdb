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
const skillActivated = { type: 'skill_activation', data: { name: 'cosmosdb-nosql-query-generation' } };
const turnEnd = { type: 'turn_end', data: { turnId: 'test-turn' } };
const sessionError = { type: 'error', data: { message: 'Synthetic executor failure' } };

const queryFormats = [(query) => query, (query) => ` \r\n${query.replace(/\r?\n/g, '\r\n')}\r\n\t`];

const markdownQueryFormats = [
    (query) => `\`\`\`sql\n${query}\n\`\`\``,
    (query) => `\`\`\`\n${query}\n\`\`\``,
    (query) => ` \r\n\`\`\`sql \t\r\n${query.replace(/\r?\n/g, '\r\n')}\r\n \`\`\`\r\n`,
    (query) => `\`${query}\``,
    (query) => `~~~\n${query}\n~~~`,
];

const generateCases = {
    'Generate query: product tag rows': {
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
            'SELECT c.Id, t AS tag FROM c JOIN t IN c.tags',
            'SELECT c.id, t AS tag FROM c JOIN t IN c.Tags',
            'SELECT c.id, T AS tag FROM c JOIN t IN c.tags',
            'SELECT c.id, t AS tag FROM C JOIN t IN c.tags',
            'SELECT c.id, t AS tag FROM c JOIN t IN c.tags WHERE t != ""',
        ],
    },
    'Generate query: product eco tags': {
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
            'SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE Contains(t, "eco", true)) AS matchingTags FROM c',
            'SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE StartsWith(t, "eco", true)) AS matchingTags FROM c WHERE ARRAY_LENGTH(c.tags) > 0',
            'SELECT c.id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE StartsWith(t, "eco", true)) AS matchingtags FROM c',
            'SELECT c.Id, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE StartsWith(t, "eco", true)) AS matchingTags FROM c',
            'SELECT c.id, ARRAY(SELECT VALUE T FROM t IN c.tags WHERE StartsWith(t, "eco", true)) AS matchingTags FROM c',
        ],
    },
    'Generate query: product availability': {
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
            'SELECT VALUE {"ID": c.id, "availability": c.inStock ? "available" : "unavailable"} FROM c',
            'SELECT VALUE {"id": c.id, "availability": c.instock ? "available" : "unavailable"} FROM c',
            'SELECT VALUE {"id": c.id, "availability": c.inStock ? "available" : "unavailable"} FROM c WHERE c.inStock',
            'SELECT VALUE {"id": c.id, "availability": c.inStock ? "available" : "unavailable", "name": c.name} FROM c',
            'SELECT VALUE {"id": c.id, "availability": (c.inStock ? "available" : "unavailable"} FROM c',
        ],
    },
};

async function grade(stimulus, output, events, registry) {
    const trajectory = {
        id: 'grader-test',
        stimulus,
        output,
        events,
        metrics: computeMetrics(events),
        workDir: import.meta.dirname,
        metadata: { model: 'offline', executor: 'test', sessionID: 'test' },
    };
    const result = await gradeTrajectory(trajectory, stimulus.graders, {
        registry,
        stimulus,
        weights: spec.scoring.weights,
    });
    assert.notEqual(result.status, 'error', result.evidence);
    return { result, passed: resolveGradePass(result, spec.scoring.threshold) };
}

test('every stimulus has offline coverage', () => {
    const explain = spec.stimuli.filter((stimulus) => stimulus.tags.feature === 'explain').map((s) => s.name);
    assert.deepEqual(
        spec.stimuli.map((stimulus) => stimulus.name),
        [...Object.keys(generateCases), ...explain],
    );
});

for (const [name, { accepted, rejected }] of Object.entries(generateCases)) {
    const stimulus = spec.stimuli.find((candidate) => candidate.name === name);
    const events = [skillActivated, turnEnd];
    const reference = accepted[0];

    for (const output of accepted.flatMap((query) => queryFormats.map((format) => format(query)))) {
        test(`${name} accepts ${JSON.stringify(output)}`, async () => {
            const { result, passed } = await grade(stimulus, output, events);
            assert.equal(passed, true, result.evidence);
        });
    }

    const badOutputs = [
        ...rejected.flatMap((query) => queryFormats.map((format) => format(query))),
        ...accepted.flatMap((query) => markdownQueryFormats.map((format) => format(query))),
        '',
        `Here is your query:\n${reference}`,
        `-- Query\n${reference}`,
        `${reference}\nSELECT * FROM c`,
        `\`\`\`sql\n${reference}`,
        `\`\`\`javascript\n${reference}\n\`\`\``,
    ];
    for (const output of badOutputs) {
        test(`${name} rejects ${JSON.stringify(output)}`, async () => {
            const { result, passed } = await grade(stimulus, output, events);
            assert.equal(passed, false, result.evidence);
        });
    }

    for (const [reason, badEvents] of [
        ['without skill activation', [turnEnd]],
        ['from an incomplete session', [skillActivated]],
        ['after a session error', [skillActivated, turnEnd, sessionError]],
    ]) {
        test(`${name} rejects a correct query ${reason}`, async () => {
            assert.equal((await grade(stimulus, reference, badEvents)).passed, false);
        });
    }
}

// The judge is stubbed, so these tests only check that the explanation and rubric reach the judge and that its
// verdict decides the result. Whether the judge grades accurately is covered by the live evaluation.
for (const stimulus of spec.stimuli.filter((candidate) => candidate.tags.feature === 'explain')) {
    const output = 'A synthetic explanation.';

    for (const [scenario, verdict, events, expected] of [
        ['passes when the judge accepts', 1, [turnEnd], true],
        ['fails when the judge rejects', 0, [turnEnd], false],
        ['fails from an incomplete session', 1, [], false],
        ['fails after a session error', 1, [turnEnd, sessionError], false],
    ]) {
        test(`${stimulus.name} ${scenario}`, async () => {
            const registry = createDefaultGraderRegistry({
                supportsWorkspaceDelivery: true,
                async judge({ userMessage, workspace }) {
                    for (const criterion of stimulus.rubric) {
                        assert.ok(userMessage.includes(criterion));
                    }
                    const evidence = await Promise.all(workspace.evidenceFiles.map((file) => readFile(file, 'utf8')));
                    assert.ok(evidence.some((content) => content.includes(output)));
                    return {
                        args: {
                            rubric_scores: stimulus.rubric.map((criterion) => ({
                                criterion,
                                score: verdict,
                                reasoning: 'Synthetic verdict.',
                            })),
                            overall_score: verdict,
                            overall_reasoning: 'Synthetic verdict.',
                        },
                        latencyMs: 0,
                        remindersUsed: 0,
                    };
                },
            });
            const { result, passed } = await grade(stimulus, output, events, registry);
            assert.equal(passed, expected, result.evidence);
        });
    }
}
