/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { buildJudgeEvidence, judgeEvidenceGroups, MAX_EVIDENCE_BYTES } from './adventureworks/judge-evidence.mjs';
import { createAdventureWorksJudge } from './adventureworks/judge.mjs';

const migration = '.cosmosdb-migration/';
const rubric = ['Preserve source identity and generate a plan without applying changes.'];
const config = { model: 'offline-judge', reasoning_effort: 'high', scoring: 'binary', threshold: 1 };
const stimulus = (phase) => ({
    name: `offline-${phase}`,
    prompt: 'Evaluate the phase.',
    tags: { phase, ...(phase === 'inferred-ddl' ? { scenario: phase } : {}) },
    rubric,
});
const validation = { passed: true, scope: 'Synthetic structural verdict for delivery testing only' };

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'migration-judge-evidence-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const write = (path, content) => {
        const file = join(root, 'app', path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    };
    write(`${migration}project.json`, {
        version: 1,
        name: 'sample',
        customMetadata: { preserve: true },
        phases: { schemaConversion: { domains: ['Catalog'] } },
        freshness: { largeHistory: 'not semantic evidence' },
    });
    for (const path of [
        'AdventureWorks.Web.csproj',
        'Startup.cs',
        'Controllers/ProductsController.cs',
        'Models/sampledbContext.cs',
    ]) {
        write(path, `Synthetic source: ${path}`);
    }
    for (const path of [
        '1-discovery/preflight-summary.md',
        '1-discovery/volumetrics/volumetrics.md',
        '1-discovery/access-patterns/access-patterns.md',
        '1-discovery/discovery-report.md',
        '2-assessment/assessment-summary.md',
        '2-assessment/domains/Catalog.md',
        '3-schema-conversion/summary.md',
        '3-schema-conversion/domains/Catalog/summary.md',
        '4-provisioning/main.bicep',
        '4-provisioning/main.bicepparam',
        '4-provisioning/seed-data.csh',
        '4-provisioning/summary.md',
    ])
        write(`${migration}phases/${path}`, `Complete evidence: ${path}\n`);
    for (const path of [
        '1-discovery/preflight-manifest.json',
        '1-discovery/volumetrics/workload.json',
        '1-discovery/discovery-manifest.json',
        '2-assessment/assessment-manifest.json',
        '2-assessment/domains/Catalog.manifest.json',
        '3-schema-conversion/model.json',
        '3-schema-conversion/manifest.json',
        '4-provisioning/sample-data.json',
    ])
        write(`${migration}phases/${path}`, { synthetic: true, path });
    write(`${migration}phases/1-discovery/schema-ddl/Example.sql`, 'CREATE TABLE Example (Id INT PRIMARY KEY);');
    write(`${migration}code-migration-plan.md`, 'Plan detail.\n'.repeat(6500) + 'FINAL ROLLBACK OBLIGATION\n');
    write(`${migration}code-migration-manifest.json`, { mode: 'plan' });
    write('.env', 'DO NOT DELIVER');
    write('wwwroot/large.js', 'UNRELATED UI CONTENT');
    const trajectory = { id: 'offline', workDir: root, output: 'The phase is complete.', events: [] };
    return { root, write, trajectory };
}

test('every isolated phase receives only its selected evidence, not the repository or future outputs', (t) => {
    const { trajectory } = fixture(t);
    for (const phase of [
        'preflight',
        'discovery',
        'assessment',
        'schema-conversion',
        'provisioning',
        'code-migration',
        'inferred-ddl',
    ]) {
        const { packet, bytes } = buildJudgeEvidence(trajectory, stimulus(phase), validation);
        assert.ok(bytes <= MAX_EVIDENCE_BYTES);
        const paths = packet.files.map(({ path }) => path);
        assert.ok(paths.every((path) => !path.includes('.env') && !path.includes('wwwroot')));
        if (phase !== 'code-migration') assert.ok(!paths.some((path) => path.includes('code-migration-plan.md')));
        if (phase !== 'provisioning') assert.ok(!paths.some((path) => path.includes('4-provisioning')));
        if (['preflight', 'discovery', 'assessment', 'inferred-ddl'].includes(phase)) {
            assert.ok(!paths.some((path) => path.includes('3-schema-conversion')));
        }
    }
});

test('large plans remain complete and retain exact source hashes; JSON projections are explicit', (t) => {
    const { trajectory } = fixture(t);
    const { packet } = buildJudgeEvidence(trajectory, stimulus('code-migration'), validation);
    const plan = packet.files.find(({ path }) => path.endsWith('code-migration-plan.md'));
    assert.ok(plan.sourceBytes > 32_000);
    assert.ok(plan.content.endsWith('FINAL ROLLBACK OBLIGATION\n'));
    assert.equal(plan.sha256, createHash('sha256').update(plan.content).digest('hex'));
    const project = packet.files.find(({ path }) => path.endsWith('project.json'));
    assert.deepEqual(project.omittedProperties, ['freshness']);
    assert.deepEqual(JSON.parse(project.content).customMetadata, { preserve: true });
});

test('inference judge receives code and inventory without requiring synthesized DDL', (t) => {
    const { root, trajectory } = fixture(t);
    rmSync(join(root, 'app', migration, 'phases/1-discovery/schema-ddl'), { recursive: true });
    const { packet } = buildJudgeEvidence(trajectory, stimulus('inferred-ddl'), validation);
    assert.ok(packet.files.some(({ path }) => path.endsWith('Models/sampledbContext.cs')));
    assert.ok(packet.files.some(({ path }) => path.endsWith('preflight-manifest.json')));
    assert.ok(!packet.files.some(({ path }) => path.endsWith('.sql')));
    assert.throws(() => buildJudgeEvidence(trajectory, stimulus('preflight'), validation), /ENOENT/);
});

test('audit preserves commands and executable edits without duplicating migration patches or skill bodies', (t) => {
    const { trajectory } = fixture(t);
    trajectory.events = [
        { type: 'tool_call', data: { toolName: 'bash', arguments: { command: 'node validate.mjs --check' } } },
        { type: 'tool_result', data: { toolName: 'bash', success: false, result: 'large duplicated stdout' } },
        { type: 'skill_activation', data: { name: 'migration', content: 'LARGE SKILL INSTRUCTIONS' } },
        {
            type: 'tool_call',
            data: {
                toolName: 'apply_patch',
                arguments:
                    '*** Begin Patch\n*** Update File: app/.cosmosdb-migration/code-migration-plan.md\n+PLAN COPY\n*** End Patch',
            },
        },
        {
            type: 'tool_call',
            data: {
                toolName: 'apply_patch',
                arguments: '*** Begin Patch\n*** Add File: app/helper.py\n+print("execute")\n*** End Patch',
            },
        },
    ];
    const { packet } = buildJudgeEvidence(trajectory, stimulus('code-migration'), validation);
    assert.equal(packet.audit[0].arguments.command, 'node validate.mjs --check');
    assert.equal(packet.audit[1].success, false);
    assert.equal(packet.audit[2].content, undefined);
    assert.ok(packet.audit[2].contentSha256);
    assert.deepEqual(packet.audit[3].paths, ['app/.cosmosdb-migration/code-migration-plan.md']);
    assert.equal(packet.audit[3].arguments, undefined);
    assert.match(packet.audit[4].arguments, /print\("execute"\)/);
});

test('oversized, absent and unsafe evidence fail without truncation', async (t) => {
    const { root, write, trajectory } = fixture(t);
    write(`${migration}code-migration-plan.md`, 'é'.repeat(Math.floor(MAX_EVIDENCE_BYTES / 2) + 1));
    assert.throws(
        () => buildJudgeEvidence(trajectory, stimulus('code-migration'), validation),
        (error) => error.category === 'evidence-too-large' && /No content was truncated/.test(error.message),
    );
    rmSync(join(root, 'app', migration, 'code-migration-plan.md'));
    assert.throws(() => buildJudgeEvidence(trajectory, stimulus('code-migration'), validation), /ENOENT/);
    await t.test('rejects symlinks', { skip: process.platform === 'win32' }, () => {
        symlinkSync(join(root, 'app', '.env'), join(root, 'app', migration, 'code-migration-plan.md'));
        assert.throws(
            () => buildJudgeEvidence(trajectory, stimulus('code-migration'), validation),
            (error) => error.category === 'evidence-path',
        );
    });
});

function judgeFixture(t, options = {}) {
    const data = fixture(t);
    let calls = 0;
    let shutdowns = 0;
    const grader = createAdventureWorksJudge({
        sample: 'offline-source',
        checkSample() {},
        checkArtifacts: options.checkArtifacts ?? (() => {}),
        async createClient() {
            return {
                async judge(request) {
                    calls++;
                    assert.equal(request.model, config.model);
                    assert.equal(request.reasoningEffort, config.reasoning_effort);
                    assert.deepEqual(request.workspace.evidenceFiles, [], 'Judge must not browse files');
                    assert.deepEqual(readdirSync(request.workspace.workingDirectory), []);
                    const input = JSON.parse(request.userMessage);
                    assert.deepEqual(input.rubric, rubric);
                    assert.ok(
                        input.evidence.files.some(({ content }) => content.includes('FINAL ROLLBACK OBLIGATION')),
                    );
                    if (options.error) throw options.error;
                    return {
                        args: options.verdict ?? {
                            evidence_sufficient: true,
                            rubric_scores: rubric.map((criterion) => ({
                                criterion,
                                score: 1,
                                reasoning: 'Complete synthetic evidence.',
                            })),
                            overall_score: 1,
                            overall_reasoning: 'Complete synthetic evidence.',
                        },
                        latencyMs: 1,
                    };
                },
                async shutdown() {
                    shutdowns++;
                },
            };
        },
    });
    return {
        ...data,
        grade: () => grader.grade({ trajectory: data.trajectory, stimulus: stimulus('code-migration'), config }),
        counts: () => ({ calls, shutdowns }),
    };
}

test('bounded judge delivers complete inline evidence and preserves strict binary outcomes', async (t) => {
    const success = judgeFixture(t);
    const passed = await success.grade();
    assert.equal(passed.passed, true);
    assert.equal(passed.status, undefined);
    assert.ok(passed.metadata.evidence_packet.files.length);
    assert.deepEqual(success.counts(), { calls: 1, shutdowns: 1 });
    const failure = judgeFixture(t, {
        verdict: {
            evidence_sufficient: true,
            rubric_scores: rubric.map((criterion) => ({
                criterion,
                score: 0,
                reasoning: 'Required design is omitted.',
            })),
            overall_score: 0,
            overall_reasoning: 'Required design is omitted.',
        },
    });
    const rejected = await failure.grade();
    assert.equal(rejected.passed, false);
    assert.equal(rejected.status, undefined, 'Incorrect output is not an infrastructure error');
    assert.equal(rejected.score, 0);
});

test('missing evidence prevents model calls; judge timeouts are errors and still clean up', async (t) => {
    const missing = judgeFixture(t);
    rmSync(join(missing.root, 'app', migration, 'code-migration-plan.md'));
    const result = await missing.grade();
    assert.equal(result.status, 'error');
    assert.equal(result.metadata.error_category, 'evidence-unavailable');
    assert.deepEqual(missing.counts(), { calls: 0, shutdowns: 0 });
    const timeout = judgeFixture(t, { error: new Error('Judge timeout') });
    const timedOut = await timeout.grade();
    assert.equal(timedOut.status, 'error');
    assert.equal(timedOut.passed, false);
    assert.equal(timedOut.metadata.error_category, 'judge-unavailable');
    assert.deepEqual(timeout.counts(), { calls: 1, shutdowns: 1 });
});

test('incomplete evidence and missing rubric scores cannot become successful judgments', async (t) => {
    for (const [verdict, category] of [
        [
            {
                evidence_sufficient: false,
                rubric_scores: [],
                overall_score: 0,
                overall_reasoning: 'Cannot inspect required evidence.',
            },
            'judge-evidence-incomplete',
        ],
        [
            { evidence_sufficient: true, rubric_scores: [], overall_score: 1, overall_reasoning: 'Looks correct.' },
            'judge-invalid-response',
        ],
    ]) {
        const fixture = judgeFixture(t, { verdict });
        const result = await fixture.grade();
        assert.equal(result.status, 'error');
        assert.equal(result.metadata.error_category, category);
        assert.equal(result.score, 0);
    }
});

test('scoped evidence retains complete files and the audit in independently bounded packets', (t) => {
    const { write, trajectory } = fixture(t);
    const design = { protocol: 'Complete design paragraph.\n'.repeat(7000) };
    write(`${migration}phases/3-schema-conversion/manifest.json`, design);
    trajectory.events = [
        { type: 'tool_call', data: { toolName: 'bash', arguments: { command: 'command evidence\n'.repeat(12000) } } },
    ];
    const input = { ...stimulus('schema-conversion'), rubric: ['Design correctness', 'Execution boundary'] };
    const scopes = judgeEvidenceGroups(input, { evidence_groups: { design: [0], boundary: [1] } });
    assert.throws(() => buildJudgeEvidence(trajectory, input, validation), /No content was truncated/);
    for (const { scope } of scopes) {
        const evidence = buildJudgeEvidence(trajectory, input, validation, scope);
        assert.ok(evidence.bytes <= MAX_EVIDENCE_BYTES);
        if (scope === 'design')
            assert.equal(
                evidence.packet.files.find(({ path }) => path.endsWith('3-schema-conversion/manifest.json')).content,
                JSON.stringify(design),
            );
        if (scope === 'boundary')
            assert.equal(evidence.packet.audit[0].arguments.command, trajectory.events[0].data.arguments.command);
        else assert.deepEqual(evidence.packet.audit, []);
    }
});

test('evidence grouping rejects missing, repeated and out-of-range criteria or omitted scopes', () => {
    const input = { ...stimulus('code-migration'), rubric: ['Implementation', 'Dependencies', 'Boundary'] };
    for (const groups of [
        { implementation: [0], dependencies: [1], boundary: [] },
        { implementation: [0, 1], dependencies: [1], boundary: [2] },
        { implementation: [0], dependencies: [1], boundary: [3] },
        { implementation: [0, 1, 2] },
    ]) {
        assert.throws(
            () => judgeEvidenceGroups(input, { evidence_groups: groups }),
            (error) => error.category === 'evidence-configuration',
        );
    }
});

test('every scoped verdict is required and each judge sees only its assigned criteria', async (t) => {
    const { trajectory } = fixture(t);
    const input = { ...stimulus('code-migration'), rubric: ['Implementation', 'Dependencies', 'Boundary'] };
    const grouped = { ...config, evidence_groups: { implementation: [0], dependencies: [1], boundary: [2] } };
    for (const rejected of [undefined, 'dependencies']) {
        const seen = [];
        let shutdowns = 0;
        const grader = createAdventureWorksJudge({
            sample: 'offline',
            checkSample() {},
            checkArtifacts() {},
            async createClient() {
                return {
                    async judge(request) {
                        assert.equal(request.timeoutMs, 120_000);
                        const { rubric, evidence } = JSON.parse(request.userMessage);
                        const scope = evidence.scope;
                        seen.push(scope);
                        assert.deepEqual(
                            rubric,
                            grouped.evidence_groups[scope].map((index) => input.rubric[index]),
                        );
                        assert.ok(evidence.files.some(({ content }) => content.includes('FINAL ROLLBACK OBLIGATION')));
                        const score = scope === rejected ? 0 : 1;
                        return {
                            args: {
                                evidence_sufficient: true,
                                overall_score: score,
                                overall_reasoning: `Synthetic ${scope} verdict`,
                                rubric_scores: rubric.map((criterion) => ({
                                    criterion,
                                    score,
                                    reasoning: 'Synthetic verdict',
                                })),
                            },
                            latencyMs: 1,
                        };
                    },
                    async shutdown() {
                        shutdowns++;
                    },
                };
            },
        });
        const result = await grader.grade({ trajectory, stimulus: input, config: grouped });
        assert.equal(result.passed, rejected === undefined);
        assert.equal(result.status, undefined);
        assert.deepEqual(seen, ['implementation', 'dependencies', 'boundary']);
        assert.equal(result.metadata.evidence_packets.length, 3);
        assert.equal(result.details.length, 3);
        assert.equal(shutdowns, 1);
    }
});

test('the judge selects artifact validation by phase except explicit inference or handoff', async (t) => {
    const { trajectory } = fixture(t);
    for (const [phase, scenario, expected] of [
        ['discovery', 'supplied-ddl', 'discovery'],
        ['discovery', 'inferred-ddl', 'inferred-ddl'],
        ['code-migration', 'handoff-planning', 'handoff-planning'],
    ]) {
        let received;
        const grader = createAdventureWorksJudge({
            sample: 'offline',
            checkSample() {},
            checkArtifacts(_path, value) {
                received = value;
            },
            async createClient() {
                throw new Error('No model needed for routing assertion');
            },
        });
        await grader.grade({ trajectory, stimulus: { ...stimulus(phase), tags: { phase, scenario } }, config });
        assert.equal(received, expected);
    }
});
