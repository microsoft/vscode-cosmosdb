import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkCodeMigrationPrerequisites, checkPhaseCompletion } from '../scripts/check-phase-completion.mjs';
import { buildFreshnessManifest } from '../scripts/freshness.mjs';
import {
    inspectDiscoveryInputs,
    inspectMigrationState,
    MAX_INSPECTION_OUTPUT_BYTES,
    summarizeInspectionResult,
} from '../scripts/inspect-migration-state.mjs';
import { readPhaseEvidence } from '../scripts/phase-summary.mjs';
import { canonicalizeCosmosModel, canonicalStringify } from '../scripts/validate-cosmos-model.mjs';
import { VALID_DOMAIN_SUMMARY, VALID_ROOT_SUMMARY } from './schema-conversion-summary-fixtures.mjs';
import { assessmentFixture, conversionFixture, discoveryFixture, sourceFixture } from './source-evidence-fixtures.mjs';

const inventories = new Map();
const inspectorPath = fileURLToPath(new URL('../scripts/inspect-migration-state.mjs', import.meta.url));

function createWorkspace() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'migration-state-'));
}

function write(workspace, relativePath, content = '# artifact\n') {
    const filePath = path.join(workspace, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function baseProject() {
    return {
        version: 1,
        name: 'migration-app',
        sourceCode: 'parent',
        runCounts: {},
        phases: { discovery: { status: 'not-started' } },
    };
}

function saveProject(workspace, project) {
    write(workspace, '.cosmosdb-migration/project.json', `${JSON.stringify(project, null, 2)}\n`);
}

function completePreflight(workspace, project) {
    project.phases.discovery.preflightStatus = 'complete';
    inventories.set(workspace, sourceFixture(workspace, project));
}

function completePhase1(workspace, project) {
    project.phases.discovery.status = 'complete';
    discoveryFixture(workspace, inventories.get(workspace), project);
}

function completePhase2(workspace, project) {
    project.phases.assessment = {
        status: 'complete',
        domains: [
            {
                name: 'Orders',
                tables: ['dbo.Orders'],
                crossDomainDependencies: [],
                estimatedTokens: 1000,
                isMapped: true,
            },
        ],
        parsedAccessPatterns: [],
        completedAt: '2026-09-07T00:00:00.000Z',
    };
    assessmentFixture(workspace, project, inventories.get(workspace));
}

function completePhase3(workspace, project) {
    const domainModel = {
        version: 1,
        domain: 'Orders',
        sourceType: 'SQL Server',
        containers: [
            {
                name: 'Orders',
                partitionKeys: [{ path: '/tenantId' }],
                entities: [
                    {
                        name: 'Order',
                        docType: 'order',
                        sourceTable: 'dbo.Orders',
                        idTemplate: 'order-{Id}',
                        attributes: [
                            {
                                target: 'id',
                                source: { table: 'Orders', column: 'Id', type: 'int' },
                                type: 'string',
                                isId: true,
                            },
                            {
                                target: 'orderId',
                                source: { table: 'Orders', column: 'Id', type: 'int' },
                                type: 'number',
                            },
                            {
                                target: 'pk',
                                source: { table: 'Orders', column: 'Pk', type: 'varchar' },
                                type: 'string',
                            },
                            {
                                target: 'tenantId',
                                source: { table: 'Orders', column: 'TenantId', type: 'varchar' },
                                type: 'string',
                                isPartitionKey: true,
                            },
                        ],
                    },
                ],
                indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [] },
            },
        ],
    };
    const rootModel = { ...domainModel, domain: 'all', databaseName: 'migration-db', capacityMode: 'serverless' };
    project.phases.schemaConversion = {
        status: 'complete',
        domains: ['Orders'],
        completedAt: '2026-09-07T00:00:00.000Z',
    };
    saveProject(workspace, project);
    write(
        workspace,
        '.cosmosdb-migration/phases/3-schema-conversion/domains/Orders/summary.md',
        VALID_DOMAIN_SUMMARY,
    );
    write(
        workspace,
        '.cosmosdb-migration/phases/3-schema-conversion/model.json',
        canonicalStringify(canonicalizeCosmosModel(rootModel)),
    );
    write(workspace, '.cosmosdb-migration/phases/3-schema-conversion/summary.md', VALID_ROOT_SUMMARY);
    conversionFixture(workspace, inventories.get(workspace), [{ domainName: 'Orders', model: domainModel }], rootModel, project);
}

test('initializes a fresh autonomous workflow at preflight', () => {
    const workspace = createWorkspace();
    const result = inspectMigrationState(workspace);
    assert.equal(result.action, 'initialize');
    assert.equal(result.phase, 'preflight');
    fs.rmSync(workspace, { recursive: true });
});

test('bounds and paginates oversized top-level inspection errors', () => {
    const result = {
        action: 'blocked',
        phase: 'assessment',
        projectPath: '/workspace/.cosmosdb-migration/project.json',
        errors: Array.from({ length: 100 }, (_, index) => `Error ${index}: ${'x'.repeat(1000)}`),
    };
    const summary = summarizeInspectionResult(result);
    assert.equal(summary.action, 'blocked');
    assert.equal(summary.errorCount, 100);
    assert(summary.returnedErrors < summary.errorCount);
    assert.equal(summary.nextErrorOffset, summary.returnedErrors);
    assert(Buffer.byteLength(`${JSON.stringify(summary, null, 2)}\n`) <= MAX_INSPECTION_OUTPUT_BYTES);
});

test('lists raw inputs before templates exist and paginates without reading their contents into the response', () => {
    const workspace = createWorkspace();
    try {
        saveProject(workspace, baseProject());
        const root = '.cosmosdb-migration/phases/1-discovery/volumetrics';
        write(workspace, `${root}/first.csv`, 'private workload content');
        write(workspace, `${root}/second.csv`, 'second input');
        write(workspace, `${root}/volumetrics.md`, '# Generated template');
        const page = inspectDiscoveryInputs(workspace, 'volumetrics', { limit: 1 });
        assert.equal(page.total, 2);
        assert.equal(page.nextOffset, 1);
        assert.equal(page.files[0].path, `${root}/first.csv`);
        assert.match(page.files[0].sha256, /^[0-9a-f]{64}$/u);
        assert(!JSON.stringify(page).includes('private workload content'));
        assert.equal(inspectDiscoveryInputs(workspace, 'volumetrics', { offset: 1 }).files[0].path, `${root}/second.csv`);
        const cli = spawnSync(process.execPath, [inspectorPath, '--workspace', workspace, '--inputs', 'volumetrics'], { encoding: 'utf8' });
        assert.equal(cli.status, 0, cli.stderr);
        assert.equal(JSON.parse(cli.stdout).total, 2);
        const route = spawnSync(process.execPath, [inspectorPath, '--workspace', workspace, '--phase', 'discovery'], { encoding: 'utf8' });
        assert.equal(route.status, 0, route.stderr);
        assert.equal(JSON.parse(route.stdout).inputCounts.volumetrics, 2);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('resumes an interrupted phase after its prerequisite is complete', () => {
    const workspace = createWorkspace();
    const project = baseProject();
    completePreflight(workspace, project);
    project.phases.discovery.status = 'in-progress';
    saveProject(workspace, project);
    const result = inspectMigrationState(workspace, 'discovery');
    assert.equal(result.action, 'resume');
    assert.equal(result.phase, 'discovery');
    fs.rmSync(workspace, { recursive: true });
});

test('starts discovery with ordered preflight preparation when inputs are incomplete', () => {
    const workspace = createWorkspace();
    try {
        saveProject(workspace, baseProject());
        const result = inspectMigrationState(workspace, 'discovery');
        assert.equal(result.action, 'run');
        assert.equal(result.phase, 'discovery');
        assert.equal(result.prerequisite, 'preflight');
        assert.deepEqual(result.preflightSteps, [
            'application-details', 'schema-acquisition', 'volumetrics', 'access-patterns',
        ]);
        assert.deepEqual(result.errors, []);
        assert.equal(result.completion.phase, 'preflight');
        assert.equal(result.completion.complete, false);
        const cli = spawnSync(process.execPath, [inspectorPath, '--workspace', workspace, '--phase', 'discovery'], {
            encoding: 'utf8',
        });
        assert.equal(cli.status, 0, cli.stderr);
        assert.deepEqual(JSON.parse(cli.stdout).preflightSteps, result.preflightSteps);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('repairs missing preflight evidence before rerunning Discovery and keeps assessment blocked', () => {
    const workspace = createWorkspace();
    try {
        const project = baseProject();
        completePreflight(workspace, project);
        completePhase1(workspace, project);
        saveProject(workspace, project);
        fs.rmSync(path.join(workspace, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json'));
        const result = inspectMigrationState(workspace, 'discovery', true);
        assert.equal(result.action, 'run');
        assert.equal(result.prerequisite, 'preflight');
        assert.equal(result.preflightSteps[0], 'application-details');
        assert.equal(result.completion.complete, false);
        assert.equal(checkPhaseCompletion(workspace, 'discovery').complete, false);
        assert.equal(inspectMigrationState(workspace, 'assessment').action, 'blocked');
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('selects schema-conversion after completed discovery and assessment checkpoints', () => {
    const workspace = createWorkspace();
    const project = baseProject();
    completePreflight(workspace, project);
    completePhase1(workspace, project);
    completePhase2(workspace, project);
    saveProject(workspace, project);
    const result = inspectMigrationState(workspace);
    assert.equal(result.action, 'run');
    assert.equal(result.phase, 'schema-conversion');
    fs.rmSync(workspace, { recursive: true });
});

test('blocks phase-scoped execution when its prerequisite artifacts are incomplete', () => {
    const workspace = createWorkspace();
    const project = baseProject();
    completePreflight(workspace, project);
    completePhase1(workspace, project);
    project.phases.assessment = { status: 'complete', domains: [] };
    saveProject(workspace, project);
    const result = inspectMigrationState(workspace, 'schema-conversion');
    assert.equal(result.action, 'blocked');
    assert.equal(result.prerequisite, 'assessment');
    fs.rmSync(workspace, { recursive: true });
});

test('resumes schema-conversion when an interrupted checkpoint contains invalid output', () => {
    const workspace = createWorkspace();
    const project = baseProject();
    completePreflight(workspace, project);
    completePhase1(workspace, project);
    completePhase2(workspace, project);
    project.phases.schemaConversion = { status: 'in-progress', domains: ['Orders'] };
    write(workspace, '.cosmosdb-migration/phases/3-schema-conversion/model.json', '{}\n');
    saveProject(workspace, project);
    const result = inspectMigrationState(workspace, 'schema-conversion');
    assert.equal(result.action, 'resume');
    assert(result.completion.artifacts.some((artifact) => artifact.state === 'invalid'));
    assert(result.completion.artifactCounts.total > result.completion.artifacts.length);
    assert.equal(result.completion.totalFailures, result.completion.returnedFailures);
    fs.rmSync(workspace, { recursive: true });
});

test('advances an autonomous workflow through a completed schema-conversion checkpoint', () => {
    const workspace = createWorkspace();
    const project = baseProject();
    completePreflight(workspace, project);
    completePhase1(workspace, project);
    completePhase2(workspace, project);
    completePhase3(workspace, project);
    saveProject(workspace, project);
    const result = inspectMigrationState(workspace);
    assert.equal(result.action, 'run');
    assert.equal(result.phase, 'provisioning');
    fs.rmSync(workspace, { recursive: true });
});

test('drives a fresh autonomous analytical sequence from disk checkpoints', () => {
    const workspace = createWorkspace();
    const project = baseProject();
    saveProject(workspace, project);
    const visited = [];

    let result = inspectMigrationState(workspace);
    visited.push(result.phase);
    assert.equal(result.action, 'run');
    completePreflight(workspace, project);
    saveProject(workspace, project);

    result = inspectMigrationState(workspace);
    visited.push(result.phase);
    assert.equal(result.action, 'run');
    completePhase1(workspace, project);
    saveProject(workspace, project);

    result = inspectMigrationState(workspace);
    visited.push(result.phase);
    assert.equal(result.action, 'run');
    completePhase2(workspace, project);
    saveProject(workspace, project);

    result = inspectMigrationState(workspace);
    visited.push(result.phase);
    assert.equal(result.action, 'run');
    completePhase3(workspace, project);
    saveProject(workspace, project);

    result = inspectMigrationState(workspace);
    visited.push(result.phase);
    assert.equal(result.action, 'run');
    assert.deepEqual(visited, ['preflight', 'discovery', 'assessment', 'schema-conversion', 'provisioning']);
    fs.rmSync(workspace, { recursive: true });
});

test('regenerates a completed scoped phase when explicitly requested', () => {
    const workspace = createWorkspace();
    const project = baseProject();
    completePreflight(workspace, project);
    completePhase1(workspace, project);
    saveProject(workspace, project);
    const result = inspectMigrationState(workspace, 'discovery', true);
    assert.equal(result.action, 'regenerate');
    assert.equal(result.phase, 'discovery');
    assert.equal(result.completion.complete, true);
    fs.rmSync(workspace, { recursive: true });
});

test('accepts a focused preflight step while checking complete preflight readiness', () => {
    const workspace = createWorkspace();
    const project = baseProject();
    completePreflight(workspace, project);
    saveProject(workspace, project);
    const result = spawnSync(
        process.execPath,
        [inspectorPath, '--workspace', workspace, '--phase', 'preflight', '--preflight-step', 'volumetrics', '--regenerate'],
        { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const inspection = JSON.parse(result.stdout);
    assert.equal(inspection.action, 'regenerate');
    assert.equal(inspection.phase, 'preflight');
    assert.equal(inspection.preflightStep, 'volumetrics');
    assert.equal(inspection.completion.complete, true);
    fs.rmSync(workspace, { recursive: true });
});

test('rejects a preflight step for another phase', () => {
    const result = spawnSync(
        process.execPath,
        [inspectorPath, '--phase', 'discovery', '--preflight-step', 'volumetrics'],
        { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), '--preflight-step requires --phase preflight.');
});

test('rejects an unknown preflight step', () => {
    const result = spawnSync(
        process.execPath,
        [inspectorPath, '--phase', 'preflight', '--preflight-step', 'unknown'],
        { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), 'Unknown preflight step: unknown');
});

test('returns the full regeneration sequence for an unscoped run', () => {
    const workspace = createWorkspace();
    const project = baseProject();
    saveProject(workspace, project);
    const result = inspectMigrationState(workspace, undefined, true);
    assert.equal(result.action, 'regenerate');
    assert.equal(result.phase, 'all');
    assert.deepEqual(result.phases, ['preflight', 'discovery', 'assessment', 'schema-conversion', 'provisioning']);
    fs.rmSync(workspace, { recursive: true });
});

test('allows iterative code migration after source edits without weakening analytical freshness', () => {
    const workspace = createWorkspace();
    const project = baseProject();
    try {
        completePreflight(workspace, project);
        completePhase1(workspace, project);
        write(workspace, 'src/orders.ts', 'original relational code\n');
        const discoveryPath = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/discovery-manifest.json');
        const evidence = readPhaseEvidence(discoveryPath);
        evidence.patterns = [{ id: 'R001', kind: 'read', tables: ['dbo.Orders'], sourcePaths: ['src/orders.ts'], evidence: 'code', tps: 1, operation: 'Read orders' }];
        evidence.noObservedAccess = [];
        fs.writeFileSync(discoveryPath, `${JSON.stringify(evidence, null, 2)}\n`);
        project.freshness.discovery = buildFreshnessManifest(workspace, project, 'discovery', ['src/orders.ts']);
        completePhase2(workspace, project);
        completePhase3(workspace, project);
        saveProject(workspace, project);
        assert.equal(checkPhaseCompletion(workspace, 'schema-conversion').complete, true);
        assert.equal(inspectMigrationState(workspace, 'code-migration').action, 'run');
        const originalReports = fs.readFileSync(discoveryPath, 'utf8');
        write(workspace, 'src/orders.ts', 'migrated code\n');
        assert.equal(checkPhaseCompletion(workspace, 'schema-conversion').complete, false);
        assert.equal(checkCodeMigrationPrerequisites(workspace).complete, true);
        assert.equal(checkPhaseCompletion(workspace, 'code-migration').ready, true);
        project.phases.codeMigration = { status: 'in-progress' };
        saveProject(workspace, project);
        assert.equal(inspectMigrationState(workspace, 'code-migration').action, 'resume');
        fs.rmSync(path.join(workspace, 'src/orders.ts'));
        assert.equal(inspectMigrationState(workspace, 'code-migration').action, 'resume');
        assert.equal(fs.readFileSync(discoveryPath, 'utf8'), originalReports);
        const modelPath = path.join(workspace, '.cosmosdb-migration/phases/3-schema-conversion/model.json');
        const originalModel = fs.readFileSync(modelPath, 'utf8');
        const changedModel = JSON.parse(originalModel);
        changedModel.containers[0].entities[0].docType = 'different';
        fs.writeFileSync(modelPath, canonicalStringify(canonicalizeCosmosModel(changedModel)));
        assert.equal(inspectMigrationState(workspace, 'code-migration').action, 'blocked');
        assert.equal(checkPhaseCompletion(workspace, 'code-migration').ready, false);
        fs.writeFileSync(modelPath, originalModel);
        fs.rmSync(path.join(workspace, '.cosmosdb-migration/phases/3-schema-conversion/domains/Orders/summary.md'));
        assert.equal(inspectMigrationState(workspace, 'code-migration').action, 'blocked');
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('normalizes deprecated numeric phase aliases in state results', () => {
    const workspace = createWorkspace();
    const result = inspectMigrationState(workspace, '0');
    assert.equal(result.action, 'initialize');
    assert.equal(result.phase, 'preflight');
    fs.rmSync(workspace, { recursive: true });
});
