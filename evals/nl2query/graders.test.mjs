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
    'Generate query: array membership': {
        accepted: [
            'SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, "eco")',
            "select p.id, p.name from p where array_contains(p.tags, 'eco')",
            'SELECT VALUE Product FROM Product\nWHERE Array_Contains(Product["tags"], "eco")',
        ],
        rejected: [
            'SELECT * FROM c',
            'SELECT * FROM c WHERE ARRAY_CONTAINS(c.name, "eco")',
            'SELECT * FROM c WHERE ARRAY_CONTAINS(c.Tags, "eco")',
            'SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, "ECO")',
            'SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, "eco-friendly")',
            'SELECT * FROM c WHERE CONTAINS(c.tags, "eco")',
            'SELECT * FROM c WHERE NOT ARRAY_CONTAINS(c.tags, "eco")',
            'SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, "eco") = false',
            'SELECT ARRAY_CONTAINS(c.tags, "eco") FROM c WHERE c.inStock = true',
            'SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, "eco") OR true',
        ],
    },
    'Generate query: case-insensitive prefix': {
        accepted: [
            'SELECT * FROM c WHERE STARTSWITH(c.name, "eco", true)',
            "select p.id, p.name from p where startswith(p.name, 'ECO', true)",
            'SELECT VALUE Product FROM Product\nWHERE StartsWith(Product["name"], "EcO", true)',
        ],
        rejected: [
            'SELECT * FROM c',
            'SELECT * FROM c WHERE STARTSWITH(c.tags, "eco", true)',
            'SELECT * FROM c WHERE STARTSWITH(c.Name, "eco", true)',
            'SELECT * FROM c WHERE STARTSWITH(c.name, "eco-friendly", true)',
            'SELECT * FROM c WHERE STARTSWITH(c.name, "eco")',
            'SELECT * FROM c WHERE STARTSWITH(c.name, "eco", false)',
            'SELECT * FROM c WHERE CONTAINS(c.name, "eco", true)',
            'SELECT * FROM c WHERE NOT STARTSWITH(c.name, "eco", true)',
            'SELECT * FROM c WHERE STARTSWITH(c.name, "eco", true) = false',
            'SELECT STARTSWITH(c.name, "eco", true) FROM c WHERE c.inStock = true',
            'SELECT * FROM c WHERE STARTSWITH(c.name, "eco", true) OR true',
        ],
    },
    'Generate query: ambiguous SQL request': {
        accepted: [
            'SELECT * FROM c WHERE STARTSWITH(c.name, "eco", true)',
            "select p.id, p.name from products p where startswith(p.name, 'ECO', true)",
        ],
        rejected: [
            "SELECT * FROM products WHERE name ILIKE 'eco%'",
            "select * from products p where p.name ilike 'eco%'",
            "SELECT * FROM products WHERE name LIKE 'eco%'",
            'SELECT * FROM c WHERE STARTSWITH(c.name, "eco")',
            'SELECT * FROM c WHERE STARTSWITH(c.name, "eco", false)',
            'SELECT * FROM c WHERE STARTSWITH(c.name, "eco%", true)',
            'SELECT * FROM c WHERE STARTSWITH(c.Name, "eco", true)',
            'SELECT * FROM c WHERE NOT STARTSWITH(c.name, "eco", true)',
            'SELECT c.name ILIKE \'eco%\' FROM c WHERE STARTSWITH(c.name, "eco", true)',
            'ERROR: SQL queries are not supported.',
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

test('ambiguous SQL prompt requests SQL without dialect or syntax hints', () => {
    const stimulus = spec.stimuli.find((candidate) => candidate.tags.scenario === 'ambiguous-sql-request');
    assert.ok(stimulus);
    assert.match(stimulus.prompt, /Write a SQL query/);
    const request = stimulus.prompt.replace('Use the cosmosdb-nosql-query-generation skill.', '');
    assert.doesNotMatch(
        request,
        /\b(?:PostgreSQL|MySQL|T-SQL|SQL Server|Cosmos|NoSQL|ILIKE|LIKE|SELECT|STARTSWITH)\b/i,
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
        reference.replace('WHERE', '/* filter */ WHERE'),
        reference.replace('WHERE', '-- filter\nWHERE'),
        `${reference}\nThis query filters products.`,
        `${reference}\nSELECT * FROM c`,
        `${reference};\n${reference}`,
        `${reference}\n${reference}`,
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
