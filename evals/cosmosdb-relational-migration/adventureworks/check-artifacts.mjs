/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { checkPhaseCompletions } from '../../../skills/cosmosdb-relational-migration/scripts/check-phase-completion.mjs';
import { buildProvisioningArtifacts } from '../../../skills/cosmosdb-relational-migration/scripts/generate-provisioning-artifacts.mjs';
import { readIdentityManifest } from '../../../skills/cosmosdb-relational-migration/scripts/identity-mapping.mjs';
import { validateCodeMigrationPlan } from '../../../skills/cosmosdb-relational-migration/scripts/validate-code-migration-plan.mjs';
import { createSourceResolver } from '../../../skills/cosmosdb-relational-migration/scripts/validate-source-evidence.mjs';
import { phaseOrder, prerequisiteStages, readCheckpoint, sha256 } from './checkpoints.mjs';
import { captureHandoffBaseline, checkHandoffBoundary } from './handoff.mjs';
import { createAdventureWorksJudge } from './judge.mjs';
import { checkPlanTasks } from './plan-contract.mjs';
import { verifySample } from './sample.mjs';
import { plannedTarget, workloadContent } from './setup.mjs';
import { checkAdventureWorksInventory, tableNames } from './source-contract.mjs';

export { checkAdventureWorksInventory } from './source-contract.mjs';

const suppliedDdl = readFileSync(new URL('./AdventureworksLT.sql', import.meta.url));
const schemaPath = '.cosmosdb-migration/phases/1-discovery/schema-ddl/AdventureworksLT.sql';
const identity = (table) => table.identity.map(({ name }) => name).join('.');
const evidencePath = (source) => posix.normalize(source.split('#')[0].replaceAll('\\', '/'));
const phaseKeys = {
    preflight: 'discovery',
    discovery: 'discovery',
    assessment: 'assessment',
    'schema-conversion': 'schemaConversion',
    provisioning: 'provisioning',
    'code-migration': 'codeMigration',
};
const phaseOutputs = {
    preflight:
        /^phases\/1-discovery\/(?:preflight-(?:summary\.md|manifest\.json)|volumetrics\/volumetrics\.md|access-patterns\/access-patterns\.md)$/,
    discovery: /^phases\/1-discovery\/discovery-(?:report\.md|manifest\.json)$/,
    assessment: /^phases\/2-assessment\//,
    'schema-conversion': /^phases\/3-schema-conversion\//,
    provisioning: /^phases\/4-provisioning\//,
    'code-migration': /^code-migration-(?:plan\.md|manifest\.json)$/,
};

export function checkPhaseBoundary(workspace, phase, project) {
    const root = join(workspace, '.cosmosdb-migration');
    const checkpoints = prerequisiteStages(phase).map((stage) => readCheckpoint(stage));
    const predecessorFiles = new Set();
    for (const checkpoint of checkpoints) {
        for (const [path, hash] of Object.entries(checkpoint.files)) {
            assert.equal(sha256(readFileSync(join(root, path))), hash, `Changed predecessor artifact: ${path}`);
            predecessorFiles.add(path);
        }
    }
    for (const [key, value] of Object.entries(checkpoints.at(-1)?.project.phases ?? {})) {
        if (key !== phaseKeys[phase]) {
            assert.deepEqual(project.phases[key], value, `Changed predecessor phase state: ${key}`);
        } else if (phase === 'discovery') {
            for (const field of ['preflightStatus', 'preflightCompletedAt', 'applicationAnalysis', 'ddlParsing']) {
                assert.deepEqual(project.phases.discovery[field], value[field], `Changed preflight state: ${field}`);
            }
        }
    }
    if (phase === 'preflight') assert.equal(project.phases.discovery.status, 'not-started', 'Advanced discovery');
    for (const later of phaseOrder.slice(phaseOrder.indexOf(phase) + 1)) {
        if (later === 'discovery' && phase === 'preflight') continue;
        assert.ok([undefined, 'not-started'].includes(project.phases[phaseKeys[later]]?.status), `Advanced ${later}`);
    }
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
        assert.ok(!entry.isSymbolicLink(), 'Unexpected migration artifact symlink');
        if (!entry.isFile()) continue;
        const path = relative(root, join(entry.parentPath, entry.name)).split(sep).join('/');
        assert.ok(
            [
                'project.json',
                'memory.md',
                'phases/1-discovery/schema-ddl/AdventureworksLT.sql',
                'phases/1-discovery/volumetrics/workload.json',
            ].includes(path) ||
                predecessorFiles.has(path) ||
                phaseOutputs[phase].test(path),
            `Out-of-phase artifact: ${path}`,
        );
    }
}

export function applicationSnapshot(root) {
    const files = new Map();
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
        const path = join(entry.parentPath, entry.name);
        const name = relative(root, path).split(sep).join('/');
        if (name === '.git' || name.startsWith('.git/') || name.startsWith('.cosmosdb-migration/')) continue;
        assert.ok(!entry.isSymbolicLink(), `Unexpected source symlink: ${name}`);
        if (entry.isFile()) files.set(name, createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
    return new Map([...files].sort(([left], [right]) => left.localeCompare(right, 'en')));
}

export function checkControllerCoverage(discovery) {
    for (const controller of ['Customers', 'Products', 'ProductCategories']) {
        for (const kind of ['read', 'write']) {
            assert.ok(
                discovery.patterns.some(
                    (pattern) =>
                        pattern.kind === kind &&
                        pattern.evidence === 'code' &&
                        pattern.sourcePaths.some(
                            (source) => evidencePath(source) === `Controllers/${controller}Controller.cs`,
                        ),
                ),
                `Missing ${kind} evidence from ${controller}Controller`,
            );
        }
    }
}

function checkProvisioningBoundary(project, provisioningManifest) {
    assert.notEqual(
        project.phases.provisioning?.status,
        'complete',
        'Artifact-only provisioning must remain incomplete',
    );
    assert.notEqual(project.phases.targetEnvironment?.verified, true, 'Planned target is not a verified target');
    assert.equal(provisioningManifest?.verification, undefined, 'Do not fabricate cloud verification');
}

export function checkPlanningBoundary(project, plan, provisioningManifest) {
    checkProvisioningBoundary(project, provisioningManifest);
    assert.equal(plan.mode, 'plan', 'This scenario does not authorize application migration');
    assert.deepEqual(plan.outputFiles, [], 'Planning must not claim application outputs');
    assert.ok(
        plan.validation.every(
            (entry) =>
                entry.status !== 'passed' || !entry.checks.some((check) => ['build', 'behavior'].includes(check)),
        ),
        'The application was not built or executed during planning',
    );
}

export function checkAdventureWorks(workspace, scenario, sample, handoffBaseline) {
    const isolated = phaseOrder.includes(scenario);
    const handoff = scenario === 'handoff-planning';
    const planning = scenario === 'code-migration' || handoff;
    assert.ok(
        isolated || handoff || ['supplied-ddl', 'inferred-ddl'].includes(scenario),
        'Unknown AdventureWorks scenario',
    );
    assert.deepEqual(applicationSnapshot(workspace), applicationSnapshot(sample), 'Application source changed');
    const root = join(workspace, '.cosmosdb-migration');
    const read = (path) => readFileSync(join(root, path), 'utf8');
    const json = (path) => JSON.parse(read(path));
    const project = json('project.json');
    assert.deepEqual(project.customMetadata, { preserve: 'adventureworks-evaluation' }, 'Lost user metadata');
    assert.equal(
        read('phases/1-discovery/volumetrics/workload.json'),
        workloadContent,
        'Supplied workload evidence changed',
    );
    for (const [field, value] of Object.entries(plannedTarget)) {
        assert.equal(project.phases.targetEnvironment?.[field], value, `Changed planned target ${field}`);
    }
    if (isolated) checkPhaseBoundary(workspace, scenario, project);
    if (handoff) checkHandoffBoundary(workspace, handoffBaseline);
    const inventory = json('phases/1-discovery/preflight-manifest.json').sourceInventory;
    checkAdventureWorksInventory(inventory, { source: scenario === 'inferred-ddl' ? 'inferred' : 'supplied' });
    const phases = isolated
        ? [...prerequisiteStages(scenario), ...(scenario === 'provisioning' ? [] : [scenario])]
        : scenario === 'supplied-ddl' || handoff
          ? ['preflight', 'discovery', 'assessment', 'schema-conversion', 'code-migration']
          : ['preflight', 'discovery'];
    const completion = checkPhaseCompletions(workspace, phases);
    for (const phase of phases) {
        assert.equal(completion[phase].complete, true, JSON.stringify(completion[phase], null, 2));
    }

    if (scenario !== 'inferred-ddl') {
        assert.deepEqual(
            inventory.files.map(({ path }) => path),
            [schemaPath],
            'Supplied schema selection changed',
        );
        assert.deepEqual(readFileSync(join(workspace, schemaPath)), suppliedDdl, 'Authoritative DDL changed');
    }
    if (scenario === 'preflight') return;
    const discovery = json('phases/1-discovery/discovery-manifest.json');
    checkControllerCoverage(discovery);
    if (scenario === 'discovery') return;
    if (scenario === 'inferred-ddl') {
        const sourceFiles = applicationSnapshot(sample);
        for (const file of inventory.files) {
            assert.equal(file.origin, 'inferred', 'Inferred schema must retain its origin');
            assert.ok(file.sourcePaths?.length > 0, 'Inferred schema must identify its application evidence');
            for (const source of file.sourcePaths)
                assert.ok(sourceFiles.has(evidencePath(source)), `Invalid inference evidence: ${source}`);
        }
        for (const phase of ['assessment', 'schemaConversion', 'provisioning', 'codeMigration']) {
            assert.ok([undefined, 'not-started'].includes(project.phases[phase]?.status), `Advanced ${phase}`);
        }
        for (const directory of ['2-assessment', '3-schema-conversion', '4-provisioning']) {
            assert.equal(existsSync(join(root, 'phases', directory)), false, `Unexpected ${directory} artifacts`);
        }
        return;
    }

    const resolve = createSourceResolver(inventory);
    const canonicalName = (name) => identity(resolve(name));
    assert.deepEqual(
        project.phases.assessment.domains.flatMap(({ tables }) => tables.map(canonicalName)).sort(),
        tableNames,
        'Assessment must retain exactly one owner for every table',
    );
    if (scenario === 'assessment') return;
    const modelPath = join(root, 'phases/3-schema-conversion/model.json');
    const modelContent = readFileSync(modelPath, 'utf8');
    const model = JSON.parse(modelContent);
    assert.deepEqual(
        model.containers
            .flatMap(({ entities }) => entities.map(({ sourceTable }) => canonicalName(sourceTable)))
            .sort(),
        tableNames,
        'Conversion must map every selected table exactly once',
    );
    if (scenario === 'schema-conversion') return;
    if (!planning) {
        const samples = json('phases/4-provisioning/sample-data.json');
        const expected = buildProvisioningArtifacts(
            model,
            samples,
            project,
            readIdentityManifest(modelPath),
            inventory,
        );
        for (const [name, content] of Object.entries(expected)) {
            assert.equal(read(`phases/4-provisioning/${name}`), content, `Invalid generated ${name}`);
        }
        assert.ok(read('phases/4-provisioning/summary.md').trim(), 'Missing artifact-only provisioning summary');
    }
    const manifestPath = join(root, 'phases/4-provisioning/manifest.json');
    const provisioningManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined;
    checkProvisioningBoundary(project, provisioningManifest);
    if (scenario === 'provisioning') return;
    const plan = json('code-migration-manifest.json');
    checkPlanningBoundary(project, plan, provisioningManifest);
    checkPlanTasks(read('code-migration-plan.md'));
    const result = validateCodeMigrationPlan(read('code-migration-plan.md'), plan, {
        workspace,
        project,
        modelContent,
        sdkReport: discovery.sdkCompatibility,
        sdkReportContent: JSON.stringify(discovery.sdkCompatibility, null, 2) + '\n',
    });
    assert.deepEqual(result, [], JSON.stringify(result, null, 2));
}

export function registerGraders(registry) {
    const baseline = process.env.MIGRATION_EVAL_HANDOFF_BASELINE
        ? captureHandoffBaseline(process.env.MIGRATION_EVAL_HANDOFF_BASELINE)
        : undefined;
    const checkArtifacts = (workspace, scenario, sample) => checkAdventureWorks(workspace, scenario, sample, baseline);
    registry.register(createAdventureWorksJudge({ checkArtifacts }));
    registry.register({
        metadata: {
            name: 'adventureworks-artifacts',
            description: 'Validate real-sample schema, access coverage, phase artifacts and planning-only boundaries',
            behavior: { requiresWorkspace: true },
            determinism: 'complex-static',
            reference: 'reference-based',
            temporalScope: 'trajectory-level',
            costProfile: 'free',
        },
        async grade({ trajectory, config }) {
            assert.ok(trajectory?.workDir, 'AdventureWorks grading requires a trial workspace');
            const sample = process.env.MIGRATION_EVAL_ADVENTUREWORKS_SOURCE;
            assert.ok(sample, 'The runner must provide the pinned sample checkout');
            verifySample(sample);
            try {
                checkArtifacts(join(trajectory.workDir, 'app'), config?.scenario, sample);
                return {
                    name: 'adventureworks-artifacts',
                    kind: 'code',
                    passed: true,
                    score: 1,
                    evidence:
                        'Source semantics, controller coverage, phase contracts and non-execution boundaries validate.',
                };
            } catch (error) {
                return {
                    name: 'adventureworks-artifacts',
                    kind: 'code',
                    passed: false,
                    score: 0,
                    evidence: error instanceof Error ? error.message : String(error),
                };
            }
        },
    });
}
