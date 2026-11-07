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
import { verifySample } from './sample.mjs';
import { plannedTarget, workloadContent } from './setup.mjs';

const schema = JSON.parse(readFileSync(new URL('./schema-contract.json', import.meta.url), 'utf8'));
const suppliedDdl = readFileSync(new URL('./AdventureworksLT.sql', import.meta.url));
const schemaPath = '.cosmosdb-migration/phases/1-discovery/schema-ddl/AdventureworksLT.sql';
const tableNames = Object.keys(schema).sort();
const identity = (table) => table.identity.map(({ name }) => name).join('.');
const evidencePath = (source) => posix.normalize(source.split('#')[0].replaceAll('\\', '/'));

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

export function checkAdventureWorksInventory(inventory) {
    assert.deepEqual(
        inventory.tables.map(identity).sort(),
        tableNames,
        'Source table inventory differs from the fixture',
    );
    const resolve = createSourceResolver(inventory);
    for (const [name, expected] of Object.entries(schema)) {
        const actual = resolve(name);
        assert.deepEqual(
            actual.columns.map((column) => column.name).sort(),
            [...expected.columns].sort(),
            `${name} columns`,
        );
        assert.deepEqual(actual.primaryKey, expected.primaryKey, `${name} primary-key order`);
        const actualForeignKeys = actual.foreignKeys
            .map((key) =>
                JSON.stringify({
                    columns: key.columns,
                    referencedTable: identity(resolve(key.referencedTable)),
                    referencedColumns: key.referencedColumns,
                }),
            )
            .sort();
        assert.deepEqual(
            actualForeignKeys,
            expected.foreignKeys.map((key) => JSON.stringify(key)).sort(),
            `${name} foreign keys`,
        );
    }
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

export function checkPlanningBoundary(project, plan, provisioningManifest) {
    assert.equal(plan.mode, 'plan', 'This scenario does not authorize application migration');
    assert.deepEqual(plan.outputFiles, [], 'Planning must not claim application outputs');
    assert.notEqual(
        project.phases.provisioning?.status,
        'complete',
        'Artifact-only provisioning must remain incomplete',
    );
    assert.notEqual(project.phases.targetEnvironment?.verified, true, 'Planned target is not a verified target');
    assert.equal(provisioningManifest?.verification, undefined, 'Do not fabricate cloud verification');
    assert.ok(
        plan.validation.every(
            (entry) =>
                entry.status !== 'passed' || !entry.checks.some((check) => ['build', 'behavior'].includes(check)),
        ),
        'The application was not built or executed during planning',
    );
}

export function checkAdventureWorks(workspace, scenario, sample) {
    assert.ok(['supplied-ddl', 'inferred-ddl'].includes(scenario), 'Unknown AdventureWorks scenario');
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
    const inventory = json('phases/1-discovery/preflight-manifest.json').sourceInventory;
    checkAdventureWorksInventory(inventory);
    const discovery = json('phases/1-discovery/discovery-manifest.json');
    checkControllerCoverage(discovery);
    const phases =
        scenario === 'supplied-ddl'
            ? ['preflight', 'discovery', 'assessment', 'schema-conversion', 'code-migration']
            : ['preflight', 'discovery'];
    const completion = checkPhaseCompletions(workspace, phases);
    for (const phase of phases) {
        assert.equal(completion[phase].complete, true, JSON.stringify(completion[phase], null, 2));
    }

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

    assert.deepEqual(
        inventory.files.map(({ path }) => path),
        [schemaPath],
        'Supplied schema selection changed',
    );
    assert.deepEqual(readFileSync(join(workspace, schemaPath)), suppliedDdl, 'Authoritative DDL changed');
    const resolve = createSourceResolver(inventory);
    const canonicalName = (name) => identity(resolve(name));
    assert.deepEqual(
        project.phases.assessment.domains.flatMap(({ tables }) => tables.map(canonicalName)).sort(),
        tableNames,
        'Assessment must retain exactly one owner for every table',
    );
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
    const samples = json('phases/4-provisioning/sample-data.json');
    const expected = buildProvisioningArtifacts(model, samples, project, readIdentityManifest(modelPath), inventory);
    for (const [name, content] of Object.entries(expected)) {
        assert.equal(read(`phases/4-provisioning/${name}`), content, `Invalid generated ${name}`);
    }
    assert.ok(read('phases/4-provisioning/summary.md').trim(), 'Missing artifact-only provisioning summary');
    const manifestPath = join(root, 'phases/4-provisioning/manifest.json');
    const provisioningManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined;
    const plan = json('code-migration-manifest.json');
    checkPlanningBoundary(project, plan, provisioningManifest);
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
                checkAdventureWorks(join(trajectory.workDir, 'app'), config?.scenario, sample);
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
