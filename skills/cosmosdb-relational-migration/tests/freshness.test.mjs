import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPhaseCompletion } from '../scripts/check-phase-completion.mjs';
import {
    buildFreshnessManifest,
    canonicalValueSha256,
    recordFreshness,
    selectedDdlFiles,
    selectedDiscoveryFiles,
    validateFreshnessManifest,
} from '../scripts/freshness.mjs';
import { readProjectState } from '../scripts/project-state.mjs';
import { canonicalStringify, canonicalizeCosmosModel } from '../scripts/validate-cosmos-model.mjs';
import { assessmentFixture, conversionFixture, discoveryFixture, sourceFixture } from './source-evidence-fixtures.mjs';

function workspaceProject() {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-freshness-'));
    const project = {
        version: 1,
        name: 'app',
        sourceCode: 'parent',
        phases: { discovery: { preflightStatus: 'complete', status: 'complete' } },
    };
    return { workspace, project };
}

function conversionModel(domain) {
    return {
        version: 1,
        domain,
        ...(domain === 'all' ? { databaseName: 'app', capacityMode: 'serverless' } : {}),
        sourceType: 'SQL Server',
        containers: [
            {
                name: 'Orders',
                partitionKeys: [{ path: '/TenantId' }],
                entities: [
                    {
                        name: 'Order',
                        docType: 'order',
                        sourceTable: 'dbo.Orders',
                        idTemplate: 'order-{Id}',
                        attributes: [
                            { target: 'id', source: { table: 'Orders', column: 'Id', type: 'int' }, type: 'string', isId: true },
                            { target: 'orderId', source: { table: 'Orders', column: 'Id', type: 'int' }, type: 'number' },
                            { target: 'TenantId', source: { table: 'Orders', column: 'TenantId', type: 'varchar' }, type: 'string', isPartitionKey: true },
                        ],
                    },
                ],
                indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [] },
            },
        ],
    };
}

test('canonical project-value hashes ignore object key order while preserving array order', () => {
    assert.equal(canonicalValueSha256({ second: 2, first: 1 }), canonicalValueSha256({ first: 1, second: 2 }));
    assert.notEqual(canonicalValueSha256(['first', 'second']), canonicalValueSha256(['second', 'first']));
});

test('rejects invalid domain paths before direct freshness calls access any artifacts', () => {
    const { workspace, project } = workspaceProject();
    try {
        for (const names of [['../escape'], ['CON'], ['Sales', 'sales'], ['\u00c9quipe', 'E\u0301QUIPE']]) {
            for (const phase of ['assessment', 'schemaConversion']) {
                const invalidProject = structuredClone(project);
                invalidProject.phases[phase] = { domains: phase === 'assessment' ? names.map(name => ({ name })) : names };
                for (const target of ['assessment', 'schema-conversion']) {
                    assert.throws(() => buildFreshnessManifest(workspace, invalidProject, target), /Invalid migration domain names/u);
                    const result = validateFreshnessManifest(workspace, invalidProject, target, { version: 1, inputs: [], outputs: [] });
                    assert.equal(result.freshness, 'stale');
                    assert.match(result.staleInputs[0].reason, /Invalid migration domain names/u);
                }
            }
        }
        assert.deepEqual(fs.readdirSync(workspace), []);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('selects workspace-root DDL files from legacy empty paths', () => {
    const { workspace, project } = workspaceProject();
    try {
        const ddlPath = path.join(workspace, 'Schema.sql');
        fs.writeFileSync(ddlPath, 'CREATE TABLE dbo.Schema (Id INT PRIMARY KEY);\n');
        project.phases.discovery.schemaInventory = { path: '', includedFiles: ['Schema.sql'] };

        assert.deepEqual(selectedDdlFiles(workspace, project), [ddlPath]);
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('resolves supporting schema evidence separately from DDL and respects exact selections and exclusions', () => {
    const { workspace, project } = workspaceProject();
    try {
        const directory = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/schema-ddl');
        fs.mkdirSync(directory, { recursive: true });
        for (const name of ['Schema.sql', 'metadata.json', 'schema.md']) fs.writeFileSync(path.join(directory, name), name);
        assert.deepEqual(selectedDdlFiles(workspace, project), [path.join(directory, 'Schema.sql')]);
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'schema-evidence'), [path.join(directory, 'metadata.json'), path.join(directory, 'schema.md')]);
        project.phases.discovery.schemaInventory = { files: ['phases/1-discovery/schema-ddl/metadata.json'] };
        assert.deepEqual(selectedDdlFiles(workspace, project), []);
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'schema-evidence'), [path.join(directory, 'metadata.json')]);
        project.phases.discovery.schemaInventory.excludedFiles = ['phases/1-discovery/schema-ddl/metadata.json'];
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'schema-evidence'), []);
        project.phases.discovery.schemaInventory = { files: [] };
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'schema-evidence'), []);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('workspace schema selection excludes the checkpoint and remains current after recording freshness', () => {
    const { workspace, project } = workspaceProject();
    try {
        sourceFixture(workspace, project);
        const migrationRoot = path.join(workspace, '.cosmosdb-migration');
        const checkpoint = path.join(migrationRoot, 'project.json');
        const metadata = path.join(workspace, 'metadata.json');
        fs.writeFileSync(metadata, '{"table":"Orders"}');
        const listFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
            const filename = path.join(directory, entry.name);
            return entry.isDirectory() ? listFiles(filename) : [filename];
        });
        const explicit = { files: listFiles(workspace).map(file => path.relative(migrationRoot, file).split(path.sep).join('/')).sort() };
        for (const selection of [{ path: '.' }, explicit]) {
            project.phases.discovery.schemaInventory = selection;
            fs.writeFileSync(checkpoint, JSON.stringify(project));
            const inputs = selectedDiscoveryFiles(workspace, project, 'schema-evidence');
            assert(inputs.includes(metadata));
            assert(!inputs.includes(checkpoint));
            recordFreshness(workspace, 'preflight', readProjectState(workspace).revision);
            assert.equal(checkPhaseCompletion(workspace, 'preflight').complete, true);
            assert.deepEqual(JSON.parse(fs.readFileSync(checkpoint, 'utf8')).phases.discovery.schemaInventory, selection);
        }
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('checkpoint aliases cannot enter raw schema evidence or inference and consulted freshness inputs', () => {
    const { workspace, project } = workspaceProject();
    try {
        sourceFixture(workspace, project);
        const migrationRoot = path.join(workspace, '.cosmosdb-migration');
        fs.symlinkSync(migrationRoot, path.join(workspace, 'migration-alias'), 'junction');
        project.phases.discovery.schemaInventory = {
            files: ['phases/1-discovery/schema-ddl/Schema.sql', 'project.json', './project.json', '../migration-alias/project.json'],
        };
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'schema-evidence'), []);
        const checkpoint = path.join(migrationRoot, 'project.json');
        const original = fs.readFileSync(checkpoint, 'utf8');
        const manifestPath = path.join(migrationRoot, 'phases/1-discovery/preflight-manifest.json');
        const evidence = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        for (const source of ['.cosmosdb-migration/project.json', './.cosmosdb-migration/project.json', 'migration-alias/project.json']) {
            assert.throws(() => recordFreshness(workspace, 'preflight', readProjectState(workspace).revision, [source]), /checkpoint cannot be a file freshness input/u);
            assert.equal(fs.readFileSync(checkpoint, 'utf8'), original);
        }
        for (const source of ['.cosmosdb-migration/project.json', 'migration-alias/project.json']) {
            Object.assign(evidence.sourceInventory.files[0], { origin: 'inferred', sourcePaths: [source] });
            fs.writeFileSync(manifestPath, JSON.stringify(evidence));
            assert.throws(() => buildFreshnessManifest(workspace, project, 'preflight'), /checkpoint cannot be a file freshness input/u);
        }
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

for (const sourceName of ['model.ts', 'metadata.json']) {
    test(`completes preflight with DDL inferred from ${sourceName} and tracks its evidence automatically`, () => {
        const { workspace, project } = workspaceProject();
        try {
            sourceFixture(workspace, project);
            const sourcePath = path.join(workspace, sourceName);
            fs.writeFileSync(sourcePath, 'source evidence');
            const manifestPath = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json');
            const evidence = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            Object.assign(evidence.sourceInventory.files[0], { origin: 'inferred', sourcePaths: [sourceName] });
            fs.writeFileSync(manifestPath, JSON.stringify(evidence));
            const manifest = buildFreshnessManifest(workspace, project, 'preflight');
            assert(manifest.inputs.some(input => input.id === `schema-inference:${sourceName}`));
            project.freshness.preflight = manifest;
            fs.writeFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), JSON.stringify(project));
            assert.equal(checkPhaseCompletion(workspace, 'preflight').complete, true);
            fs.appendFileSync(sourcePath, ' changed');
            assert.equal(checkPhaseCompletion(workspace, 'preflight').complete, false);
            assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'stale');
            fs.rmSync(sourcePath);
            assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'stale');
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });
}

test('tracks selected supporting artifacts and rejects escaping inference provenance', () => {
    const { workspace, project } = workspaceProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-schema-evidence-'));
    try {
        sourceFixture(workspace, project);
        const artifact = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/schema-ddl/schema.md');
        fs.writeFileSync(artifact, 'schema evidence');
        const manifest = buildFreshnessManifest(workspace, project, 'preflight');
        assert(manifest.inputs.some(input => input.path?.endsWith('/schema.md')));
        fs.appendFileSync(artifact, ' changed');
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'stale');
        const manifestPath = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json');
        const evidence = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const externalFile = path.join(outside, 'metadata.json');
        fs.writeFileSync(externalFile, '{}');
        fs.symlinkSync(externalFile, path.join(workspace, 'linked.json'));
        Object.assign(evidence.sourceInventory.files[0], { origin: 'inferred', sourcePaths: ['linked.json'] });
        fs.writeFileSync(manifestPath, JSON.stringify(evidence));
        assert.throws(() => buildFreshnessManifest(workspace, project, 'preflight'), /outside the workspace/u);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('tracks raw workload files and source selections independently of curated templates', () => {
    const { workspace, project } = workspaceProject();
    try {
        sourceFixture(workspace, project);
        const directory = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/volumetrics');
        const csv = path.join(directory, 'workload.csv');
        fs.writeFileSync(csv, 'timestamp,duration_ms\n2026-10-03T00:00:00Z,12\n');
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'volumetrics'), [csv]);
        const manifest = buildFreshnessManifest(workspace, project, 'preflight');
        assert(manifest.inputs.some(input => input.path?.endsWith('/workload.csv')));
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'current');
        fs.appendFileSync(csv, '2026-10-03T00:00:01Z,20\n');
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'stale');
        const updated = buildFreshnessManifest(workspace, project, 'preflight');
        project.phases.discovery.volumetrics = { excludedFiles: ['workload.csv'] };
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', updated).freshness, 'stale');
        project.phases.discovery.volumetrics = { includedFiles: ['missing.csv'] };
        assert.throws(() => selectedDiscoveryFiles(workspace, project, 'volumetrics'), /ENOENT/u);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('resolves copied and referenced workload selections without including templates or unselected siblings', () => {
    const { workspace, project } = workspaceProject();
    try {
        const directory = path.join(workspace, 'inputs');
        fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory, 'selected.log'), 'selected');
        fs.writeFileSync(path.join(directory, 'other.log'), 'other');
        project.phases.discovery.accessPatterns = { path: 'inputs', includedFiles: ['selected.log'] };
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'access-patterns'), [path.join(directory, 'selected.log')]);
        project.phases.discovery.accessPatterns.excludedFiles = ['selected.log'];
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'access-patterns'), []);
        project.phases.discovery.volumetrics = { path: '..' };
        assert.throws(() => selectedDiscoveryFiles(workspace, project, 'volumetrics'), /inside the workspace/u);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('resolves migration-relative file lists across workspace and copied inputs', () => {
    const { workspace, project } = workspaceProject();
    try {
        sourceFixture(workspace, project);
        const migrationRoot = path.join(workspace, '.cosmosdb-migration');
        const workspaceSql = path.join(workspace, 'schema.sql');
        const copiedSql = path.join(migrationRoot, 'phases/1-discovery/schema-ddl/copied.sql');
        const copiedCsv = path.join(migrationRoot, 'phases/1-discovery/volumetrics/workload.csv');
        fs.writeFileSync(workspaceSql, 'CREATE TABLE dbo.Example (Id INT);');
        fs.writeFileSync(copiedSql, 'CREATE TABLE dbo.Copied (Id INT);');
        fs.writeFileSync(copiedCsv, 'duration_ms\n12\n');
        project.phases.discovery.schemaInventory = {
            files: ['../schema.sql', 'phases/1-discovery/schema-ddl/copied.sql'],
        };
        project.phases.discovery.volumetrics = { files: ['phases/1-discovery/volumetrics/workload.csv'] };
        assert.deepEqual(selectedDdlFiles(workspace, project), [copiedSql, workspaceSql].sort());
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'volumetrics'), [copiedCsv]);
        project.phases.discovery.schemaInventory.excludedFiles = ['../schema.sql'];
        assert.deepEqual(selectedDdlFiles(workspace, project), [copiedSql]);
        project.phases.discovery.volumetrics.files = [];
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'volumetrics'), []);
        project.phases.discovery.schemaInventory = { files: ['../../outside.sql'] };
        assert.throws(() => selectedDdlFiles(workspace, project), /inside the workspace/u);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('keeps exclusion-only default folders dynamic and preserves excluded input files', () => {
    const { workspace, project } = workspaceProject();
    try {
        sourceFixture(workspace, project);
        const relative = 'phases/1-discovery/volumetrics';
        const directory = path.join(workspace, '.cosmosdb-migration', relative);
        const excluded = path.join(directory, 'excluded.csv');
        const selected = path.join(directory, 'selected.csv');
        fs.writeFileSync(excluded, 'excluded input');
        fs.writeFileSync(selected, 'selected input');
        project.phases.discovery.volumetrics = { excludedFiles: ['excluded.csv'] };
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'volumetrics'), [selected]);
        project.phases.discovery.volumetrics = { excludedFiles: [`${relative}/excluded.csv`] };
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'volumetrics'), [selected]);
        const manifest = buildFreshnessManifest(workspace, project, 'preflight');
        fs.appendFileSync(excluded, '\nchanged but still excluded');
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'current');
        const added = path.join(directory, 'added.csv');
        fs.writeFileSync(added, 'added later');
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'volumetrics'), [added, selected]);
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'stale');
        project.phases.discovery.volumetrics.excludedFiles = [];
        assert.deepEqual(selectedDiscoveryFiles(workspace, project, 'volumetrics'), [added, excluded, selected]);
        assert.equal(fs.readFileSync(excluded, 'utf8'), 'excluded input\nchanged but still excluded');
        assert.equal(project.phases.discovery.volumetrics.files, undefined);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('requires current checkpoint freshness for completion', () => {
    const { workspace, project } = workspaceProject();
    try {
        sourceFixture(workspace, project);
        const projectPath = path.join(workspace, '.cosmosdb-migration/project.json');
        delete project.freshness;
        fs.writeFileSync(projectPath, JSON.stringify(project));
        assert.equal(checkPhaseCompletion(workspace, 'preflight').freshness, 'unknown');
        project.freshness = { preflight: buildFreshnessManifest(workspace, project, 'preflight') };
        fs.writeFileSync(projectPath, JSON.stringify(project));
        assert.equal(checkPhaseCompletion(workspace, 'preflight').complete, true);
        project.freshness.preflight.inputs = [];
        fs.writeFileSync(projectPath, JSON.stringify(project));
        assert.equal(checkPhaseCompletion(workspace, 'preflight').freshness, 'stale');
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('records freshness atomically while excluding editable summaries', () => {
    const { workspace, project } = workspaceProject();
    try {
        sourceFixture(workspace, project);
        const state = readProjectState(workspace);
        const summaryPath = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/preflight-summary.md');
        const manifestPath = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json');
        const original = fs.readFileSync(summaryPath, 'utf8');
        const originalManifest = fs.readFileSync(manifestPath, 'utf8');
        const result = recordFreshness(workspace, 'preflight', state.revision);
        assert.equal(result.outputCount, 1);
        assert.equal(result.inputCount > 0, true);
        assert.equal(result.inputs, undefined);
        assert.equal(fs.readFileSync(summaryPath, 'utf8'), original);
        assert.equal(checkPhaseCompletion(workspace, 'preflight').complete, true);
        fs.appendFileSync(summaryPath, '\nchanged report\n');
        assert.equal(checkPhaseCompletion(workspace, 'preflight').freshness, 'current');
        fs.writeFileSync(manifestPath, `${originalManifest.trimEnd()} \n`);
        assert.equal(checkPhaseCompletion(workspace, 'preflight').freshness, 'stale');
        fs.writeFileSync(manifestPath, originalManifest);
        fs.writeFileSync(summaryPath, original);
        assert.equal(checkPhaseCompletion(workspace, 'preflight').freshness, 'current');
        assert.throws(() => recordFreshness(workspace, 'preflight', 'wrong-revision'), /Project changed/u);
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('scopes the target maximum to the recorded canonical model', () => {
    for (const scenario of ['capacity changed', 'maximum changed', 'unchanged', 'missing baseline']) {
        const { workspace, project } = workspaceProject();
        try {
            const root = path.join(workspace, '.cosmosdb-migration');
            const assessment = path.join(root, 'phases/2-assessment');
            const conversion = path.join(root, 'phases/3-schema-conversion');
            fs.mkdirSync(assessment, { recursive: true });
            fs.mkdirSync(conversion, { recursive: true });
            fs.writeFileSync(path.join(assessment, 'assessment-manifest.json'), '{}');
            fs.writeFileSync(path.join(conversion, 'manifest.json'), '{}');
            const model = conversionModel('all');
            if (scenario === 'maximum changed') {
                model.capacityMode = 'provisioned';
                model.containers[0].maxThroughput = 4000;
            }
            const modelPath = path.join(conversion, 'model.json');
            fs.writeFileSync(modelPath, canonicalStringify(model));
            project.phases.targetEnvironment = {
                type: 'azure', endpoint: 'https://selected.documents.azure.com/',
                capacityMode: 'provisioned', maxThroughput: 1000, databaseName: 'SelectedDatabase',
            };
            if (scenario !== 'missing baseline') {
                project.freshness = { 'schema-conversion': buildFreshnessManifest(workspace, project, 'schema-conversion') };
            }
            const projectPath = path.join(root, 'project.json');
            fs.writeFileSync(projectPath, JSON.stringify(project));
            if (scenario === 'capacity changed') {
                model.capacityMode = 'provisioned';
                model.containers[0].maxThroughput = 4000;
            } else if (scenario === 'maximum changed') {
                model.containers[0].maxThroughput = 40000;
            }
            fs.writeFileSync(modelPath, canonicalStringify(model));

            recordFreshness(workspace, 'schema-conversion', readProjectState(workspace).revision);

            const updated = readProjectState(workspace).project;
            const expectedTarget = { ...project.phases.targetEnvironment };
            if (scenario !== 'unchanged') delete expectedTarget.maxThroughput;
            assert.deepEqual(updated.phases.targetEnvironment, expectedTarget, scenario);
            assert.equal(validateFreshnessManifest(workspace, updated, 'schema-conversion', updated.freshness['schema-conversion']).freshness, 'current');
            assert.deepEqual(JSON.parse(fs.readFileSync(modelPath, 'utf8')), model);

            updated.phases.targetEnvironment.maxThroughput = 2000;
            fs.writeFileSync(projectPath, JSON.stringify(updated));
            recordFreshness(workspace, 'schema-conversion', readProjectState(workspace).revision);
            assert.equal(readProjectState(workspace).project.phases.targetEnvironment.maxThroughput, 2000, scenario);
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    }
});

test('excludes code migration from freshness without generating a manifest', () => {
    assert.throws(() => buildFreshnessManifest('/missing-workspace', {}, 'code-migration'), /does not use freshness manifests/u);
    assert.deepEqual(validateFreshnessManifest('/missing-workspace', {}, 'code-migration'), {
        freshness: 'not-applicable', staleInputs: [],
    });
    assert.deepEqual(recordFreshness('/missing-workspace', 'code-migration'), { freshness: 'not-applicable' });
});
test('detects and restores direct input freshness without writing files', () => {
    const { workspace, project } = workspaceProject();
    try {
        sourceFixture(workspace, project);
        const manifest = buildFreshnessManifest(workspace, project, 'preflight');
        const projectPath = path.join(workspace, '.cosmosdb-migration/project.json');
        const before = fs.readFileSync(projectPath, 'utf8');
        assert.deepEqual(validateFreshnessManifest(workspace, project, 'preflight', manifest), {
            freshness: 'current',
            staleInputs: [],
        });
        project.phases.discovery.applicationAnalysis.completedAt = '2030-01-01T00:00:00.000Z';
        project.runCounts = { discovery: 99 };
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'current');
        project.phases.discovery.applicationAnalysis.language = 'Java';
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'stale');
        project.phases.discovery.applicationAnalysis.language = 'TypeScript';
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'current');
        const volumetrics = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/volumetrics/volumetrics.md');
        const original = fs.readFileSync(volumetrics, 'utf8');
        fs.appendFileSync(volumetrics, '\nchanged\n');
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'stale');
        fs.writeFileSync(volumetrics, original);
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'current');
        const addedDdl = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/schema-ddl/Added.sql');
        fs.writeFileSync(addedDdl, 'CREATE TABLE dbo.Added (Id INT PRIMARY KEY);\n');
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'stale');
        fs.rmSync(addedDdl);
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'current');
        const originalDdl = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/schema-ddl/Schema.sql');
        const originalDdlContent = fs.readFileSync(originalDdl, 'utf8');
        fs.rmSync(originalDdl);
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'stale');
        fs.writeFileSync(originalDdl, originalDdlContent);
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'current');
        assert.equal(fs.readFileSync(projectPath, 'utf8'), before);
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('tracks consulted workspace files and rejects symlink escapes', { skip: process.platform === 'win32' }, () => {
    const { workspace, project } = workspaceProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-freshness-outside-'));
    try {
        sourceFixture(workspace, project);
        fs.mkdirSync(path.join(workspace, 'src'));
        fs.writeFileSync(path.join(workspace, 'src/repository.ts'), 'original\n');
        const manifest = buildFreshnessManifest(workspace, project, 'preflight', ['src/repository.ts']);
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'current');
        fs.writeFileSync(path.join(workspace, 'src/repository.ts'), 'changed\n');
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'stale');
        fs.writeFileSync(path.join(outside, 'evidence.sql'), 'outside\n');
        fs.symlinkSync(path.join(outside, 'evidence.sql'), path.join(workspace, 'src/escape.sql'));
        assert.throws(
            () => buildFreshnessManifest(workspace, project, 'preflight', ['src/escape.sql']),
            /resolves outside the workspace/u,
        );
    } finally {
        fs.rmSync(workspace, { recursive: true });
        fs.rmSync(outside, { recursive: true });
    }
});

test('ignores historical peer-file entries without weakening required or consulted input checks', () => {
    const { workspace, project } = workspaceProject();
    try {
        sourceFixture(workspace, project);
        fs.writeFileSync(path.join(workspace, 'source.ts'), 'original\n');
        const manifest = buildFreshnessManifest(workspace, project, 'preflight', ['source.ts']);
        const peer = { id: 'peer-rule:rules/missing.md', kind: 'skill-file', skill: 'cosmosdb-best-practices', path: 'rules/missing.md', sha256: '0'.repeat(64) };
        manifest.inputs.push(peer, { ...peer });
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'current');
        fs.writeFileSync(path.join(workspace, 'source.ts'), 'changed\n');
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', manifest).freshness, 'stale');
        fs.writeFileSync(path.join(workspace, 'source.ts'), 'original\n');
        const unsupported = structuredClone(manifest);
        unsupported.inputs.push({ ...peer, id: 'other-skill:rule', skill: 'other-skill' });
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', unsupported).freshness, 'stale');
        const missingRequired = structuredClone(manifest);
        const required = missingRequired.inputs.shift();
        missingRequired.inputs.push({ ...peer, id: required.id });
        assert.equal(validateFreshnessManifest(workspace, project, 'preflight', missingRequired).freshness, 'stale');
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('historical peer guidance does not block CLI freshness, completion, or predecessor routing', () => {
    const { workspace, project } = workspaceProject();
    const peerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-cli-peer-'));
    try {
        const inventory = sourceFixture(workspace, project);
        discoveryFixture(workspace, inventory, project);
        fs.mkdirSync(path.join(peerRoot, 'guidance'));
        const rulePath = path.join(peerRoot, 'guidance/related-rule.md');
        fs.writeFileSync(rulePath, 'original rule\n');
        project.freshness.preflight.inputs.push({
            id: 'peer-rule:guidance/related-rule.md', kind: 'skill-file', skill: 'cosmosdb-best-practices',
            path: 'guidance/related-rule.md', sha256: '0'.repeat(64),
        });
        fs.writeFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), JSON.stringify(project));
        const originalRevision = readProjectState(workspace).revision;
        const script = fileURLToPath(new URL('../scripts/freshness.mjs', import.meta.url));
        const args = [script, '--workspace', workspace, '--phase', 'preflight'];
        const inspect = () => {
            const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            return JSON.parse(result.stdout);
        };
        assert.equal(inspect().freshness, 'current');
        const run = (name, phase) => {
            const result = spawnSync(process.execPath, [
                fileURLToPath(new URL(`../scripts/${name}.mjs`, import.meta.url)),
                '--workspace', workspace, ...(phase ? ['--phase', phase] : []),
            ], { encoding: 'utf8' });
            assert.equal(result.stderr, '');
            return { exitCode: result.status, report: JSON.parse(result.stdout) };
        };
        assert.equal(run('check-phase-completion', 'preflight').report.complete, true);
        assert.equal(run('check-phase-completion', 'discovery').report.complete, true);
        assert.equal(run('inspect-migration-state', 'discovery').report.action, 'complete');
        assert.equal(run('inspect-migration-state').report.phase, 'assessment');
        fs.writeFileSync(rulePath, 'changed rule\n');
        assert.equal(inspect().freshness, 'current');
        fs.rmSync(rulePath);
        assert.equal(run('check-phase-completion', 'discovery').report.complete, true);
        assert.equal(run('inspect-migration-state', 'discovery').report.action, 'complete');
        assert.equal(readProjectState(workspace).revision, originalRevision);
        const written = spawnSync(process.execPath, [...args, '--write', '--expect', originalRevision], { encoding: 'utf8' });
        assert.equal(written.status, 0, written.stderr);
        assert.equal(readProjectState(workspace).project.freshness.preflight.inputs.some(input => input.kind === 'skill-file'), false);
        fs.appendFileSync(path.join(workspace, '.cosmosdb-migration/phases/1-discovery/schema-ddl/Schema.sql'), '\nchanged source\n');
        assert.equal(inspect().freshness, 'stale');
        const stale = run('check-phase-completion', 'discovery');
        assert.equal(stale.exitCode, 1);
        assert.equal(stale.report.complete, false);
        assert.equal(stale.report.freshness, 'stale');
        const preparation = run('inspect-migration-state', 'discovery');
        assert.equal(preparation.exitCode, 0);
        assert.equal(preparation.report.action, 'run');
        assert.equal(preparation.report.prerequisite, 'preflight');
        assert.equal(preparation.report.preflightSteps[0], 'application-details');
        assert.equal(preparation.report.completion.freshness, 'stale');
        assert.equal(run('inspect-migration-state').report.phase, 'preflight');
    } finally {
        fs.rmSync(workspace, { recursive: true });
        fs.rmSync(peerRoot, { recursive: true });
    }
});

test('reports missing freshness and propagates restored upstream staleness', () => {
    const { workspace, project } = workspaceProject();
    try {
        const inventory = sourceFixture(workspace, project);
        discoveryFixture(workspace, inventory, project);
        project.phases.assessment = {
            status: 'complete',
            domains: [{ name: 'Orders', tables: ['dbo.Orders'], isMapped: true, estimatedTokens: 1, crossDomainDependencies: [] }],
        };
        assessmentFixture(workspace, project, inventory);
        project.phases.schemaConversion = { status: 'complete', domains: ['Orders'] };
        fs.writeFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), JSON.stringify(project));
        const domainModel = conversionModel('Orders');
        const rootModel = conversionModel('all');
        conversionFixture(workspace, inventory, [{ domainName: 'Orders', model: domainModel }], rootModel, project);
        fs.writeFileSync(
            path.join(workspace, '.cosmosdb-migration/phases/3-schema-conversion/model.json'),
            canonicalStringify(canonicalizeCosmosModel(rootModel)),
        );
        assert.equal(checkPhaseCompletion(workspace, 'schema-conversion').freshness, 'current');
        const discoveryPath = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/discovery-manifest.json');
        const discovery = fs.readFileSync(discoveryPath, 'utf8');
        fs.writeFileSync(discoveryPath, `${discovery.trimEnd()} \n`);
        assert.equal(checkPhaseCompletion(workspace, 'assessment').freshness, 'stale');
        const staleConversion = checkPhaseCompletion(workspace, 'schema-conversion');
        assert.equal(staleConversion.freshness, 'stale');
        assert.equal(staleConversion.complete, false);
        fs.writeFileSync(discoveryPath, discovery);
        assert.equal(checkPhaseCompletion(workspace, 'schema-conversion').freshness, 'current');
        assert.deepEqual(validateFreshnessManifest(workspace, project, 'discovery', undefined), {
            freshness: 'unknown',
            staleInputs: [{ id: 'freshness-manifest', reason: 'missing or invalid version 1 freshness manifest' }],
        });
        delete project.freshness.discovery;
        fs.writeFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), JSON.stringify(project));
        const missingFreshness = checkPhaseCompletion(workspace, 'discovery');
        assert.equal(missingFreshness.freshness, 'unknown');
        assert.equal(missingFreshness.complete, false);
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});
