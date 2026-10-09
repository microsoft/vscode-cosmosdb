import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileSha256 } from '../scripts/freshness.mjs';
import { readPhaseEvidence } from '../scripts/phase-summary.mjs';
import {
    readSourceInventory,
    resolveForeignKey,
    resolveSource,
    sourceFilesHash,
    validateSourceReport,
    validateTemplates,
    validateWorkloadInputs,
} from '../scripts/validate-source-evidence.mjs';
import { evidenceReport, sourceFixture } from './source-evidence-fixtures.mjs';

const inventory = { dialect: 'postgres', sha256: 'source-hash', tables: [{ name: 'public.orders', identity: [{ name: 'public' }, { name: 'orders' }] }] };
const volumetrics = '# Volumetrics\n| # | Schema | Table | Est. Row Count | Avg Row Size (KB) | Growth Rate (month) | Read TPS | Write TPS | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | public | orders | 100 | 1 | 5% | 10 | 1 | observed |';
const patterns = '# Access Patterns\n## Read Patterns\n| # | Pattern Name | Tables / Entities | Filter / Lookup Fields | Frequency (TPS) | Latency Requirement | Notes |\n|---|---|---|---|---|---|---|\n| R001 | GetOrder | public.orders | id | 10 | 10ms | observed |\n## Write Patterns\n| # | Pattern Name | Tables / Entities | Single / Batch | Frequency (TPS) | Latency Requirement | Notes |\n|---|---|---|---|---|---|---|';

test('validates model-reviewed inventory from the preflight manifest without parser tooling', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'model-inventory-'));
    try {
        const project = { phases: { discovery: {} } };
        sourceFixture(workspace, project);
        const migrationRoot = path.join(workspace, '.cosmosdb-migration');
        assert.equal(readSourceInventory(workspace, project).assurance, 'model-reviewed');
        assert.deepEqual(fs.readdirSync(path.join(migrationRoot, 'phases/1-discovery')).sort(), ['access-patterns', 'preflight-manifest.json', 'preflight-summary.md', 'schema-ddl', 'volumetrics']);
        assert.equal(fs.existsSync(path.join(migrationRoot, '.tools')), false);
        const manifestPath = path.join(migrationRoot, 'phases/1-discovery/preflight-manifest.json');
        const evidence = readPhaseEvidence(manifestPath);
        evidence.sourceInventory.parser = { method: 'sqlglot', name: 'sqlglot', version: '30.18.0' };
        fs.writeFileSync(manifestPath, JSON.stringify(evidence));
        assert(readSourceInventory(workspace, project).errors.length);
        project.phases.discovery.ddlParsing = { method: 'sqlglot', decisionSource: 'interactive' };
        assert.equal(readSourceInventory(workspace, project).assurance, 'sqlglot-assisted');
        fs.appendFileSync(path.join(migrationRoot, 'phases/1-discovery/schema-ddl/Schema.sql'), '\nALTER TABLE dbo.Orders ADD Total INT;');
        assert(readSourceInventory(workspace, project).errors.length);
    } finally { fs.rmSync(workspace, { recursive: true }); }
});

test('does not claim SQL syntax validation from matching hashes and inventory shape', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-boundary-'));
    try {
        const project = { phases: { discovery: {} } };
        sourceFixture(workspace, project);
        const migrationRoot = path.join(workspace, '.cosmosdb-migration');
        const ddlPath = path.join(migrationRoot, 'phases/1-discovery/schema-ddl/Schema.sql');
        const manifestPath = path.join(migrationRoot, 'phases/1-discovery/preflight-manifest.json');
        const content = 'this is not valid SQL';
        fs.writeFileSync(ddlPath, content);
        const evidence = readPhaseEvidence(manifestPath);
        evidence.sourceInventory.files = [
            {
                path: '.cosmosdb-migration/phases/1-discovery/schema-ddl/Schema.sql',
                sha256: createHash('sha256').update(content).digest('hex'),
            },
        ];
        evidence.sourceSha256 = sourceFilesHash(evidence.sourceInventory.dialect, evidence.sourceInventory.files);
        fs.writeFileSync(manifestPath, JSON.stringify(evidence));

        const result = readSourceInventory(workspace, project);
        assert.deepEqual(result.errors, []);
        assert.equal(result.assurance, 'model-reviewed');

        evidence.sourceInventory.errors = [{ message: 'The selected interpretation procedure reported malformed syntax.' }];
        fs.writeFileSync(manifestPath, JSON.stringify(evidence));
        assert.match(readSourceInventory(workspace, project).errors[0].message, /no unresolved errors/u);
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('requires exact workload coverage, valid dispositions, and current content hashes', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workload-inventory-'));
    try {
        const project = { phases: { discovery: {} } };
        sourceFixture(workspace, project);
        const relative = '.cosmosdb-migration/phases/1-discovery/volumetrics/workload.csv';
        const file = path.join(workspace, relative);
        fs.writeFileSync(file, 'query,duration_ms\nSELECT 1,12\n');
        const entry = {
            source: 'volumetrics', path: relative, sha256: fileSha256(file),
            disposition: 'used', evidenceKind: 'synthetic', rationale: 'Synthetic query example, not a production rate.',
        };
        assert.deepEqual(validateWorkloadInputs(workspace, project, [entry]), []);
        for (const entries of [undefined, [], [entry, entry], [{ ...entry, sha256: '0'.repeat(64) }],
            [{ ...entry, path: '../outside.csv' }], [{ ...entry, disposition: 'pending' }],
            [{ ...entry, evidenceKind: 'assumed' }], [{ ...entry, rationale: '' }]]) {
            assert(validateWorkloadInputs(workspace, project, entries).length);
        }
        assert.deepEqual(validateWorkloadInputs(workspace, project, [{
            ...entry, disposition: 'excluded', rationale: 'User-approved exclusion of synthetic test traffic.',
        }]), []);
        project.phases.discovery.accessPatterns = {
            path: '.cosmosdb-migration/phases/1-discovery/volumetrics', includedFiles: ['workload.csv'],
        };
        assert(validateWorkloadInputs(workspace, project, [entry]).length);
        assert.deepEqual(validateWorkloadInputs(workspace, project, [entry, { ...entry, source: 'access-patterns' }]), []);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('validates complete templates and rejects invalid numeric, table and pattern identities', () => {
    assert.deepEqual(validateTemplates(volumetrics, patterns, inventory), []);
    for (const invalid of [volumetrics.replace('100', '-100'), volumetrics.replace('orders', 'missing'), volumetrics.replace('Est. Row Count', 'Rows')]) assert(validateTemplates(invalid, patterns, inventory).length);
    assert(validateTemplates(volumetrics, patterns.replace('R001', 'R1'), inventory).length);
});

test('preserves source-specific quoted names and rejects unknown source references', () => {
    assert.equal(resolveSource('PUBLIC.ORDERS', inventory).name, 'public.orders');
    assert.throws(() => resolveSource('"PUBLIC".orders', inventory), /missing/);
});

test('validates and resolves single and composite source foreign keys', () => {
    const sourceInventory = {
        dialect: 'postgres',
        tables: [
            {
                name: 'public.orders',
                identity: [{ name: 'public' }, { name: 'orders' }],
                columns: [{ name: 'tenant_id' }, { name: 'customer_id' }],
                foreignKeys: [{
                    columns: ['tenant_id', 'customer_id'],
                    referencedTable: 'public.customers',
                    referencedColumns: ['tenant_id', 'id'],
                }],
            },
            {
                name: 'public.customers',
                identity: [{ name: 'public' }, { name: 'customers' }],
                columns: [{ name: 'tenant_id' }, { name: 'id' }],
                foreignKeys: [],
            },
        ],
    };
    const resolved = resolveForeignKey(
        { table: 'public.orders', column: 'customer_id' },
        sourceInventory,
    );
    assert.deepEqual(resolved.columns, ['tenant_id', 'customer_id']);
    assert.equal(resolved.referencedTable.name, 'public.customers');
    assert.deepEqual(resolved.referencedColumns, ['tenant_id', 'id']);

    sourceInventory.tables[0].foreignKeys.push(structuredClone(sourceInventory.tables[0].foreignKeys[0]));
    assert.throws(
        () => resolveForeignKey({ table: 'public.orders', column: 'customer_id' }, sourceInventory),
        /missing or ambiguous/u,
    );
});

test('rejects invalid foreign-key endpoints in persisted source inventory evidence', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'foreign-key-inventory-'));
    try {
        const project = { phases: { discovery: {} } };
        sourceFixture(workspace, project, ['dbo.Orders', 'dbo.Customers']);
        const manifestPath = path.join(
            workspace,
            '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json',
        );
        const evidence = readPhaseEvidence(manifestPath);
        evidence.sourceInventory.tables[0].foreignKeys = [{
            columns: ['Id'],
            referencedTable: 'dbo.Customers',
            referencedColumns: ['Id'],
        }];
        fs.writeFileSync(manifestPath, JSON.stringify(evidence));
        assert.deepEqual(readSourceInventory(workspace, project).errors, []);

        evidence.sourceInventory.tables[0].foreignKeys[0].referencedColumns = ['Missing'];
        fs.writeFileSync(manifestPath, JSON.stringify(evidence));
        assert.match(
            readSourceInventory(workspace, project).errors[0].message,
            /Invalid referenced columns/u,
        );
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('checks explicitly comparable TPS observations without assuming all patterns are additive', () => {
    const comparisons = [{ unit: 'operations/second', window: 'normal business hours', operator: 'equal',
        left: [{ kind: 'pattern', id: 'R001' }], right: [{ kind: 'volumetrics', table: 'public.orders', field: 'Read TPS' }],
    }];
    assert.deepEqual(validateTemplates(volumetrics, patterns, inventory, comparisons), []);
    assert(validateTemplates(volumetrics, patterns.replace('| 10 | 10ms |', '| 20 | 10ms |'), inventory, comparisons).some(error => /Contradictory/.test(error.message)));
    assert.deepEqual(validateTemplates(volumetrics, patterns.replace('| 10 | 10ms |', '| 20 | 10ms |'), inventory), []);
});

test('requires substantive report structure and source-bound evidence', () => {
    const evidence = { version: 1, sourceSha256: inventory.sha256, tables: ['public.orders'], patterns: [], noObservedAccess: ['public.orders'], blockingIssues: [] };
    assert(validateSourceReport('placeholder', evidence, inventory, 'discovery').length);
    const report = evidenceReport(['Source Overview', 'Read Patterns', 'Write Patterns', 'Relational Semantics', 'Warnings']);
    assert.deepEqual(validateSourceReport(report, evidence, inventory, 'discovery'), []);
    assert(validateSourceReport(report, { ...evidence, sourceSha256: 'stale' }, inventory, 'discovery').length);
});
