import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    checkPhaseCompletion,
    MAX_COMPLETION_OUTPUT_BYTES,
    summarizePhaseCompletion,
} from '../scripts/check-phase-completion.mjs';
import { buildCompatibilityReport } from '../scripts/check-sdk-compatibility.mjs';
import { buildFreshnessManifest, fileSha256 } from '../scripts/freshness.mjs';
import { buildProvisioningArtifacts } from '../scripts/generate-provisioning-artifacts.mjs';
import { readPhaseEvidence } from '../scripts/phase-summary.mjs';
import {
    canonicalizeCosmosModel,
    canonicalStringify,
    validateCosmosModel,
} from '../scripts/validate-cosmos-model.mjs';
import { modelSha256 } from '../scripts/validate-provisioning-verification.mjs';
import { assessmentFixture, conversionFixture, discoveryFixture, domainSummary, sourceFixture, verificationSummary } from './source-evidence-fixtures.mjs';

const completionScript = fileURLToPath(new URL('../scripts/check-phase-completion.mjs', import.meta.url));

function workspaceWithProject(project) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-phase-check-'));
    fs.mkdirSync(path.join(workspace, '.cosmosdb-migration'), { recursive: true });
    const compatibleProject = {
        name: 'migration-app',
        sourceCode: 'parent',
        ...project,
    };
    fs.writeFileSync(
        path.join(workspace, '.cosmosdb-migration', 'project.json'),
        `${JSON.stringify(compatibleProject, null, 2)}\n`,
    );
    return workspace;
}

function write(workspace, relativePath, content = '# artifact\n') {
    const filePath = path.join(workspace, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function provisioningModel() {
    return {
        version: 1,
        domain: 'all',
        databaseName: 'migration-db',
        capacityMode: 'serverless',
        containers: [
            {
                name: 'Items',
                partitionKeys: [{ path: '/pk' }],
                entities: [
                    {
                        name: 'Item',
                        docType: 'item',
                        sourceTable: 'dbo.Items',
                        idTemplate: 'item-{Id}',
                        attributes: [
                            {
                                target: 'id',
                                source: { table: 'Items', column: 'Id', type: 'varchar' },
                                type: 'string',
                                isId: true,
                            },
                            {
                                target: 'itemId',
                                source: { table: 'Items', column: 'Id', type: 'varchar' },
                                type: 'string',
                            },
                            {
                                target: 'tenantId',
                                source: { table: 'Items', column: 'TenantId', type: 'varchar' },
                                type: 'string',
                            },
                            {
                                target: 'pk',
                                source: { table: 'Items', column: 'Pk', type: 'varchar' },
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
}

function prepareConversionChain(workspace, project, model, language = 'TypeScript') {
    project.name ??= 'migration-app';
    project.sourceCode ??= 'parent';
    project.phases.discovery = {
        ...project.phases.discovery,
        preflightStatus: 'complete',
        status: 'complete',
        applicationAnalysis: {
            projectName: 'app',
            projectType: 'service',
            language,
            frameworks: ['test'],
            databaseType: 'SQL Server',
            databaseAccess: 'ORM',
            completedAt: '2026-09-07T00:00:00.000Z',
        },
    };
    project.phases.assessment = {
        status: 'complete',
        domains: [
            {
                name: 'Items',
                tables: ['dbo.Items'],
                isMapped: true,
                estimatedTokens: 1,
                crossDomainDependencies: [],
            },
        ],
    };
    project.phases.schemaConversion = {
        status: 'complete',
        domains: ['Items'],
        completedAt: '2026-09-07T00:00:00.000Z',
    };
    const inventory = sourceFixture(workspace, project, ['dbo.Items']);
    discoveryFixture(workspace, inventory, project);
    assessmentFixture(workspace, project, inventory);
    conversionFixture(workspace, inventory, [{ domainName: 'Items', model: { ...model, domain: 'Items' } }], model, project);
    write(
        workspace,
        '.cosmosdb-migration/phases/3-schema-conversion/model.json',
        canonicalStringify(canonicalizeCosmosModel(model)),
    );
}

test('completes valid conversions with design notes while retaining correctness gates', () => {
    const project = { version: 1, phases: {} };
    const workspace = workspaceWithProject(project);
    try {
        const model = provisioningModel();
        prepareConversionChain(workspace, project, model);
        const manifestPath = '.cosmosdb-migration/phases/3-schema-conversion/manifest.json';
        const evidence = readPhaseEvidence(path.join(workspace, manifestPath));
        const decision = { kind: 'design-decision', message: 'Revisit index tuning with production measurements.' };
        const saveIssues = issues => {
            evidence.blockingIssues = issues;
            write(workspace, manifestPath, JSON.stringify(evidence));
            project.freshness['schema-conversion'] = buildFreshnessManifest(workspace, project, 'schema-conversion');
            write(workspace, '.cosmosdb-migration/project.json', JSON.stringify(project));
        };
        saveIssues([decision]);
        let result = checkPhaseCompletion(workspace, 'schema-conversion');
        assert.equal(result.complete, true, JSON.stringify(result));
        assert.equal(result.freshness, 'current');
        assert.deepEqual(readPhaseEvidence(path.join(workspace, manifestPath)).blockingIssues, [decision]);

        for (const kind of ['invalid-model', 'data-loss', 'unsupported-behavior', 'failed-validation']) {
            saveIssues([decision, { kind, message: 'A concrete correctness check failed.', evidence: ['summary.md#validation'] }]);
            result = checkPhaseCompletion(workspace, 'schema-conversion');
            assert.equal(result.complete, false);
            assert(result.artifacts.some(artifact => artifact.description === 'Root schema conversion manifest' &&
                artifact.state === 'invalid' && artifact.diagnostics.some(diagnostic => /terminal/u.test(diagnostic.message))));
        }

        model.containers[0].partitionKeys = [];
        write(workspace, '.cosmosdb-migration/phases/3-schema-conversion/model.json', JSON.stringify(model));
        saveIssues([decision]);
        result = checkPhaseCompletion(workspace, 'schema-conversion');
        assert.equal(result.complete, false);
        assert(result.artifacts.some(artifact => artifact.description === 'Canonical root Cosmos DB model' && artifact.state === 'invalid'));
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('summarizes and paginates completion failures within the output ceiling', () => {
    const completion = {
        phase: 'assessment',
        status: 'complete',
        complete: false,
        freshness: 'stale',
        artifacts: Array.from({ length: 30 }, (_, index) => ({
            path: `artifact-${index}.json`,
            description: `Artifact ${index}`,
            conditional: false,
            state: index === 29 ? 'present' : 'invalid',
            diagnostics: [{ path: `$.items[${index}]`, message: `Invalid item ${index}` }],
        })),
        staleInputs: [{ id: 'source', reason: 'Source changed' }],
        errors: ['Project status conflicts with its artifacts'],
    };

    const first = summarizePhaseCompletion(completion, { limit: 5 });
    assert.deepEqual(first.artifactCounts, { total: 30, present: 1, missing: 0, invalid: 29 });
    assert.equal(first.totalFailures, 31);
    assert.equal(first.returnedFailures, 5);
    assert.equal(first.nextOffset, 5);
    assert.equal(first.truncated, true);
    assert.equal(first.artifacts.length, 5);
    assert(Buffer.byteLength(`${JSON.stringify(first, null, 2)}\n`) <= MAX_COMPLETION_OUTPUT_BYTES);

    const second = summarizePhaseCompletion(completion, { offset: first.nextOffset, limit: 5 });
    assert.equal(second.artifacts[0].path, 'artifact-5.json');
    const selected = summarizePhaseCompletion(completion, { artifactPath: 'artifact-12.json' });
    assert.equal(selected.totalFailures, 1);
    assert.equal(selected.artifacts[0].path, 'artifact-12.json');
});

test('omits an individually oversized diagnostic without failing validation', () => {
    const completion = {
        phase: 'discovery',
        status: 'complete',
        complete: false,
        freshness: 'current',
        artifacts: [{
            path: 'discovery-manifest.json',
            description: 'Discovery manifest',
            conditional: false,
            state: 'invalid',
            diagnostics: [{ path: '$.patterns', message: 'x'.repeat(MAX_COMPLETION_OUTPUT_BYTES * 2) }],
        }],
        staleInputs: [],
        errors: [],
    };

    const summary = summarizePhaseCompletion(completion);
    assert.equal(summary.complete, false);
    assert.equal(summary.returnedFailures, 1);
    assert.equal(summary.artifacts[0].diagnostics, undefined);
    assert.equal(summary.artifacts[0].diagnosticsOmitted, 'exceeds output limit');
    assert(Buffer.byteLength(`${JSON.stringify(summary, null, 2)}\n`) <= MAX_COMPLETION_OUTPUT_BYTES);
});

test('CLI keeps the validation exit status when failure output is truncated', () => {
    const domains = Array.from({ length: 100 }, (_, index) => ({
        name: `Domain${index}`,
        tables: [`dbo.Table${index}`],
        crossDomainDependencies: [],
        estimatedTokens: 1000,
        isMapped: true,
    }));
    const workspace = workspaceWithProject({
        version: 1,
        phases: { discovery: { status: 'complete' }, assessment: { status: 'complete', domains } },
    });
    try {
        const result = spawnSync(
            process.execPath,
            [completionScript, '--workspace', workspace, '--phase', 'assessment'],
            { encoding: 'utf8' },
        );
        const summary = JSON.parse(result.stdout);
        assert.equal(result.status, 1);
        assert.equal(summary.complete, false);
        assert.equal(summary.truncated, true);
        assert(summary.nextOffset > 0);
        assert(Buffer.byteLength(result.stdout) <= MAX_COMPLETION_OUTPUT_BYTES);
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('does not accept a complete status when discovery output is missing', () => {
    const workspace = workspaceWithProject({ version: 1, phases: { discovery: { status: 'complete' } } });
    const result = checkPhaseCompletion(workspace, 'discovery');
    assert.equal(result.complete, false);
    assert(
        result.artifacts.some(
            (artifact) => artifact.path.endsWith('discovery-manifest.json') && artifact.state === 'missing',
        ),
    );
    fs.rmSync(workspace, { recursive: true });
});

test('accepts discovery only when status and report both exist', () => {
    const workspace = workspaceWithProject({ version: 1, phases: { discovery: { status: 'complete' } } });
    const project = JSON.parse(fs.readFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), 'utf8'));
    discoveryFixture(workspace, sourceFixture(workspace, project), project);
    const namedResult = checkPhaseCompletion(workspace, 'discovery');
    assert.equal(namedResult.complete, true);
    assert.deepEqual(checkPhaseCompletion(workspace, '1'), namedResult);
    fs.rmSync(workspace, { recursive: true });
});

test('allows optional frameworks while rejecting malformed framework values', () => {
    for (const [frameworks, expectedComplete] of [
        [undefined, true],
        [[], true],
        [['Django'], true],
        [[''], false],
        [['   '], false],
        [[42], false],
        ['Django', false],
        [null, false],
    ]) {
        const workspace = workspaceWithProject({ version: 1, phases: { discovery: { status: 'complete' } } });
        try {
            const project = JSON.parse(fs.readFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), 'utf8'));
            project.phases.discovery.applicationAnalysis = {
                projectName: 'python-service',
                projectType: 'service',
                language: 'Python',
                databaseType: 'SQL Server',
                databaseAccess: 'DB-API',
                completedAt: '2026-10-03T00:00:00.000Z',
                ...(frameworks === undefined ? {} : { frameworks }),
            };
            discoveryFixture(workspace, sourceFixture(workspace, project), project);
            for (const phase of ['preflight', 'discovery']) {
                assert.equal(checkPhaseCompletion(workspace, phase).complete, expectedComplete,
                    `${phase} with frameworks ${JSON.stringify(frameworks)}`);
            }
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    }
});

test('does not complete preflight or Discovery when a raw workload log is ignored', () => {
    const workspace = workspaceWithProject({ version: 1, phases: { discovery: { status: 'complete' } } });
    try {
        const projectPath = path.join(workspace, '.cosmosdb-migration/project.json');
        const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
        const csvPath = '.cosmosdb-migration/phases/1-discovery/volumetrics/workload.csv';
        write(workspace, csvPath, 'timestamp,duration_ms\n2026-10-03T00:00:00Z,12\n');
        discoveryFixture(workspace, sourceFixture(workspace, project), project);
        const ignored = checkPhaseCompletion(workspace, 'preflight');
        assert.equal(ignored.freshness, 'current');
        assert.equal(ignored.complete, false);
        assert.equal(checkPhaseCompletion(workspace, 'discovery').complete, false);
        assert(ignored.artifacts.some(artifact => artifact.diagnostics?.some(error => error.path.includes('workloadInputs'))));
        const manifestPath = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json');
        const manifest = readPhaseEvidence(manifestPath);
        manifest.workloadInputs = [{
            source: 'volumetrics', path: csvPath, sha256: fileSha256(path.join(workspace, csvPath)),
            disposition: 'used', evidenceKind: 'unknown', rationale: 'Query timing evidence reviewed; provenance needs confirmation.',
        }];
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        project.freshness.preflight = buildFreshnessManifest(workspace, project, 'preflight');
        fs.writeFileSync(projectPath, JSON.stringify(project));
        assert.equal(checkPhaseCompletion(workspace, 'preflight').complete, true);
        fs.appendFileSync(path.join(workspace, csvPath), '2026-10-03T00:00:01Z,20\n');
        project.freshness.preflight = buildFreshnessManifest(workspace, project, 'preflight');
        fs.writeFileSync(projectPath, JSON.stringify(project));
        assert.equal(checkPhaseCompletion(workspace, 'preflight').complete, false);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('rejects stale DDL evidence, impossible values and placeholder prose', () => {
    const workspace = workspaceWithProject({ version: 1, phases: { discovery: { status: 'complete', preflightStatus: 'complete' } } });
    try {
        const project = JSON.parse(fs.readFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), 'utf8'));
        const inventory = sourceFixture(workspace, project);
        discoveryFixture(workspace, inventory, project);
        assert.equal(checkPhaseCompletion(workspace, 'preflight').complete, true);
        const volumetricsPath = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/volumetrics/volumetrics.md');
        const content = fs.readFileSync(volumetricsPath, 'utf8');
        fs.writeFileSync(volumetricsPath, content.replace('| 100 |', '| -100 |'));
        assert.equal(checkPhaseCompletion(workspace, 'preflight').complete, false);
        fs.writeFileSync(volumetricsPath, content);
        write(workspace, '.cosmosdb-migration/phases/1-discovery/discovery-report.md', '# placeholder');
        assert.equal(checkPhaseCompletion(workspace, 'discovery').complete, false);
        write(workspace, '.cosmosdb-migration/phases/1-discovery/schema-ddl/Schema.sql', '-- source changed after inventory review');
        assert.equal(checkPhaseCompletion(workspace, 'preflight').complete, false);
    } finally { fs.rmSync(workspace, { recursive: true }); }
});

test('discovery accepts unsupported SDK evidence but rejects a contradictory permission with diagnostics', () => {
    const workspace = workspaceWithProject({ version: 1, phases: { discovery: { status: 'complete', preflightStatus: 'complete' } } });
    try {
        const project = JSON.parse(fs.readFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), 'utf8'));
        prepareConversionChain(workspace, project, provisioningModel(), 'Perl');
        const initialDiscovery = checkPhaseCompletion(workspace, 'discovery');
        assert.equal(initialDiscovery.complete, true, JSON.stringify(initialDiscovery, null, 2));
        assert.equal(checkPhaseCompletion(workspace, 'schema-conversion').complete, true);
        const manifestPath = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/discovery-manifest.json');
        const original = fs.readFileSync(manifestPath, 'utf8');
        const originalFreshness = project.freshness.discovery;
        const evidence = readPhaseEvidence(manifestPath);
        evidence.sdkCompatibility.codeMigrationAllowed = true;
        fs.writeFileSync(manifestPath, JSON.stringify(evidence));
        project.freshness.discovery = buildFreshnessManifest(workspace, project, 'discovery');
        fs.writeFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), JSON.stringify(project));
        const result = checkPhaseCompletion(workspace, 'discovery');
        assert.equal(result.complete, false);
        assert.equal(result.freshness, 'current');
        const sdkArtifact = result.artifacts.find(artifact => artifact.description === 'SDK compatibility report');
        assert.equal(sdkArtifact.state, 'invalid');
        assert(sdkArtifact.diagnostics.some(error => error.path === 'discovery-manifest.json#sdkCompatibility.codeMigrationAllowed'));
        fs.writeFileSync(manifestPath, original);
        project.freshness.discovery = originalFreshness;
        fs.writeFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), JSON.stringify(project));
        assert.equal(checkPhaseCompletion(workspace, 'discovery').complete, true);
        assert.equal(checkPhaseCompletion(workspace, 'schema-conversion').complete, true);
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('requires both the preflight flag and all preflight artifacts', () => {
    const workspace = workspaceWithProject({
        version: 1,
        phases: {
            discovery: {
                preflightStatus: 'complete',
                status: 'not-started',
                applicationAnalysis: {
                    projectName: 'shop',
                    projectType: 'service',
                    language: 'TypeScript',
                    frameworks: ['Node.js'],
                    databaseType: 'SQL Server',
                    databaseAccess: 'ORM',
                    completedAt: '2026-01-01T00:00:00.000Z',
                },
            },
        },
    });
    for (const [artifactPath, content] of [
        ['.cosmosdb-migration/phases/1-discovery/schema-ddl/Shop.sql', 'CREATE TABLE Shop (Id int);\n'],
        [
            '.cosmosdb-migration/phases/1-discovery/volumetrics/volumetrics.md',
            '# Volumetrics\n\n| # | Schema | Table | Est. Row Count |\n|---:|---|---|---:|\n| 1 | dbo | Shop | 100 |\n',
        ],
        [
            '.cosmosdb-migration/phases/1-discovery/access-patterns/access-patterns.md',
            '# Access Patterns\n\n## Read Patterns\n\n| # | Pattern Name | Tables / Entities | Filter / Lookup Fields |\n|---:|---|---|---|\n| R1 | Get Shop | dbo.Shop | Id |\n\n## Write Patterns\n\n| # | Pattern Name | Tables / Entities | Single / Batch |\n|---:|---|---|---|\n',
        ],
        ['.cosmosdb-migration/phases/1-discovery/preflight-summary.md', '# Preflight\n'],
    ]) {
        write(workspace, artifactPath, content);
    }
    const project = JSON.parse(fs.readFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), 'utf8'));
    sourceFixture(workspace, project, ['dbo.Shop'], 'Shop.sql');
    assert.equal(checkPhaseCompletion(workspace, 'preflight').complete, true);
    write(workspace, '.cosmosdb-migration/phases/1-discovery/schema-ddl/Shop.sql', '-- source changed after inventory review\n');
    let result = checkPhaseCompletion(workspace, 'preflight');
    assert.equal(result.complete, false);
    assert(result.artifacts.some((artifact) => artifact.description === 'Authoritative schema DDL' && artifact.state === 'invalid'));
    sourceFixture(workspace, project, ['dbo.Shop'], 'Shop.sql');
    const preflightPath = path.join(workspace, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json');
    const preflight = readPhaseEvidence(preflightPath);
    preflight.blockingIssues = [{
        kind: 'design-decision',
        message: 'Source collation is unspecified; select target comparison and constraint handling during conversion.',
    }];
    fs.writeFileSync(preflightPath, JSON.stringify(preflight));
    project.freshness.preflight = buildFreshnessManifest(workspace, project, 'preflight');
    write(workspace, '.cosmosdb-migration/project.json', JSON.stringify(project));
    result = checkPhaseCompletion(workspace, 'preflight');
    assert.equal(result.complete, true, JSON.stringify(result));
    preflight.blockingIssues = ['Resolve source evidence.'];
    fs.writeFileSync(preflightPath, JSON.stringify(preflight));
    result = checkPhaseCompletion(workspace, 'preflight');
    assert.equal(result.complete, false);
    assert(result.artifacts.some((artifact) => artifact.description === 'Preflight evidence manifest' && artifact.state === 'invalid'));
    preflight.blockingIssues = [];
    fs.writeFileSync(preflightPath, JSON.stringify(preflight));
    fs.rmSync(
        path.join(workspace, '.cosmosdb-migration/phases/1-discovery/access-patterns/access-patterns.md'),
    );
    result = checkPhaseCompletion(workspace, 'preflight');
    assert.equal(result.complete, false);
    fs.rmSync(workspace, { recursive: true });
});

test('derives assessment domain artifacts from project metadata', () => {
    const workspace = workspaceWithProject({
        version: 1,
        phases: {
            discovery: { status: 'complete' },
            assessment: {
                status: 'complete',
                domains: [
                    {
                        name: 'Orders',
                        tables: ['dbo.Orders'],
                        crossDomainDependencies: [],
                        estimatedTokens: 1000,
                        isMapped: true,
                    },
                    {
                        name: 'Catalog',
                        tables: ['dbo.Products'],
                        crossDomainDependencies: [],
                        estimatedTokens: 1000,
                        isMapped: true,
                    },
                ],
            },
        },
    });
    const project = JSON.parse(fs.readFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), 'utf8'));
    const inventory = sourceFixture(workspace, project, ['dbo.Orders', 'dbo.Products']);
    assessmentFixture(workspace, project, inventory);
    fs.rmSync(path.join(workspace, '.cosmosdb-migration/phases/2-assessment/domains/Catalog.manifest.json'));
    let result = checkPhaseCompletion(workspace, 'assessment');
    assert.equal(result.complete, false);
    assert(result.artifacts.some((artifact) => artifact.path.endsWith('Catalog.manifest.json') && artifact.state === 'missing'));
    assessmentFixture(workspace, project, inventory);
    result = checkPhaseCompletion(workspace, 'assessment');
    assert.equal(result.complete, true);
    fs.rmSync(workspace, { recursive: true });
});

test('rejects semantically valid schema-conversion models that are not canonical', () => {
    const workspace = workspaceWithProject({
        version: 1,
        phases: {
            discovery: { status: 'complete' },
            schemaConversion: { status: 'complete', domains: ['Items'], thoroughAnalysis: true },
        },
    });
    const model = {
        version: 1,
        domain: 'all',
        databaseName: 'migration-db',
        capacityMode: 'serverless',
        containers: [
            {
                name: 'Items',
                partitionKeys: [{ path: '/pk' }],
                entities: [
                    {
                        name: 'Item',
                        docType: 'item',
                        sourceTable: 'dbo.Items',
                        idTemplate: 'item-{Id}',
                        attributes: [
                            {
                                target: 'id',
                                source: { table: 'Items', column: 'Id', type: 'varchar' },
                                type: 'string',
                                isId: true,
                            },
                            {
                                target: 'itemId',
                                source: { table: 'Items', column: 'Id', type: 'varchar' },
                                type: 'string',
                            },
                            {
                                target: 'tenantId',
                                source: { table: 'Items', column: 'TenantId', type: 'varchar' },
                                type: 'string',
                            },
                            {
                                target: 'pk',
                                source: { table: 'Items', column: 'Pk', type: 'varchar' },
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
    assert.deepEqual(validateCosmosModel(model), []);
    const canonical = canonicalStringify(canonicalizeCosmosModel(model));
    const domainModel = { ...model, domain: 'Items' };
    const project = JSON.parse(fs.readFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), 'utf8'));
    project.phases.assessment = { status: 'complete', domains: [{ name: 'Items', tables: ['dbo.Items'], isMapped: true, estimatedTokens: 1, crossDomainDependencies: [] }] };
    const inventory = sourceFixture(workspace, project, ['dbo.Items']);
    discoveryFixture(workspace, inventory, project, {
        patterns: [{
            id: 'R001',
            kind: 'read',
            tables: ['dbo.Items'],
            tps: 1,
            operation: 'Read an item',
            evidence: 'query-only',
            sourcePaths: [],
        }],
        noObservedAccess: [],
    });
    conversionFixture(workspace, inventory, [{ domainName: 'Items', model: domainModel }], model, project);
    write(workspace, '.cosmosdb-migration/phases/3-schema-conversion/model.json', JSON.stringify(model));
    let result = checkPhaseCompletion(workspace, 'schema-conversion');
    assert.equal(result.complete, false);
    assert(result.artifacts.some((artifact) => artifact.path.endsWith('model.json') && artifact.state === 'invalid'));
    write(workspace, '.cosmosdb-migration/phases/3-schema-conversion/model.json', canonical);
    result = checkPhaseCompletion(workspace, 'schema-conversion');
    assert.equal(result.complete, true, JSON.stringify(result, null, 2));
    assert.equal(
        result.artifacts.some((artifact) => artifact.description.includes('Thorough analysis')),
        false,
    );
    write(
        workspace,
        '.cosmosdb-migration/phases/3-schema-conversion/domains/Items/summary.md',
        domainSummary().replace('R001 maps to a partition-routed point read.', 'No access patterns are mapped.'),
    );
    result = checkPhaseCompletion(workspace, 'schema-conversion');
    const uncoveredPatternSummary = result.artifacts.find(
        artifact => artifact.description === 'Schema conversion summary for Items',
    );
    assert.equal(uncoveredPatternSummary?.state, 'invalid');
    assert(
        uncoveredPatternSummary?.diagnostics?.some(
            diagnostic => diagnostic.path === '$.sections.accessPatterns.R001',
        ),
    );
    write(workspace, '.cosmosdb-migration/phases/3-schema-conversion/domains/Items/summary.md', '# Incomplete\n');
    result = checkPhaseCompletion(workspace, 'schema-conversion');
    assert.equal(result.complete, false);
    assert(
        result.artifacts.some(
            (artifact) => artifact.description === 'Schema conversion summary for Items' && artifact.state === 'invalid',
        ),
    );
    write(
        workspace,
        '.cosmosdb-migration/phases/3-schema-conversion/domains/Items/summary.md',
        domainSummary(),
    );
    write(
        workspace,
        '.cosmosdb-migration/phases/3-schema-conversion/domains/Items/cosmos-model.json',
        JSON.stringify({ databaseName: 'broken', containers: [{}] }),
    );
    result = checkPhaseCompletion(workspace, 'schema-conversion');
    assert.equal(result.complete, false);
    assert(
        result.artifacts.some(
            (artifact) => artifact.description === 'Schema conversion summary for Items' && artifact.state === 'invalid',
        ),
    );
    fs.rmSync(workspace, { recursive: true });
});

test('requires every fixed and declared provisioning artifact', () => {
    const project = {
        version: 1,
        phases: {
            discovery: { status: 'complete' },
            targetEnvironment: {
                type: 'emulator',
                endpoint: 'https://localhost:8081/',
                verified: true,
                verifiedAt: '2026-09-07T00:00:00.000Z',
            },
            provisioning: {
                status: 'complete',
                databaseName: 'migration-db',
                containersCreated: ['Items'],
                sampleDataInserted: true,
                artifactPaths: ['.cosmosdb-migration/phases/4-provisioning/target.json'],
                completedAt: '2026-09-07T00:00:00.000Z',
            },
        },
    };
    const workspace = workspaceWithProject(project);
    const model = provisioningModel();
    prepareConversionChain(workspace, project, model);
    const sampleData = {
        sampleData: [
            {
                containerName: 'Items',
                items: [{ id: 'item-1', docType: 'item', itemId: '1', tenantId: 'tenant-1', pk: 'tenant-1' }],
            },
        ],
    };
    write(
        workspace,
        '.cosmosdb-migration/phases/4-provisioning/sample-data.json',
        `${JSON.stringify(sampleData, null, 2)}\n`,
    );
    for (const [artifactName, content] of Object.entries(buildProvisioningArtifacts(model, sampleData, project))) {
        write(workspace, `.cosmosdb-migration/phases/4-provisioning/${artifactName}`, content);
    }
    write(
        workspace,
        '.cosmosdb-migration/phases/4-provisioning/summary.md',
        verificationSummary(
            workspace,
            project,
            {
                version: 1,
                verifiedAt: '2026-09-07T00:00:00.000Z',
                modelSha256: modelSha256(model),
                target: { type: 'emulator', endpoint: 'https://localhost:8081/' },
                databaseName: 'migration-db',
                containers: [
                    {
                        name: 'Items',
                        partitionKeys: ['/pk'],
                        indexingPolicy: {
                            ...model.containers[0].indexingPolicy,
                            indexingMode: 'consistent',
                            automatic: true,
                        },
                        capacityMode: 'provisioned',
                        maxThroughput: 1000,
                    },
                ],
                sampleItems: [
                    { containerName: 'Items', id: 'item-1', partitionKeyValues: ['tenant-1'], found: true, document: structuredClone(sampleData.sampleData[0].items[0]) },
                ],
                failures: [],
            },
        ),
    );
    assert.equal(checkPhaseCompletion(workspace, 'provisioning').complete, false);
    write(workspace, '.cosmosdb-migration/phases/4-provisioning/target.json', '{}\n');
    const completedProvisioning = checkPhaseCompletion(workspace, 'provisioning');
    assert.equal(completedProvisioning.complete, true, JSON.stringify(completedProvisioning, null, 2));
    const verificationManifestPath = path.join(
        workspace,
        '.cosmosdb-migration/phases/4-provisioning/manifest.json',
    );
    const partialEvidence = readPhaseEvidence(verificationManifestPath);
    const partialVerification = partialEvidence.verification;
    for (const [mutate, diagnosticPath] of [
        [report => { delete report.target.endpoint; }, '$.target.endpoint'],
        [report => { delete report.sampleItems[0].document; }, '$.sampleItems[0].document'],
        [report => { report.target.endpoint = 'https://localhost:8082/'; }, '$.target.endpoint'],
        [report => { report.sampleItems[0].document.itemId = 'wrong-content'; }, '$.sampleItems[0].document'],
    ]) {
        const rejected = structuredClone(partialVerification);
        mutate(rejected);
        verificationSummary(workspace, project, rejected);
        const before = fs.readFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), 'utf8');
        const result = checkPhaseCompletion(workspace, 'provisioning');
        assert.equal(result.complete, false);
        assert.equal(result.freshness, 'current');
        const artifact = result.artifacts.find(artifact => artifact.description === 'Provisioning verification manifest');
        assert.equal(artifact.state, 'invalid');
        assert(artifact.diagnostics.some(error => error.path === diagnosticPath));
        assert.equal(fs.readFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), 'utf8'), before);
    }
    verificationSummary(workspace, project, partialVerification);
    assert.equal(checkPhaseCompletion(workspace, 'provisioning').complete, true);
    partialVerification.sampleItems[0].found = false;
    partialVerification.failures.push({ operation: 'upsert-item', resource: 'Items/item-1', code: '429' });
    write(
        workspace,
        '.cosmosdb-migration/phases/4-provisioning/manifest.json',
        JSON.stringify(partialEvidence),
    );
    const partial = checkPhaseCompletion(workspace, 'provisioning');
    assert.equal(partial.complete, false);
    assert(
        partial.artifacts.some(
            (artifact) => artifact.description === 'Provisioning verification manifest' && artifact.state === 'invalid',
        ),
    );
    partialVerification.sampleItems[0].found = true;
    partialVerification.failures = [];
    write(
        workspace,
        '.cosmosdb-migration/phases/4-provisioning/summary.md',
        verificationSummary(workspace, project, partialVerification),
    );
    write(workspace, '.cosmosdb-migration/phases/4-provisioning/sample-data.json', '[]\n');
    const invalid = checkPhaseCompletion(workspace, 'provisioning');
    assert.equal(invalid.complete, false);
    assert(
        invalid.artifacts.some(
            (artifact) => artifact.description === 'Validated sample data' && artifact.state === 'invalid',
        ),
    );
    write(workspace, '.cosmosdb-migration/phases/4-provisioning/sample-data.json', `${JSON.stringify(sampleData, null, 2)}\n`);
    write(workspace, '.cosmosdb-migration/phases/4-provisioning/main.bicep', 'resource drift string\n');
    const drifted = checkPhaseCompletion(workspace, 'provisioning');
    assert.equal(drifted.complete, false);
    assert(
        drifted.artifacts.some(
            (artifact) => artifact.description === 'Bicep deployment template' && artifact.state === 'invalid',
        ),
    );
    project.phases.provisioning.artifactPaths = ['../outside.json'];
    write(
        workspace,
        '.cosmosdb-migration/project.json',
        `${JSON.stringify({ name: 'migration-app', sourceCode: 'parent', ...project }, null, 2)}\n`,
    );
    const escaped = checkPhaseCompletion(workspace, 'provisioning');
    assert.equal(escaped.complete, false);
    assert(escaped.artifacts.some((artifact) => artifact.path === '../outside.json' && artifact.state === 'invalid'));
    write(
        workspace,
        '.cosmosdb-migration/phases/3-schema-conversion/model.json',
        '{"databaseName":"broken","containers":{}}\n',
    );
    const malformedModel = checkPhaseCompletion(workspace, 'provisioning');
    assert.equal(malformedModel.complete, false);
    assert(
        malformedModel.artifacts.some(
            (artifact) => artifact.description === 'Canonical root Cosmos DB model' && artifact.state === 'invalid',
        ),
    );
    fs.rmSync(workspace, { recursive: true });
});

test('does not complete provisioning from target-account verification alone', () => {
    const workspace = workspaceWithProject({
        version: 1,
        phases: {
            discovery: { status: 'complete' },
            targetEnvironment: {
                type: 'provision',
                accountName: 'migration-account',
                location: 'eastus',
                verified: true,
                verifiedAt: '2026-09-07T00:00:00.000Z',
            },
            provisioning: { status: 'complete' },
        },
    });
    const result = checkPhaseCompletion(workspace, 'provisioning');
    assert.equal(result.complete, false);
    assert(result.artifacts.some((artifact) => artifact.description === 'Provisioning verification manifest'));
    fs.rmSync(workspace, { recursive: true });
});

test('preserves code-migration history independently of current application and model files', () => {
    const outputContent = 'export const migrated = true;\n';
    const outputHash = createHash('sha256').update(outputContent).digest('hex');
    const workspace = workspaceWithProject({
        version: 1,
        migrationMode: 'plan',
        phases: {
            discovery: { status: 'complete', applicationAnalysis: { language: 'TypeScript' } },
            codeMigration: {
                status: 'complete',
                planPath: '.cosmosdb-migration/code-migration-plan.md',
                outputPaths: ['src/data/cosmosClient.ts'],
                completedAt: '2026-09-07T00:00:00.000Z',
            },
        },
    });
    const model = provisioningModel();
    const modelContent = canonicalStringify(canonicalizeCosmosModel(model));
    const sdkReportContent = `${JSON.stringify(buildCompatibilityReport(['TypeScript']), null, 2)}\n`;
    const codeMigrationManifest = {
        version: 1,
        mode: 'migrate',
        modelSha256: createHash('sha256').update(modelContent).digest('hex'),
        sdkReportSha256: createHash('sha256').update(sdkReportContent).digest('hex'),
        bestPractices: {
            rules: ['rules/sdk-singleton-client.md'],
            unresolvedConcerns: [],
        },
        outputFiles: [{ path: 'src/data/cosmosClient.ts', sha256: outputHash }],
        blockingSteps: [],
        validation: [{ command: 'npm run verify', checks: ['build', 'behavior'],
            coverage: 'Compiles the data-access layer and exercises partition-routed reads.', status: 'passed', exitCode: 0 }],
    };
    const project = JSON.parse(fs.readFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), 'utf8'));
    prepareConversionChain(workspace, project, model);
    write(
        workspace,
        '.cosmosdb-migration/code-migration-plan.md',
        `# Code Migration Plan

## Overview
Migrate data access.
## Affected Files
Cosmos client.
## Ordered Changes
1. Add client.
## Access Pattern Migration
Use point reads.
## Configuration and Authentication
Use managed identity.
## Validation
Run tests.
## Rollback
Revert outputs.
## Applied Rules
rules/sdk-singleton-client.md
## Blocker Review
No candidate blockers.
## Unresolved Blockers
None.
`,
    );
    write(workspace, '.cosmosdb-migration/code-migration-manifest.json', JSON.stringify(codeMigrationManifest));
    assert.equal(checkPhaseCompletion(workspace, 'code-migration').complete, true);
    assert.equal(checkPhaseCompletion(workspace, 'code-migration').freshness, 'not-applicable');
    for (const validation of [
        [],
        [{ command: 'echo ok', status: 'passed', exitCode: 0 }],
        [{ ...codeMigrationManifest.validation[0], checks: ['build'] }],
        [{ ...codeMigrationManifest.validation[0], exitCode: 1 }],
    ]) {
        write(workspace, '.cosmosdb-migration/code-migration-manifest.json', JSON.stringify({ ...codeMigrationManifest, validation }));
        assert.equal(checkPhaseCompletion(workspace, 'code-migration').complete, false);
    }
    write(workspace, '.cosmosdb-migration/code-migration-manifest.json', JSON.stringify(codeMigrationManifest));
    write(workspace, 'src/data/cosmosClient.ts', outputContent);
    assert.equal(checkPhaseCompletion(workspace, 'code-migration').complete, true);
    write(workspace, 'src/data/cosmosClient.ts', 'export const migrated = false;\n');
    assert.equal(checkPhaseCompletion(workspace, 'code-migration').complete, true);
    fs.rmSync(path.join(workspace, 'src/data/cosmosClient.ts'));
    fs.rmSync(path.join(workspace, '.cosmosdb-migration/phases'), { recursive: true });
    assert.equal(checkPhaseCompletion(workspace, 'code-migration').complete, true);
    project.phases.codeMigration.status = 'in-progress';
    write(workspace, '.cosmosdb-migration/project.json', JSON.stringify(project));
    assert.equal(checkPhaseCompletion(workspace, 'code-migration').complete, false);
    project.phases.codeMigration.status = 'complete';
    write(workspace, '.cosmosdb-migration/project.json', JSON.stringify(project));
    write(workspace, '.cosmosdb-migration/code-migration-plan.md', '# Invalid execution record\n');
    assert.equal(checkPhaseCompletion(workspace, 'code-migration').complete, false);
    fs.rmSync(workspace, { recursive: true });
});

test('allows plan-mode completion to retain an unsupported SDK blocker', () => {
    const workspace = workspaceWithProject({
        version: 1,
        migrationMode: 'start',
        phases: {
            discovery: { status: 'complete', applicationAnalysis: { language: 'Perl' } },
            codeMigration: {
                status: 'complete',
                planPath: '.cosmosdb-migration/code-migration-plan.md',
                completedAt: '2026-09-07T00:00:00.000Z',
            },
        },
    });
    const model = provisioningModel();
    const modelContent = canonicalStringify(canonicalizeCosmosModel(model));
    const sdkReportContent = `${JSON.stringify(buildCompatibilityReport(['Perl']), null, 2)}\n`;
    const codeMigrationManifest = {
        version: 1,
        mode: 'plan',
        modelSha256: createHash('sha256').update(modelContent).digest('hex'),
        sdkReportSha256: createHash('sha256').update(sdkReportContent).digest('hex'),
        bestPractices: {
            rules: ['rules/sdk-singleton-client.md'],
            unresolvedConcerns: [],
        },
        outputFiles: [],
        blockingSteps: [
            'SDK-001: The source language has no supported SDK. Proposed solution: select a supported-language service boundary; deferred pending the external architecture decision.',
        ],
        validation: [],
    };
    const project = JSON.parse(fs.readFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), 'utf8'));
    prepareConversionChain(workspace, project, model, 'Perl');
    write(
        workspace,
        '.cosmosdb-migration/code-migration-plan.md',
        `# Code Migration Plan

## Overview
Plan a supported-language service boundary.
## Affected Files
No application files change in plan mode.
## Ordered Changes
1. Select a supported SDK boundary.
## Access Pattern Migration
Document the intended mappings.
## Configuration and Authentication
Use managed identity after selecting the target SDK.
## Validation
Validation runs after implementation.
## Rollback
No code has changed.
## Applied Rules
rules/sdk-singleton-client.md
## Blocker Review
SDK-001: The source language has no supported SDK. Proposed solution: select a supported-language service boundary; deferred pending the external architecture decision.
Evidence: The SDK compatibility report marks the source language unsupported.
Solutions considered: Upgrade the framework; introduce a supported-language service boundary.
Recommendation: Introduce a supported-language service boundary.
Recommendation rationale: The boundary preserves the existing application while using a supported Cosmos DB SDK; a full framework upgrade has a larger immediate blast radius.
Reason for deferral: The architecture owner must approve the boundary.
Clearance condition: Record architecture approval.
## Unresolved Blockers
SDK-001: The source language has no supported SDK. Proposed solution: select a supported-language service boundary; deferred pending the external architecture decision.
`,
    );
    write(workspace, '.cosmosdb-migration/code-migration-manifest.json', JSON.stringify(codeMigrationManifest));
    assert.equal(checkPhaseCompletion(workspace, 'code-migration').complete, true);
    fs.rmSync(workspace, { recursive: true });
});
