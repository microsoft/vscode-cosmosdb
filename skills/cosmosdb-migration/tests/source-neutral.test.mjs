import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkCodeMigrationPrerequisites, checkPhaseCompletion } from '../scripts/check-phase-completion.mjs';
import { fileSha256, selectedSourceFiles, validateFreshnessManifest } from '../scripts/freshness.mjs';
import { buildProvisioningArtifacts } from '../scripts/generate-provisioning-artifacts.mjs';
import { resolveItemId } from '../scripts/identity-mapping.mjs';
import { inspectMigrationState } from '../scripts/inspect-migration-state.mjs';
import { executeBehaviorExample, executeMapping, readFieldValue, validateMappingEvidence } from '../scripts/mapping-examples.mjs';
import { mergeCosmosModels } from '../scripts/merge-cosmos-models.mjs';
import { normalizeDomains, validateSourceContract } from '../scripts/source-contract.mjs';
import { modelHash, validateConversionEvidence } from '../scripts/validate-conversion-evidence.mjs';
import { validateCosmosModel } from '../scripts/validate-cosmos-model.mjs';
import { createSourceResolver, readSourceInventory, sourceFilesHash } from '../scripts/validate-source-evidence.mjs';
import {
    createSourceNeutralFixture as fixture,
    sourceFixture,
    writeFixture,
    writeSourceNeutralAnalysis as writeAnalysis,
} from './source-evidence-fixtures.mjs';

const value = entry => ({ state: 'value', value: entry });
const missing = { state: 'missing' };
const property = name => ({ kind: 'property', name });
const sourcePath = 'source.json';

function workspace(t) {
    const root = path.join(process.cwd(), '.migration-test-work');
    fs.mkdirSync(root, { recursive: true });
    const directory = fs.mkdtempSync(path.join(root, 'source-neutral-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

test('Document-oriented and unfamiliar databases complete analysis, generate provisioning artifacts, and hand off without DDL', t => {
    for (const engine of ['ExampleDocumentStore', 'UncataloguedNativeStore']) {
        const directory = workspace(t);
        const data = fixture(directory, engine);
        if (engine !== 'ExampleDocumentStore') data.inventory.datasets[0].kind = 'other';
        writeAnalysis(directory, data);
        assert.deepEqual(readSourceInventory(directory, data.project).errors, []);
        assert.deepEqual(validateCosmosModel(data.model), []);
        for (const phase of ['preflight', 'discovery', 'assessment', 'schema-conversion']) {
            const result = checkPhaseCompletion(directory, phase);
            assert.equal(result.complete, true, JSON.stringify(result));
        }
        assert.equal(inspectMigrationState(directory, 'code-migration').action, 'run');
        const artifacts = buildProvisioningArtifacts(data.root, { sampleData: [{ containerName: 'Orders', items: [data.item] }] }, data.project, undefined, data.inventory);
        assert.match(artifacts['main.bicep'], /Microsoft\.DocumentDB/u);
        assert.match(artifacts['seed-data.csh'], /--container=\$entry\.containerName/u);
        assert.equal(data.project.phases.discovery.ddlParsing, undefined);
        const sourceBytes = fs.readFileSync(path.join(directory, sourcePath));
        fs.appendFileSync(path.join(directory, sourcePath), '\n');
        assert.equal(checkPhaseCompletion(directory, 'schema-conversion').complete, false);
        assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, false);
        assert.equal(inspectMigrationState(directory, 'code-migration').action, 'blocked');
        fs.writeFileSync(path.join(directory, sourcePath), sourceBytes);
        assert.equal(checkCodeMigrationPrerequisites(directory).complete, true);
        const conversionPath = path.join(directory, '.cosmosdb-migration/phases/3-schema-conversion/manifest.json');
        const acceptedBytes = fs.readFileSync(conversionPath, 'utf8');
        const changed = JSON.parse(acceptedBytes);
        changed.fieldMappings[0].examples.push(structuredClone(changed.fieldMappings[0].examples[0]));
        fs.writeFileSync(conversionPath, JSON.stringify(changed));
        assert.equal(checkCodeMigrationPrerequisites(directory).complete, false);
        fs.writeFileSync(conversionPath, acceptedBytes);
        assert.equal(checkCodeMigrationPrerequisites(directory).complete, true);
        data.project.phases.discovery.schemaInventory.files = [];
        writeFixture(directory, 'project.json', JSON.stringify(data.project));
        assert.equal(checkCodeMigrationPrerequisites(directory).complete, false);
    }
});

test('accepted handoff rejects mutations and removals of every selected non-code evidence kind', t => {
    for (const kind of ['metadata', 'sample', 'documentation', 'ddl']) {
        const directory = workspace(t);
        const data = fixture(directory);
        const relative = kind === 'ddl' ? 'selected.sql' : `${kind}.json`;
        const sourceFile = path.join(directory, relative);
        fs.writeFileSync(sourceFile, kind === 'ddl' ? 'CREATE TABLE excluded_table (id INT);' : '{}');
        data.project.phases.discovery.schemaInventory.files.push(`../${relative}`);
        data.inventory.files.push({
            path: relative, sha256: fileSha256(sourceFile), kind,
            disposition: kind === 'ddl' ? 'excluded' : 'used',
            rationale: kind === 'ddl' ? 'Reviewed declaration outside the migration scope.' : 'Reviewed selected source evidence.',
            provenance: { method: 'test fixture', scope: relative },
        });
        if (kind === 'ddl') {
            data.project.phases.discovery.ddlParsing = { method: 'model', decisionSource: 'explicit' };
            data.inventory.parser = { method: 'model' };
        }
        data.inventory.sha256 = sourceFilesHash(data.inventory.source.engine, data.inventory.files);
        data.evidence.sourceSha256 = data.inventory.sha256;
        writeAnalysis(directory, data);
        const checkpointPath = path.join(directory, '.cosmosdb-migration/project.json');
        const checkpointBytes = fs.readFileSync(checkpointPath);
        const sourceBytes = fs.readFileSync(sourceFile);
        assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, true, kind);
        fs.appendFileSync(sourceFile, '\n');
        assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, false, `${kind} mutation`);
        fs.writeFileSync(sourceFile, sourceBytes);
        assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, true, `${kind} restoration`);
        fs.rmSync(sourceFile);
        assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, false, `${kind} removal`);
        assert.equal(inspectMigrationState(directory, 'code-migration').action, 'blocked', kind);
        assert.deepEqual(fs.readFileSync(checkpointPath), checkpointBytes);
    }
});

test('accepted code evidence may evolve or disappear without exempting native evidence or relabeled files', t => {
    const directory = workspace(t);
    const data = fixture(directory);
    const codePath = path.join(directory, 'app.ts');
    fs.writeFileSync(codePath, 'export const original = true;\n');
    data.project.phases.discovery.schemaInventory.files.push('../app.ts');
    data.inventory.files.push({
        path: 'app.ts', sha256: fileSha256(codePath), kind: 'code', disposition: 'used',
        rationale: 'Reviewed application data-access code.',
        provenance: { method: 'test fixture', scope: 'application module' },
    });
    data.inventory.sha256 = sourceFilesHash(data.inventory.source.engine, data.inventory.files);
    data.evidence.sourceSha256 = data.inventory.sha256;
    writeAnalysis(directory, data);
    assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, true);
    fs.writeFileSync(codePath, 'export const migrated = true;\n');
    assert.equal(checkPhaseCompletion(directory, 'schema-conversion').complete, false);
    assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, true);
    fs.rmSync(codePath);
    assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, true);
    fs.appendFileSync(path.join(directory, sourcePath), '\n');
    assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, false);
    const manifestPath = path.join(directory, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.sourceInventory.files[0].kind = 'code';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = checkCodeMigrationPrerequisites(directory);
    assert.equal(result.complete, false);
    assert.match(JSON.stringify(result), /Accepted source inventory changed/u);
});

test('accepted handoff still detects additions and removals in a dynamic source selection', t => {
    const directory = workspace(t);
    const data = fixture(directory);
    data.project.phases.discovery.schemaInventory = { path: '.' };
    writeAnalysis(directory, data);
    assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, true);
    const added = path.join(directory, 'additional-metadata.json');
    fs.writeFileSync(added, '{}');
    assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, false);
    fs.rmSync(added);
    assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, true);
    fs.rmSync(path.join(directory, sourcePath));
    assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, false);
});

test('coverage, every selected disposition, source hashes and selection changes are enforced', t => {
    const directory = workspace(t);
    const data = fixture(directory);
    writeAnalysis(directory, data);
    const inventory = structuredClone(data.inventory);
    inventory.datasets[0].coverage.complete = true;
    assert.throws(() => validateSourceContract(inventory), /cannot certify/u);
    data.project.phases.discovery.schemaInventory.files.push('../second.json');
    fs.writeFileSync(path.join(directory, 'second.json'), '{}');
    assert.match(readSourceInventory(directory, data.project).errors[0].message, /selected evidence/u);
    assert.equal(validateFreshnessManifest(directory, data.project, 'preflight', data.project.freshness.preflight).freshness, 'stale');
    data.project.phases.discovery.schemaInventory.files = [];
    assert.deepEqual(selectedSourceFiles(directory, data.project), []);
    assert.match(readSourceInventory(directory, data.project).errors[0].message, /selected evidence/u);
});

test('typed paths distinguish literal dots, nested arrays, missing and null; BSON digits remain exact', () => {
    const document = { 'a.b': null, a: { b: 3 }, items: [[{ value: 1 }, {}], [{ value: null }]] };
    assert.deepEqual(readFieldValue(document, [property('a.b')]), value(null));
    assert.deepEqual(readFieldValue(document, [property('a'), property('b')]), value(3));
    assert.deepEqual(readFieldValue(document, [property('items'), { kind: 'array' }, { kind: 'array' }, property('value')]), {
        state: 'array', items: [{ state: 'array', items: [value(1), missing] }, { state: 'array', items: [value(null)] }],
    });
    assert.deepEqual(executeMapping('array-envelope', [
        readFieldValue(document, [property('items'), { kind: 'array' }, { kind: 'array' }, property('value')]),
    ]), value([
        { items: [{ present: true, value: 1 }, { present: false }] },
        { items: [{ present: true, value: null }] },
    ]));
    assert.deepEqual(executeMapping('extended-json-string', [value({ $numberLong: '9007199254740993' })]), value('9007199254740993'));
    assert.deepEqual(executeMapping('extended-json-string', [value({ $numberDecimal: '12345678901234567890.0010' })]), value('12345678901234567890.0010'));
    assert.throws(() => executeMapping('copy', [value(9007199254740992)]), /precision/u);
    assert.throws(() => executeMapping('constant', [value('source')], 'dropped'), /cannot replace/u);
    assert.deepEqual(executeMapping('tuple', [value('tenant'), value(5)]), value(['tenant', 5]));
    assert.throws(() => readFieldValue(document, ['a.b']), /typed|paths/u);
});

test('mixed variants and missing/null require executable cases rather than descriptive strings', t => {
    const data = fixture(workspace(t));
    const field = data.inventory.datasets[0].fields[1];
    field.nativeTypes = ['string', 'integer'];
    const mapping = data.evidence.fieldMappings[1];
    mapping.operation = 'json-string';
    mapping.examples = [{ nativeTypes: ['string'], inputs: [value('a')], output: value('"a"') }];
    const validate = () => validateMappingEvidence(data.inventory, data.models, data.evidence, new Map([['orders', 'Orders']]));
    assert.throws(validate, /native variant/u);
    mapping.examples.push({ nativeTypes: ['integer'], inputs: [value(2)], output: value('2') });
    assert.doesNotThrow(validate);
    field.presence = 'optional'; field.nullable = true;
    data.entity.attributes[2].optional = true; data.entity.attributes[2].nullable = true;
    assert.throws(validate, /missing example/u);
    mapping.examples.push({ inputs: [missing], output: missing });
    assert.throws(validate, /null example/u);
    mapping.examples.push({ inputs: [value(null)], output: value(null) });
    assert.doesNotThrow(validate);
    mapping.examples[0].output = value('incorrect');
    assert.throws(validate, /example failed/u);
});

test('required behavior needs a passing executable check or explicit approved replacement', t => {
    const data = fixture(workspace(t));
    data.inventory.semantics.push({ id: 'transaction', kind: 'atomicity', datasets: ['orders'],
        required: true, status: 'known', description: 'Multi-record atomic writes', evidence: [sourcePath] });
    const validate = () => validateMappingEvidence(data.inventory, data.models, data.evidence, new Map([['orders', 'Orders']]));
    assert.throws(validate, /obligations/u);
    data.evidence.behaviorDecisions = [{ semantic: 'transaction', action: 'preserve',
        rationale: 'Use transactional batch', implementation: 'Same logical partition',
        examples: [{ operation: 'partition-batch', input: { partitionKeys: [['tenant-a'], ['tenant-b']], payloadBytes: 100 }, expected: { supported: true } }] }];
    assert.throws(validate, /not preserved/u);
    const decision = data.evidence.behaviorDecisions[0];
    decision.action = 'replace';
    assert.throws(validate, /approval/u);
    decision.approval = { by: 'engineer', at: '2026-10-01T00:00:00Z' };
    decision.implementation = 'Approved saga with reconciliation; integration tests remain required.';
    assert.doesNotThrow(validate);
    assert.deepEqual(executeBehaviorExample({
        operation: 'partition-batch', input: { partitionKeys: [['tenant-a'], ['tenant-a']], payloadBytes: 2 * 1024 * 1024 + 1 },
    }), { supported: false });
    assert.deepEqual(executeBehaviorExample({
        operation: 'ttl-relative', input: { lastModifiedSeconds: 100, ttl: 30, sourceExpiresAtSeconds: 130 },
    }), { expiresAtSeconds: 130, equivalent: true });
    assert.deepEqual(executeBehaviorExample({
        operation: 'ttl-relative', input: { lastModifiedSeconds: 120, ttl: 30, sourceExpiresAtSeconds: 130 },
    }), { expiresAtSeconds: 150, equivalent: false });
});

test('v1 resumption validates originals and preserves authority, unknown details, names and ordered keys', t => {
    const directory = workspace(t);
    const project = { version: 1, name: 'legacy', sourceCode: 'parent', phases: { discovery: { status: 'not-started' } } };
    sourceFixture(directory, project);
    const manifest = path.join(directory, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json');
    const original = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const table = original.sourceInventory.tables[0];
    table.primaryKey = ['TenantId', 'Id'];
    table.unknownNativeProperty = { preserved: ['in', 'order'] };
    fs.writeFileSync(manifest, JSON.stringify(original));
    const bytes = fs.readFileSync(manifest, 'utf8');
    const inventory = readSourceInventory(directory, project);
    assert.deepEqual(inventory.errors, []);
    assert.deepEqual(inventory.datasets[0].relational.primaryKey, ['TenantId', 'Id']);
    assert.deepEqual(inventory.datasets[0].unknownNativeProperty, table.unknownNativeProperty);
    const domains = normalizeDomains([{ name: 'Orders', tables: ['dbo.Orders'], unknown: 42 }], createSourceResolver(inventory));
    assert.deepEqual(domains[0].datasets, [inventory.datasets[0].id]);
    assert.equal(domains[0].unknown, 42);
    assert.equal(fs.readFileSync(manifest, 'utf8'), bytes);
    original.sourceInventory.tables[0].primaryKey = ['missing'];
    fs.writeFileSync(manifest, JSON.stringify(original));
    assert.match(readSourceInventory(directory, project).errors[0].message, /key structure/u);
});

test('no-DDL relational code inventory preserves exact native columns and cannot drop relational details', t => {
    const directory = workspace(t);
    const data = fixture(directory);
    const dataset = data.inventory.datasets[0];
    data.inventory.source.engine = 'PostgreSQL';
    data.inventory.dialect = 'postgres';
    data.inventory.files[0].kind = 'code';
    dataset.kind = 'relational';
    dataset.name = '"Sales"."Orders"';
    dataset.coverage = { basis: 'code', scope: 'selected code only', complete: false, sampling: null };
    dataset.fields[0].nativeTypes = ['uuid'];
    dataset.identities[0].kind = 'primary';
    dataset.identities[0].fields = ['tenant', '_id'];
    dataset.relational = {
        name: dataset.name, identity: [{ name: 'Sales', quoted: true }, { name: 'Orders', quoted: true }],
        columns: [{ name: '_id', type: 'uuid' }, { name: 'tenant', type: 'string' }],
        primaryKey: ['tenant', '_id'], foreignKeys: [], uniqueConstraints: [], checks: [], defaults: [], indexes: [], behaviors: [],
    };
    data.inventory.sha256 = sourceFilesHash('PostgreSQL', data.inventory.files);
    writeFixture(directory, 'phases/1-discovery/preflight-manifest.json', JSON.stringify({
        version: 1, blockingIssues: [], sourceSha256: data.inventory.sha256, sourceInventory: data.inventory,
    }));
    assert.deepEqual(readSourceInventory(directory, data.project).errors, []);
    assert.equal(data.project.phases.discovery.ddlParsing, undefined);
    fs.writeFileSync(path.join(directory, 'source.ts'), 'export interface Order { _id: string; tenant: string; }\n');
    data.project.phases.discovery.schemaInventory.files = ['../source.ts'];
    data.inventory.files[0].path = 'source.ts';
    data.inventory.files[0].sha256 = fileSha256(path.join(directory, 'source.ts'));
    for (const entry of [dataset, ...dataset.fields, ...dataset.identities]) entry.evidence = ['source.ts'];
    data.model.sourceType = 'PostgreSQL';
    data.entity.identity.fields = [{ dataset: 'orders', field: 'tenant' }, { dataset: 'orders', field: '_id' }];
    data.entity.attributes[0].source = { inputs: data.entity.identity.fields, type: 'composite' };
    data.entity.attributes[1].source.type = 'uuid';
    data.item.sourceId = 'c0d09a6b-e7fa-4970-917e-745a001a2aab';
    data.item.id = resolveItemId(data.entity, data.item);
    data.evidence.fieldMappings[0].operation = 'copy';
    data.evidence.fieldMappings[0].examples = [{ inputs: [value(data.item.sourceId)], output: value(data.item.sourceId) }];
    data.evidence.identityExamples[0].cases = [{ item: data.item, id: data.item.id }];
    data.inventory.sha256 = sourceFilesHash('PostgreSQL', data.inventory.files);
    data.evidence.sourceSha256 = data.inventory.sha256;
    data.evidence.domainSha256.Orders = modelHash(data.model);
    data.root = mergeCosmosModels(data.models, { databaseName: 'app', capacityMode: 'serverless' }).model;
    writeAnalysis(directory, data);
    assert.equal(checkPhaseCompletion(directory, 'schema-conversion').complete, true);
    data.entity.identity.fields.reverse();
    data.evidence.domainSha256.Orders = modelHash(data.model);
    assert.match(validateConversionEvidence(data.project, data.inventory, data.models, data.root, data.evidence)[0].message, /primary-key order/u);
    data.entity.identity.fields.reverse();
    const invalid = structuredClone(data.inventory);
    invalid.datasets[0].identities[0].fields.reverse();
    assert.throws(() => validateSourceContract(invalid), /order/u);
    invalid.datasets[0].identities[0].fields.reverse();
    delete invalid.datasets[0].relational;
    assert.throws(() => validateSourceContract(invalid), /cannot be dropped/u);
    invalid.datasets[0].kind = 'document';
    invalid.files[0].path = 'selected.sql'; invalid.files[0].kind = 'metadata';
    assert.throws(() => validateSourceContract(invalid), /relabeled/u);
});

test('typed relational foreign keys retain exact ordered endpoints and cannot be fabricated', t => {
    const directory = workspace(t);
    const data = fixture(directory, 'postgres');
    const dataset = data.inventory.datasets[0];
    dataset.kind = 'relational';
    data.inventory.dialect = 'postgres';
    dataset.relational = {
        name: dataset.name, identity: [{ name: 'native', quoted: false }, { name: 'orders', quoted: false }],
        columns: [{ name: '_id', type: 'ObjectId' }, { name: 'tenant', type: 'string' }],
        primaryKey: ['tenant', '_id'], foreignKeys: [{
            name: 'self-reference', columns: ['tenant', '_id'], referencedTable: 'native.orders', referencedColumns: ['tenant', '_id'],
        }], uniqueConstraints: [], checks: [], defaults: [], indexes: [], behaviors: [],
    };
    dataset.identities[0].kind = 'primary';
    dataset.identities[0].fields = ['tenant', '_id'];
    data.inventory.relationships = [{
        id: 'self-reference', kind: 'foreign-key', constraintName: 'self-reference',
        from: { dataset: 'orders', fields: ['tenant', '_id'] }, to: { dataset: 'orders', fields: ['tenant', '_id'] }, evidence: [sourcePath],
    }];
    const persist = () => writeFixture(directory, 'phases/1-discovery/preflight-manifest.json', JSON.stringify({
        version: 1, sourceSha256: data.inventory.sha256, sourceInventory: data.inventory, blockingIssues: [],
    }));
    persist();
    assert.deepEqual(readSourceInventory(directory, data.project).errors, []);
    data.inventory.relationships[0].to.fields.reverse();
    persist();
    assert.match(readSourceInventory(directory, data.project).errors[0].message, /exact ordered relationship/u);
    data.inventory.relationships[0].to.fields.reverse();
    dataset.relational.foreignKeys = [];
    persist();
    assert.match(readSourceInventory(directory, data.project).errors[0].message, /exact native constraint/u);
});

test('source-neutral ownership, identity order and root agreement remain enforced', t => {
    const data = fixture(workspace(t));
    const validate = () => validateConversionEvidence(data.project, data.inventory, data.models, data.root, data.evidence);
    assert.deepEqual(validate(), []);
    data.entity.attributes.pop();
    data.evidence.domainSha256.Orders = modelHash(data.model);
    assert.match(validate()[0].message, /omits source column/u);
});
