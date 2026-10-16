import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    MAX_DOMAIN_VALIDATION_OUTPUT_BYTES,
    summarizeDomainValidation,
    validateSchemaConversionDomains,
} from '../scripts/validate-schema-conversion-domains.mjs';
import { VALID_DOMAIN_SUMMARY } from './schema-conversion-summary-fixtures.mjs';
import { discoveryFixture, sourceFixture } from './source-evidence-fixtures.mjs';

const scriptPath = fileURLToPath(new URL('../scripts/validate-schema-conversion-domains.mjs', import.meta.url));

function model(domain = 'Orders') {
    return {
        version: 1,
        domain,
        sourceType: 'SQL Server',
        containers: [{
            name: 'Orders',
            partitionKeys: [{ path: '/tenantId' }],
            entities: [{
                name: 'Order',
                docType: 'order',
                sourceTable: 'dbo.Orders',
                idTemplate: 'order-{Id}',
                attributes: [
                    { target: 'id', source: { table: 'Orders', column: 'Id', type: 'int' }, type: 'string', isId: true },
                    { target: 'orderId', source: { table: 'Orders', column: 'Id', type: 'int' }, type: 'number' },
                    { target: 'tenantId', source: { table: 'Orders', column: 'TenantId', type: 'varchar' }, type: 'string', isPartitionKey: true },
                ],
            }],
            indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [] },
        }],
    };
}

function fixture(domainName = 'Orders') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-domain-validation-'));
    const project = {
        version: 1,
        name: 'migration-app',
        sourceCode: 'parent',
        phases: {
            discovery: { status: 'complete' },
            assessment: {
                status: 'complete',
                domains: [{
                    name: domainName,
                    tables: ['dbo.Orders'],
                    crossDomainDependencies: [],
                    estimatedTokens: 1,
                    isMapped: true,
                }],
            },
        },
    };
    const inventory = sourceFixture(root, project, ['dbo.Orders']);
    discoveryFixture(root, inventory, project, {
        patterns: [{
            id: 'R001',
            kind: 'read',
            tables: ['dbo.Orders'],
            tps: 1,
            operation: 'Read an order',
            evidence: 'query-only',
            sourcePaths: [],
        }],
        noObservedAccess: [],
    });
    const conversionRoot = path.join(root, '.cosmosdb-migration', 'phases', '3-schema-conversion');
    const directory = path.join(conversionRoot, 'domains', domainName);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'cosmos-model.json'), JSON.stringify(model(domainName)));
    fs.writeFileSync(path.join(directory, 'summary.md'), VALID_DOMAIN_SUMMARY);
    const manifestPath = path.join(conversionRoot, 'manifest.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, blockingIssues: [], referenceRegistry: [] }));
    return { root, directory, manifestPath };
}

test('validates domain models and summaries together', () => {
    const { root, directory } = fixture();
    try {
        const warnings = [];
        assert.deepEqual(validateSchemaConversionDomains([{ name: 'Orders', directory }], [], { warnings }), []);
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0].domain, 'Orders');
        assert.equal(warnings[0].artifact, 'model');
        assert.match(warnings[0].message, /Cosmos DB excludes _etag by default/u);
        fs.writeFileSync(path.join(directory, 'summary.md'), '# Incomplete\n');
        const errors = validateSchemaConversionDomains([{ name: 'Orders', directory }]);
        assert(errors.some(error => error.domain === 'Orders' && error.artifact === 'summary'));
    } finally {
        fs.rmSync(root, { recursive: true });
    }
});

test('standalone domain summary CLI defaults to the sibling model and honors an explicit model', () => {
    const { root, directory } = fixture();
    try {
        const summaryScript = fileURLToPath(new URL('../scripts/validate-schema-conversion-summary.mjs', import.meta.url));
        const args = [summaryScript, '--kind', 'domain', '--workspace', root, '--domain', 'Orders', path.join(directory, 'summary.md')];
        const inferred = spawnSync(process.execPath, args, { encoding: 'utf8' });
        assert.equal(inferred.status, 0, inferred.stderr || inferred.stdout);
        assert.equal(JSON.parse(inferred.stdout).valid, true);

        const alternate = model();
        alternate.containers[0].entities[0].docType = 'payment';
        const alternatePath = path.join(root, 'alternate-model.json');
        fs.writeFileSync(alternatePath, JSON.stringify(alternate));
        const explicit = spawnSync(process.execPath, [...args, '--model', alternatePath], { encoding: 'utf8' });
        assert.equal(explicit.status, 1, explicit.stderr || explicit.stdout);
        assert(JSON.parse(explicit.stdout).errors.some(error => error.message === 'missing JSON example for docType payment'));
    } finally {
        fs.rmSync(root, { recursive: true });
    }
});

test('requires expected discovery patterns in each matching domain summary', () => {
    const { root, directory } = fixture();
    try {
        const errors = validateSchemaConversionDomains(
            [{ name: 'Orders', directory }],
            [],
            { expectedPatternIdsByDomain: new Map([['Orders', ['R001', 'W002']]]) },
        );
        assert(
            errors.some(error =>
                error.domain === 'Orders' &&
                error.artifact === 'summary' &&
                error.path === '$.sections.accessPatterns.W002'
            ),
        );
    } finally {
        fs.rmSync(root, { recursive: true });
    }
});

test('returns bounded paginated diagnostics', () => {
    const errors = Array.from({ length: 50 }, (_, index) => ({
        domain: `Domain${index}`,
        artifact: 'model',
        path: '$.containers',
        message: `Invalid model ${index}`,
    }));
    const result = summarizeDomainValidation(50, errors, { limit: 5 });
    assert.equal(result.valid, false);
    assert.equal(result.errorCount, 50);
    assert.equal(result.returnedErrors, 5);
    assert.equal(result.nextOffset, 5);
    assert(Buffer.byteLength(`${JSON.stringify(result, null, 2)}\n`) <= MAX_DOMAIN_VALIDATION_OUTPUT_BYTES);
});

test('consumes an individually oversized diagnostic with a bounded marker', () => {
    const errors = [{
        domain: 'D'.repeat(MAX_DOMAIN_VALIDATION_OUTPUT_BYTES),
        artifact: 'model',
        path: '$.containers',
        message: 'x'.repeat(MAX_DOMAIN_VALIDATION_OUTPUT_BYTES * 2),
    }];
    const result = summarizeDomainValidation(1, errors);
    assert.equal(result.returnedErrors, 1);
    assert.equal(result.nextOffset, undefined);
    assert.equal(result.errors[0].message, 'Diagnostic omitted: exceeds output limit');
    assert(Buffer.byteLength(`${JSON.stringify(result, null, 2)}\n`) <= MAX_DOMAIN_VALIDATION_OUTPUT_BYTES);
});

test('paginates warnings after errors without changing validity or exceeding the output limit', () => {
    const errors = [{ domain: 'Orders', artifact: 'model', path: '$.domain', message: 'Invalid domain' }];
    const warnings = Array.from({ length: 30 }, (_, index) => ({
        domain: `Domain${index}`,
        artifact: 'model',
        path: '$.containers[0].indexingPolicy.excludedPaths',
        message: 'Missing explicit _etag exclusion',
    }));
    const first = summarizeDomainValidation(31, errors, { warnings, limit: 1 });
    assert.deepEqual(first.errors, errors);
    assert.deepEqual(first.warnings, []);
    assert.equal(first.warningCount, 30);
    assert.equal(first.nextOffset, 1);
    const second = summarizeDomainValidation(31, errors, { warnings, offset: 1, limit: 1 });
    assert.equal(second.valid, false);
    assert.equal(second.errorCount, 1);
    assert.equal(second.returnedErrors, 0);
    assert.deepEqual(second.warnings, [warnings[0]]);
    assert.equal(second.returnedWarnings, 1);
    assert.equal(second.nextOffset, 2);
    const warningOnly = summarizeDomainValidation(30, [], { warnings, limit: 5 });
    assert.equal(warningOnly.valid, true);
    assert.equal(warningOnly.invalidDomainCount, 0);
    assert.equal(warningOnly.returnedWarnings, 5);
    assert.equal(warningOnly.nextOffset, 5);
    warnings[0].message = 'x'.repeat(MAX_DOMAIN_VALIDATION_OUTPUT_BYTES * 2);
    const oversized = summarizeDomainValidation(30, [], { warnings });
    assert.equal(oversized.valid, true);
    assert.equal(oversized.returnedWarnings, 1);
    assert.equal(oversized.nextOffset, 1);
    assert.equal(oversized.warnings[0].message, 'Diagnostic omitted: exceeds output limit');
    assert(Buffer.byteLength(`${JSON.stringify(oversized, null, 2)}\n`) <= MAX_DOMAIN_VALIDATION_OUTPUT_BYTES);
});

test('CLI validates every domain in one invocation and preserves failure status across pages', () => {
    const { root, directory, manifestPath } = fixture();
    try {
        let result = spawnSync(
            process.execPath,
            [scriptPath, '--workspace', root, '--reference-manifest', manifestPath, '--domain', `Orders=${directory}`],
            { encoding: 'utf8' },
        );
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).valid, true);
        assert.equal(JSON.parse(result.stdout).warningCount, 1);
        assert.equal(JSON.parse(result.stdout).warnings[0].domain, 'Orders');

        fs.writeFileSync(path.join(directory, 'cosmos-model.json'), JSON.stringify(model('WrongDomain')));
        result = spawnSync(
            process.execPath,
            [scriptPath, '--workspace', root, '--reference-manifest', manifestPath, '--domain', `Orders=${directory}`, '--limit', '1'],
            { encoding: 'utf8' },
        );
        const output = JSON.parse(result.stdout);
        assert.equal(result.status, 1);
        assert.equal(output.valid, false);
        assert(output.errors.some(error => error.path === '$.domain'));
        result = spawnSync(
            process.execPath,
            [
                scriptPath,
                '--workspace', root,
                '--reference-manifest', manifestPath,
                '--domain', `Orders=${directory}`,
                '--limit', '1',
                '--offset', '1',
            ],
            { encoding: 'utf8' },
        );
        assert.equal(result.status, 1);
        assert.equal(JSON.parse(result.stdout).valid, false);
        assert.equal(JSON.parse(result.stdout).returnedWarnings, 1);
    } finally {
        fs.rmSync(root, { recursive: true });
    }
});
