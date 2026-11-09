/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    computeMetrics,
    createDefaultGraderRegistry,
    discoverEvals,
    gradeTrajectory,
    loadEvalSpec,
    resolveGradePass,
} from '@microsoft/vally';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPhaseCompletion } from '../../skills/cosmosdb-relational-migration/scripts/check-phase-completion.mjs';
import { buildFreshnessManifest } from '../../skills/cosmosdb-relational-migration/scripts/freshness.mjs';
import {
    assessmentFixture,
    evidenceReport,
    writeFixture,
} from '../../skills/cosmosdb-relational-migration/tests/source-evidence-fixtures.mjs';
import { checkArtifacts, registerGraders } from './check-artifacts.mjs';
import { prepareFixture } from './fixtures.mjs';

const skillRoot = fileURLToPath(new URL('../../skills/cosmosdb-relational-migration/', import.meta.url));
const { evals, errors } = await discoverEvals([import.meta.dirname]);
assert.deepEqual(errors, []);
const specs = await Promise.all(evals.map(({ filePath }) => loadEvalSpec(filePath)));
const stimuli = specs.flatMap((spec) => spec.stimuli);
const completed = { type: 'turn_end', data: { turnId: 'offline' } };
const failure = { type: 'error', data: { message: 'Synthetic executor failure' } };

function workspace(t) {
    const root = mkdtempSync(join(tmpdir(), 'migration-vally-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

async function completeFixture(root, phase) {
    const { project, inventory } = await prepareFixture(root, phase, skillRoot);
    if (phase === 'preflight') {
        writeFixture(
            root,
            'phases/1-discovery/preflight-summary.md',
            evidenceReport(['Summary', 'Warnings', 'Decisions']),
        );
        writeFixture(
            root,
            'phases/1-discovery/preflight-manifest.json',
            JSON.stringify({
                version: 1,
                sourceSha256: inventory.sha256,
                sourceInventory: inventory,
                blockingIssues: [],
            }),
        );
        project.phases.discovery.preflightStatus = 'complete';
        project.freshness = { preflight: buildFreshnessManifest(root, project, 'preflight') };
    } else {
        project.phases.assessment.domains = [
            {
                name: 'Orders',
                tables: ['dbo.Orders'],
                crossDomainDependencies: [],
                estimatedTokens: 1000,
                isMapped: true,
            },
        ];
        assessmentFixture(root, project, inventory);
        project.phases.assessment.status = 'complete';
    }
    writeFixture(root, 'project.json', JSON.stringify(project));
}

function updateProject(root, mutate) {
    const path = join(root, '.cosmosdb-migration/project.json');
    const project = JSON.parse(readFileSync(path, 'utf8'));
    mutate(project);
    writeFileSync(path, JSON.stringify(project));
}

test('coverage includes every phase, critical workflow boundaries and negative activation', () => {
    assert.deepEqual(
        [
            ...new Set(
                stimuli
                    .filter(({ tags }) => tags.category === 'guidance')
                    .map(({ tags }) => tags.phase)
                    .filter(Boolean),
            ),
        ].sort(),
        ['assessment', 'code-migration', 'discovery', 'preflight', 'provisioning', 'schema-conversion'],
    );
    for (const contract of [
        'supplied-ddl',
        'inferred-ddl',
        'workload-contradiction',
        'parser-consent',
        'sdk-eligibility',
        'domain-ownership',
        'domain-selection',
        'peer-design',
        'provisioning-approval',
        'target-switch',
        'code-approval',
        'historical-completion',
        'validation-only',
        'review-approval',
        'project-scope',
        'memory-only',
        'non-activation',
    ]) {
        assert.ok(
            stimuli.some(({ tags }) => tags.contract === contract),
            `Missing contract: ${contract}`,
        );
    }
    assert.equal(new Set(stimuli.map(({ name }) => name)).size, stimuli.length);
    assert.deepEqual(
        stimuli
            .filter(({ tags }) => tags.category === 'artifacts')
            .map(({ tags }) => tags.phase)
            .sort(),
        ['assessment', 'preflight'],
    );
});

async function grade(
    spec,
    stimulus,
    workDir,
    {
        verdict = 1,
        artifactVerdict = true,
        output = 'Synthetic answer.',
        wrongSkill = false,
        error = false,
        diff = '',
    } = {},
) {
    const activation = stimulus.graders.find(({ type }) => type === 'skill-invocation').config;
    const skills = wrongSkill ? (activation.disallowed ?? []) : (activation.required ?? []);
    const events = [
        ...skills.map((name) => ({ type: 'skill_activation', data: { name } })),
        completed,
        ...(error ? [failure] : []),
    ];
    const registry = createDefaultGraderRegistry({
        supportsWorkspaceDelivery: true,
        async judge(options) {
            for (const criterion of stimulus.rubric) {
                assert.ok(options.userMessage.includes(criterion), 'Judge did not receive a rubric criterion');
            }
            assert.equal(options.model, spec.defaults.judge_model);
            return {
                args: {
                    rubric_scores: stimulus.rubric.map((criterion) => ({
                        criterion,
                        score: verdict,
                        reasoning: 'Synthetic verdict',
                    })),
                    overall_score: verdict,
                    overall_reasoning: 'Synthetic verdict',
                },
                latencyMs: 0,
                remindersUsed: 0,
            };
        },
        async shutdown() {},
    });
    registerGraders(registry);
    if (stimulus.tags.sample === 'adventureworks') {
        // Only exercise verdict wiring here; real sample contracts have separate offline and live checks.
        registry.register({
            metadata: {
                name: 'adventureworks-artifacts',
                description: 'Synthetic artifact verdict for pipeline wiring tests',
                behavior: {},
                determinism: 'static',
                reference: 'reference-free',
                temporalScope: 'trajectory-level',
                costProfile: 'free',
            },
            async grade() {
                return {
                    name: 'adventureworks-artifacts',
                    kind: 'code',
                    passed: artifactVerdict,
                    score: artifactVerdict ? 1 : 0,
                    evidence: 'Synthetic artifact verdict; not a file-quality check.',
                };
            },
        });
        if (stimulus.graders.some(({ type }) => type === 'adventureworks-judge')) {
            registry.register({
                metadata: {
                    name: 'adventureworks-judge',
                    description: 'Synthetic semantic verdict for pipeline wiring tests',
                    behavior: { requiresLlmClient: true },
                    determinism: 'llm',
                    reference: 'reference-based',
                    temporalScope: 'trajectory-level',
                    costProfile: 'free',
                },
                async grade({ config }) {
                    assert.equal(config.model, spec.defaults.judge_model);
                    assert.equal(config.reasoning_effort, spec.defaults.judge_reasoning_effort);
                    return {
                        name: 'adventureworks-judge',
                        kind: 'llm',
                        passed: verdict === 1,
                        score: verdict,
                        evidence: 'Synthetic verdict; packet delivery has separate tests.',
                    };
                },
            });
        }
    }
    const result = await gradeTrajectory(
        {
            id: 'offline',
            stimulus,
            output,
            events,
            diff,
            metrics: computeMetrics(events),
            workDir,
            metadata: { model: 'offline', executor: 'test', sessionID: 'offline' },
        },
        stimulus.graders,
        {
            registry,
            stimulus,
            judgeModel: spec.defaults.judge_model,
            judgeReasoningEffort: spec.defaults.judge_reasoning_effort,
            weights: spec.scoring.weights,
        },
    );
    assert.notEqual(result.status, 'error', result.evidence);
    return resolveGradePass(result, spec.scoring.threshold);
}

for (const spec of specs) {
    for (const rawStimulus of spec.stimuli) {
        const stimulus = rawStimulus.turns ? { ...rawStimulus, prompt: rawStimulus.turns.join('\n\n') } : rawStimulus;
        test(`${stimulus.name}: grading fails closed`, async (t) => {
            const root = workspace(t);
            if (stimulus.tags.category === 'artifacts') {
                await completeFixture(join(root, 'app'), stimulus.tags.phase);
            }
            assert.equal(await grade(spec, stimulus, root), true);
            for (const options of [{ verdict: 0 }, { output: ' \n' }, { wrongSkill: true }, { error: true }]) {
                assert.equal(await grade(spec, stimulus, root, options), false, JSON.stringify(options));
            }
            if (stimulus.tags.sample === 'adventureworks') {
                assert.equal(await grade(spec, stimulus, root, { artifactVerdict: false }), false);
            }
            if (stimulus.graders.some(({ type }) => type === 'diff-empty')) {
                assert.equal(
                    await grade(spec, stimulus, root, { diff: 'diff --git a/new.txt b/new.txt\n+unexpected write\n' }),
                    false,
                );
            }
        });
    }
}

for (const phase of ['preflight', 'assessment']) {
    test(`${phase}: fixtures start incomplete and have valid prerequisites`, async (t) => {
        const root = workspace(t);
        await prepareFixture(root, phase, skillRoot);
        assert.equal(checkPhaseCompletion(root, phase).complete, false);
        if (phase === 'assessment') {
            assert.equal(checkPhaseCompletion(root, 'discovery').complete, true);
        }
        await assert.rejects(checkArtifacts(root, phase, skillRoot));
    });

    test(`${phase}: artifact checks reject false completion and forbidden changes`, async (t) => {
        const mutations = [
            ['lost user metadata', (root) => updateProject(root, (project) => delete project.customMetadata)],
            ['source edits', (root) => writeFileSync(join(root, 'orders.ts'), '// replaced\n')],
            ['new application files', (root) => writeFileSync(join(root, 'new.ts'), '// unexpected\n')],
            [
                'changed DDL',
                (root) => writeFixture(root, 'phases/1-discovery/schema-ddl/Schema.sql', 'CREATE TABLE Fake(Id INT);'),
            ],
            ['out-of-phase artifact', (root) => writeFixture(root, 'phases/3-schema-conversion/model.json', '{}')],
            [
                'missing summary',
                (root) =>
                    rmSync(
                        join(
                            root,
                            '.cosmosdb-migration/phases',
                            phase === 'preflight'
                                ? '1-discovery/preflight-summary.md'
                                : '2-assessment/assessment-summary.md',
                        ),
                    ),
            ],
        ];
        for (const [name, mutate] of mutations) {
            await t.test(name, async (subtest) => {
                const root = workspace(subtest);
                await completeFixture(root, phase);
                await checkArtifacts(root, phase, skillRoot);
                mutate(root);
                await assert.rejects(checkArtifacts(root, phase, skillRoot));
            });
        }
    });
}
