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

test('accepts growth rates with an optional percent suffix and explicit unknowns', () => {
    for (const value of ['0%', '5', '5%', '5.5%', '1,000%', '5% (estimated)', 'unknown', 'N/A']) {
        const errors = validateTemplates(volumetrics.replace('| 5% |', `| ${value} |`), patterns, inventory);
        assert.deepEqual(errors, [], value);
    }
});

test('rejects repeated or misplaced percent characters in growth rates', () => {
    for (const value of ['5%%', '%5', '5%5', '5%25', '%%', '5%% (estimated)', '5% (estimated)%']) {
        const errors = validateTemplates(volumetrics.replace('| 5% |', `| ${value} |`), patterns, inventory);
        assert.deepEqual(
            errors,
            [{
                path: 'volumetrics/volumetrics.md',
                message: `Expected non-negative value or explicit unknown: ${value}`,
            }],
            value,
        );
    }
});

test('preserves source-specific quoted names and rejects unknown source references', () => {
    assert.equal(resolveSource('PUBLIC.ORDERS', inventory).name, 'public.orders');
    assert.throws(() => resolveSource('"PUBLIC".orders', inventory), /missing/);
});

test('preserves dialect, quoting and ambiguity rules in standalone and indexed resolution', () => {
    const report = evidenceReport(['Source Overview', 'Read Patterns', 'Write Patterns', 'Relational Semantics', 'Warnings']);
    const cases = [
        { dialect: 'postgres', identities: [['public', 'orders'], ['archive', 'orders']], value: 'PUBLIC.ORDERS', match: 0 },
        { dialect: 'postgres', identities: [['public', 'orders'], ['archive', 'orders']], value: 'orders' },
        { dialect: 'postgres', identities: [['public', 'orders']], value: '"PUBLIC".orders' },
        { dialect: 'postgres', identities: [['public', 'orders']], value: 'missing' },
        { dialect: 'postgres', identities: [['public', 'orders']], value: 'public..orders', invalid: true },
        { dialect: 'postgres', identities: [['catalog', 'public', 'orders']], value: 'public.orders' },
        { dialect: 'postgres', identities: [['catalog', 'public', 'orders']], value: 'catalog.public.orders', match: 0 },
        { dialect: 'postgres', identities: [['public', 'Order.Items'], ['public.Order', 'Items']], value: 'public."Order.Items"', match: 0 },
        { dialect: 'postgres', identities: [['public', 'Order.Items']], value: '"Order.Items"', match: 0 },
        { dialect: 'postgres', identities: [['public', 'A"B']], value: 'public."A""B"', match: 0 },
        { dialect: 'sqlite', identities: [['main', 'orders']], value: '"MAIN"."ORDERS"', match: 0 },
        { dialect: 'oracle', identities: [['APP', 'ORDERS'], ['App', 'Orders']], value: 'app.orders', match: 0 },
        { dialect: 'oracle', identities: [['APP', 'ORDERS'], ['App', 'Orders']], value: '"App"."Orders"', match: 1 },
        { dialect: 'oracle', identities: [['APP', 'ORDERS']], value: 'orders', match: 0 },
        { dialect: 'sqlserver', identities: [['dbo', 'Orders']], value: '[dbo].[Orders]', match: 0 },
        { dialect: 'sqlserver', identities: [['dbo', 'Orders']], value: 'dbo.orders' },
        { dialect: 'sqlserver', identities: [['dbo', 'A]B']], value: '[dbo].[A]]B]', match: 0 },
        { dialect: 'mysql', identities: [['store', 'Odd`Name']], value: '`store`.`Odd``Name`', match: 0 },
        { dialect: 'postgres', identities: [['public', 'orders'], ['public', 'orders'], ['public', 'orders']], value: 'public.orders' },
    ];
    for (const scenario of cases) {
        const sourceInventory = {
            dialect: scenario.dialect,
            sha256: 'source-hash',
            tables: scenario.identities.map(identity => ({
                name: identity.map(name => `"${name.replaceAll('"', '""')}"`).join('.'),
                identity: identity.map(name => ({ name })),
            })),
        };
        const names = sourceInventory.tables.map(table => table.name);
        const evidence = {
            sourceSha256: sourceInventory.sha256,
            tables: names,
            patterns: [],
            noObservedAccess: names.map((name, index) => index === (scenario.match ?? 0) ? scenario.value : name),
        };
        if (scenario.match !== undefined) {
            assert.equal(resolveSource(scenario.value, sourceInventory), sourceInventory.tables[scenario.match]);
            assert.deepEqual(validateSourceReport(report, evidence, sourceInventory, 'discovery'), []);
        } else {
            const expected = scenario.invalid ? /Invalid source identifier/u : /Source table is missing or ambiguous/u;
            assert.throws(() => resolveSource(scenario.value, sourceInventory), expected);
            assert.match(validateSourceReport(report, evidence, sourceInventory, 'discovery')[0].message, expected);
        }
    }
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

test('selects overlapping and same-endpoint foreign keys by exact constraint name', () => {
    const sourceInventory = {
        dialect: 'postgres',
        tables: [
            {
                name: 'public.orders',
                identity: [{ name: 'public' }, { name: 'orders' }],
                foreignKeys: [
                    {
                        name: 'fk_customer',
                        columns: ['customer_id'],
                        referencedTable: 'public.customers',
                        referencedColumns: ['id'],
                        options: [],
                    },
                    {
                        name: 'fk_customer_tenant',
                        columns: ['tenant_id', 'customer_id'],
                        referencedTable: 'public.customers',
                        referencedColumns: ['tenant_id', 'id'],
                        options: [],
                    },
                    {
                        name: 'fk_customer_cascade',
                        columns: ['customer_id'],
                        referencedTable: 'public.customers',
                        referencedColumns: ['id'],
                        options: ['ON DELETE CASCADE'],
                    },
                ],
            },
            {
                name: 'public.customers',
                identity: [{ name: 'public' }, { name: 'customers' }],
                foreignKeys: [],
            },
        ],
    };
    const before = structuredClone(sourceInventory);
    const sourceFK = { table: 'public.orders', column: 'customer_id' };
    assert.throws(() => resolveForeignKey(sourceFK, sourceInventory), /missing or ambiguous/u);
    for (const constraintName of ['fk_customer', 'fk_customer_tenant', 'fk_customer_cascade']) {
        const resolved = resolveForeignKey({ ...sourceFK, constraintName }, sourceInventory);
        const expected = sourceInventory.tables[0].foreignKeys.find(foreignKey => foreignKey.name === constraintName);
        assert.deepEqual(resolved.columns, expected.columns);
        assert.deepEqual(resolved.referencedColumns, expected.referencedColumns);
        assert.equal(resolved.referencedTable.name, 'public.customers');
    }
    for (const constraintName of ['missing', 'FK_CUSTOMER', '', null, 1]) {
        assert.throws(() => resolveForeignKey({ ...sourceFK, constraintName }, sourceInventory));
    }
    assert.throws(() => resolveForeignKey({
        ...sourceFK, column: 'tenant_id', constraintName: 'fk_customer',
    }, sourceInventory), /missing or ambiguous/u);
    assert.deepEqual(sourceInventory, before);
    sourceInventory.tables[0].foreignKeys.push(structuredClone(sourceInventory.tables[0].foreignKeys[0]));
    assert.throws(() => resolveForeignKey({
        ...sourceFK, constraintName: 'fk_customer',
    }, sourceInventory), /missing or ambiguous/u);
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

test('preserves assessment ownership checks and observes edits between validation calls', () => {
    const sourceInventory = {
        dialect: 'postgres',
        sha256: 'source-hash',
        tables: ['orders', 'customers'].map(name => ({
            name: `public.${name}`,
            identity: [{ name: 'public' }, { name }],
        })),
    };
    const domains = [
        { name: '__proto__', tables: ['ORDERS'], crossDomainDependencies: ['constructor'] },
        { name: 'constructor', tables: ['"public"."customers"'], crossDomainDependencies: [] },
    ];
    const evidence = {
        sourceSha256: sourceInventory.sha256,
        tables: sourceInventory.tables.map(table => table.name),
        domains: domains.map(domain => domain.name),
        crossDomainEdges: [{
            fromDomain: '__proto__', fromTable: 'public.orders',
            toDomain: 'constructor', toTable: 'CUSTOMERS', strategy: 'Reference by source key.',
        }],
    };
    const report = evidenceReport(['Overview', 'Domains', 'Cross-Domain Dependencies', 'Recommendations', 'Warnings']);
    const validate = (reportEvidence = evidence) =>
        validateSourceReport(report, reportEvidence, sourceInventory, 'assessment', domains);
    assert.deepEqual(validate(), []);

    for (const change of [
        { fromDomain: 'missing' }, { toDomain: 'missing' },
        { fromTable: 'public.customers' }, { toTable: 'public.orders' },
    ]) {
        const errors = validate({ ...evidence, crossDomainEdges: [{ ...evidence.crossDomainEdges[0], ...change }] });
        assert.equal(errors[0].message, 'Cross-domain edge contradicts source ownership');
    }
    assert.equal(validate({ ...evidence, crossDomainEdges: [{ ...evidence.crossDomainEdges[0], strategy: '' }] })[0].message,
        'Cross-domain edge requires a handling strategy');

    domains[0].crossDomainDependencies.push('missing');
    assert.equal(validate()[0].message, 'Cross-domain dependency does not identify an assessed domain');
    domains[0].crossDomainDependencies.pop();

    domains[0].tables.push('public.customers');
    assert.equal(validate()[0].message, 'Assessment source ownership is missing or duplicated');
    domains[0].tables.pop();
    const originalTable = domains[0].tables.pop();
    assert.equal(validate()[0].message, 'Assessment source ownership is missing or duplicated');
    domains[0].tables.push(originalTable);

    sourceInventory.tables[0].identity[1].name = 'renamed';
    assert.match(validate()[0].message, /Source table is missing or ambiguous/u);
    assert.throws(() => resolveSource('orders', sourceInventory), /missing or ambiguous/u);
    sourceInventory.tables[0].identity[1].name = 'orders';
    assert.deepEqual(validate(), []);

    [domains[0].tables, domains[1].tables] = [domains[1].tables, domains[0].tables];
    assert.equal(validate()[0].message, 'Cross-domain edge contradicts source ownership');
    [evidence.crossDomainEdges[0].fromDomain, evidence.crossDomainEdges[0].toDomain] =
        [evidence.crossDomainEdges[0].toDomain, evidence.crossDomainEdges[0].fromDomain];
    assert.deepEqual(validate(), []);

    sourceInventory.tables.push(sourceInventory.tables[0]);
    assert.match(validate()[0].message, /Source table is missing or ambiguous/u);
    sourceInventory.tables.pop();
    assert.deepEqual(validate(), []);
});

test('indexes source identities and domain ownership once per assessment validation', () => {
    let identityReads = 0;
    let ownershipReads = 0;
    const sourceInventory = {
        dialect: 'postgres',
        sha256: 'source-hash',
        tables: Array.from({ length: 200 }, (_, index) => ({
            name: `public.table_${index}`,
            get identity() {
                identityReads++;
                return [{ name: 'public' }, { name: `table_${index}` }];
            },
        })),
    };
    const domains = ['First', 'Second'].map((name, index) => {
        const tables = sourceInventory.tables.slice(index * 100, (index + 1) * 100).map(table => table.name);
        return {
            name,
            get tables() {
                ownershipReads++;
                return tables;
            },
            crossDomainDependencies: [],
        };
    });
    const evidence = {
        sourceSha256: sourceInventory.sha256,
        tables: sourceInventory.tables.map(table => table.name),
        domains: domains.map(domain => domain.name),
        crossDomainEdges: Array.from({ length: 200 }, (_, index) => ({
            fromDomain: 'First',
            fromTable: `public.table_${index % 100}`,
            toDomain: 'Second',
            toTable: `public.table_${100 + index % 100}`,
            strategy: 'Reference by source key.',
        })),
    };
    const report = evidenceReport(['Overview', 'Domains', 'Cross-Domain Dependencies', 'Recommendations', 'Warnings']);

    assert.deepEqual(validateSourceReport(report, evidence, sourceInventory, 'assessment', domains), []);
    assert.equal(identityReads, sourceInventory.tables.length);
    assert.equal(ownershipReads, domains.length);

    identityReads = 0;
    ownershipReads = 0;
    assert.deepEqual(validateSourceReport(report, evidence, sourceInventory, 'assessment', domains), []);
    assert.equal(identityReads, sourceInventory.tables.length);
    assert.equal(ownershipReads, domains.length);
});
