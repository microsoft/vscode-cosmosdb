import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkCodeMigrationPrerequisites, checkPhaseCompletion } from '../scripts/check-phase-completion.mjs';
import { fileSha256, selectedSourceFiles, validateFreshnessManifest } from '../scripts/freshness.mjs';
import { buildProvisioningArtifacts } from '../scripts/generate-provisioning-artifacts.mjs';
import { encodeSourceIdentity, resolveItemId } from '../scripts/identity-mapping.mjs';
import { inspectMigrationState } from '../scripts/inspect-migration-state.mjs';
import { executeBehaviorExample, executeDocumentMapping, executeFieldMapping, executeMapping, readFieldValue, validateMappingEvidence } from '../scripts/mapping-examples.mjs';
import { mergeCosmosModels } from '../scripts/merge-cosmos-models.mjs';
import { directIdentityField, normalizeDomains, resolveField, sourceFieldId, validateSourceContract } from '../scripts/source-contract.mjs';
import { selectSchemaConversionDomains } from '../scripts/select-schema-conversion-domains.mjs';
import { modelHash, validateConversionEvidence } from '../scripts/validate-conversion-evidence.mjs';
import { validateCosmosModel } from '../scripts/validate-cosmos-model.mjs';
import { validateSampleData } from '../scripts/validate-sample-data.mjs';
import { createSourceResolver, readSourceInventory, sourceFilesHash, validateSourceReport } from '../scripts/validate-source-evidence.mjs';
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

test('readable field IDs distinguish nested paths, literal names, and array traversal without evaluation', () => {
    const element = { kind: 'array' };
    const cases = [
        [[property('_id')], '$._id'],
        [[property('eventHeader'), property('eventTimestamp')], '$.eventHeader.eventTimestamp'],
        [[property('a.b')], '$["a.b"]'],
        [[property('a'), property('b')], '$.a.b'],
        [[property('barcodes')], '$.barcodes'],
        [[property('barcodes'), element], '$.barcodes[*]'],
        [[property('items'), element, property('sku')], '$.items[*].sku'],
        [[property('items'), property('*')], '$.items["*"]'],
        [[property('items'), property('[*]')], '$.items["[*]"]'],
        [[property('items'), property('0')], '$.items["0"]'],
        [[property('items'), element, element], '$.items[*][*]'],
        [[property('')], '$[""]'],
        [[property('$date')], '$["$date"]'],
        [[property('a"b\\c\n')], '$["a\\"b\\\\c\\n"]'],
        [[property('\u90ae\u4ef6')], '$["\u90ae\u4ef6"]'],
        [[property('Name')], '$.Name'],
        [[property('name')], '$.name'],
        [[property('$..items[?(@.active)]')], '$["$..items[?(@.active)]"]'],
    ];
    const ids = cases.map(([path, expected]) => {
        const before = structuredClone(path);
        const id = sourceFieldId(path);
        assert.equal(id, expected);
        assert.deepEqual(path, before);
        return id;
    });
    assert.equal(new Set(ids).size, cases.length);
    for (const invalid of [[], ['a.b'], [{ kind: 'index', index: 0 }], [{ kind: 'array', name: '*' }]]) {
        assert.throws(() => sourceFieldId(invalid), /path|segments/u);
    }
});

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
        if (engine !== 'ExampleDocumentStore') {
            data.inventory.datasets[0].kind = 'other';
            data.evidence.documentMappings = [];
        }
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
    data.evidence.documentMappings[0].examples[0].output.tenant = '"a"';
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
    data.evidence.documentMappings = [];
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

test('schema-only analysis needs neither invented application details nor SDK evidence or mapped domains', t => {
    const directory = workspace(t);
    const data = fixture(directory);
    const analysis = data.project.phases.discovery.applicationAnalysis;
    analysis.codebaseAvailable = false;
    delete analysis.language;
    delete analysis.projectType;
    delete analysis.databaseAccess;
    data.project.phases.assessment.domains[0].isMapped = false;
    writeAnalysis(directory, data);
    for (const phase of ['preflight', 'discovery', 'assessment', 'schema-conversion']) {
        const result = checkPhaseCompletion(directory, phase);
        assert.equal(result.complete, true, JSON.stringify(result));
    }
    const discovery = JSON.parse(fs.readFileSync(path.join(directory, '.cosmosdb-migration/phases/1-discovery/discovery-manifest.json')));
    assert.equal(discovery.sdkCompatibility, undefined);
    const report = fs.readFileSync(path.join(directory, '.cosmosdb-migration/phases/1-discovery/discovery-report.md'), 'utf8');
    discovery.patterns = [{ id: 'R001', kind: 'read', datasets: ['orders'], sourcePaths: [], tps: null,
        evidence: 'user-declared', declaration: 'Look up an order by its known identity.', operation: 'Point read' }];
    discovery.noObservedAccess = [];
    assert.deepEqual(validateSourceReport(report, discovery, data.inventory, 'discovery'), []);
    delete discovery.patterns[0].declaration;
    assert.match(validateSourceReport(report, discovery, data.inventory, 'discovery')[0].message, /workload statement/u);
    assert.equal(selectSchemaConversionDomains(data.project).selectedDomains.length, 1);
    assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, false);
    assert.match(checkCodeMigrationPrerequisites(directory).errors.join(' '), /Application code is unavailable/u);
    assert.equal(inspectMigrationState(directory, 'code-migration').action, 'blocked');
    delete analysis.codebaseAvailable;
    assert.throws(() => selectSchemaConversionDomains(data.project), /No mapped domains/u);
    writeFixture(directory, 'project.json', JSON.stringify(data.project));
    assert.equal(checkPhaseCompletion(directory, 'preflight').complete, false);
});

function documentFixture(t, directory = workspace(t)) {
    const data = fixture(directory);
    const dataset = data.inventory.datasets[0];
    const field = (id, path, nativeTypes, nullable = false) => ({
        id, path, nativeTypes, presence: 'optional', nullable, evidence: [sourcePath],
    });
    dataset.fields.push(
        field('details', [property('details')], ['object']),
        field('literal', [property('details'), property('a.b')], ['string']),
        field('nested', [property('details'), property('a'), property('b')], ['integer']),
        field('items', [property('details'), property('items')], ['array']),
        field('item-value', [property('details'), property('items'), { kind: 'array' }, { kind: 'array' }, property('value')], ['integer', 'null'], true),
    );
    const details = { 'a.b': 'literal', a: { b: 3 }, items: [[{ value: 1 }, {}], [{ value: null }]], unlisted: { retained: true } };
    const source = { _id: { $oid: data.item.sourceId }, tenant: 'a', details, unlistedRoot: { retained: [1, null] } };
    data.entity.attributes.push({ target: 'details', source: { dataset: 'orders', field: 'details', type: 'object' }, type: 'object', optional: true });
    data.evidence.fieldMappings.push({
        domain: 'Orders', container: 'Orders', entity: 'Order', target: 'details',
        inputs: [{ dataset: 'orders', field: 'details' }], operation: 'copy',
        examples: [{ inputs: [value(details)], output: value(structuredClone(details)) }, { inputs: [missing], output: missing }],
    });
    Object.assign(data.item, { details: structuredClone(details), unlistedRoot: structuredClone(source.unlistedRoot) });
    data.evidence.documentMappings[0].examples = [{ source, output: structuredClone(data.item) }];
    fs.writeFileSync(path.join(directory, sourcePath), JSON.stringify(source));
    data.inventory.files[0].sha256 = fileSha256(path.join(directory, sourcePath));
    data.inventory.sha256 = sourceFilesHash(data.inventory.source.engine, data.inventory.files);
    data.evidence.sourceSha256 = data.inventory.sha256;
    refreshDocumentModel(data);
    return data;
}

function refreshDocumentModel(data) {
    data.evidence.domainSha256.Orders = modelHash(data.model);
    data.root = mergeCosmosModels(data.models, { databaseName: 'app', capacityMode: 'serverless' }).model;
}

test('readable field IDs work throughout conversion while legacy opaque references remain accepted unchanged', t => {
    for (const readable of [true, false]) {
        const directory = workspace(t);
        const data = documentFixture(t, directory);
        const dataset = data.inventory.datasets[0];
        const ids = new Map(dataset.fields.map((field, index) =>
            [field.id, readable ? sourceFieldId(field.path) : `field-legacy-${index}`]));
        for (const field of dataset.fields) field.id = ids.get(field.id);
        for (const identity of dataset.identities) identity.fields = identity.fields.map(id => ids.get(id));
        for (const attribute of data.entity.attributes) attribute.source.field = ids.get(attribute.source.field);
        for (const reference of data.entity.identity.fields) reference.field = ids.get(reference.field);
        for (const mapping of data.evidence.fieldMappings) {
            for (const reference of mapping.inputs) reference.field = ids.get(reference.field);
        }
        refreshDocumentModel(data);
        writeAnalysis(directory, data);
        const inventoryFile = path.join(directory, '.cosmosdb-migration/phases/1-discovery/preflight-manifest.json');
        const original = fs.readFileSync(inventoryFile);
        const accepted = readSourceInventory(directory, data.project);
        assert.deepEqual(accepted.errors, []);
        assert.deepEqual(accepted.datasets[0].fields.map(field => field.id), [...ids.values()]);
        assert.deepEqual(resolveField(accepted.datasets[0], ids.get('literal')).path, [property('details'), property('a.b')]);
        const result = checkPhaseCompletion(directory, 'schema-conversion');
        assert.equal(result.complete, true, JSON.stringify(result));
        assert.equal(checkPhaseCompletion(directory, 'code-migration').ready, true);
        assert.deepEqual(fs.readFileSync(inventoryFile), original);
        // Labels are exact references; even an equivalent-looking path is not evaluated or treated as an alias.
        assert.throws(() => resolveField(accepted.datasets[0], '$["details"]["a.b"]'), /Unknown source field/u);
        assert.deepEqual(validateSampleData(data.root, {
            sampleData: [{ containerName: 'Orders', items: [data.item] }],
        }, undefined, accepted), []);
    }
});

test('one subtree mapping covers descendants and preserves unknown roots, nesting, array order, missing and null', t => {
    const data = documentFixture(t);
    const validate = () => validateConversionEvidence(data.project, data.inventory, data.models, data.root, data.evidence);
    assert.deepEqual(validate(), []);
    assert.equal(data.entity.attributes.length, 4);
    const decision = data.evidence.documentMappings[0];
    const source = decision.examples[0].source;
    const result = executeDocumentMapping(data.inventory, data.entity, data.evidence.fieldMappings, decision, source);
    assert.deepEqual(result.details, source.details);
    assert.deepEqual(result.unlistedRoot, source.unlistedRoot);
    result.details.items[0][0].value = 99;
    assert.equal(source.details.items[0][0].value, 1);
    delete decision.examples[0].output.unlistedRoot;
    assert.match(validate()[0].message, /Whole-document mapping example/u);
    decision.examples[0].output.unlistedRoot = structuredClone(source.unlistedRoot);
    delete data.evidence.documentMappings;
    assert.match(validate()[0].message, /whole-document preservation evidence/u);
});

test('earlier conversion checkpoints without the preservation contract become stale', t => {
    const directory = workspace(t);
    const data = fixture(directory);
    writeAnalysis(directory, data);
    const manifest = structuredClone(data.project.freshness['schema-conversion']);
    manifest.inputs = manifest.inputs.filter(input => input.id !== 'document-mapping-contract');
    const result = validateFreshnessManifest(directory, data.project, 'schema-conversion', manifest);
    assert.equal(result.freshness, 'stale');
    assert(result.staleInputs.some(input => input.id === 'document-mapping-contract'));
});

test('flattened document projections require an evidenced benefit and migration tradeoffs', t => {
    const data = documentFixture(t);
    const mapping = { domain: 'Orders', container: 'Orders', entity: 'Order', target: 'lookupKey',
        inputs: [{ dataset: 'orders', field: 'literal' }], operation: 'copy',
        examples: [{ inputs: [value('literal')], output: value('literal') }, { inputs: [missing], output: missing }] };
    data.entity.attributes.push({ target: 'lookupKey', source: { dataset: 'orders', field: 'literal', type: 'string' }, type: 'string', optional: true });
    data.evidence.fieldMappings.push(mapping);
    const decision = data.evidence.documentMappings[0];
    decision.examples[0].output.lookupKey = 'literal';
    refreshDocumentModel(data);
    const validate = () => validateConversionEvidence(data.project, data.inventory, data.models, data.root, data.evidence);
    assert.match(validate()[0].message, /benefit/u);
    decision.mode = 'reshape';
    assert.match(validate()[0].message, /benefit/u);
    decision.justification = {
        benefit: 'performance',
        rationale: 'Route the declared lookup workload by its stable key rather than querying every partition.',
        evidence: ['.cosmosdb-migration/phases/1-discovery/access-patterns/access-patterns.md#R001'],
        tradeoffs: 'Duplicates the routing key and changes the write contract; verify its distribution before adoption.',
    };
    assert.deepEqual(validate(), []);
    decision.justification.evidence = ['not-reviewed.txt'];
    assert.match(validate()[0].message, /benefit/u);
});

test('whole-document mapping rejects metadata collisions instead of silently losing source values', t => {
    const data = documentFixture(t);
    const decision = data.evidence.documentMappings[0];
    for (const name of ['id', 'docType', '_etag', 'sourceId']) {
        const source = { ...decision.examples[0].source, [name]: 'must-not-be-lost' };
        assert.throws(() => executeDocumentMapping(data.inventory, data.entity, data.evidence.fieldMappings, decision, source), /collides|overwrite/u);
    }
});

test('preserved whole-document examples still enforce exact item and partition-key byte limits', t => {
    const data = documentFixture(t);
    const decision = data.evidence.documentMappings[0];
    const source = structuredClone(decision.examples[0].source);
    const run = () => executeDocumentMapping(data.inventory, data.entity, data.evidence.fieldMappings, decision, source, {
        partitionKeys: data.model.containers[0].partitionKeys,
    });
    const limit = 2 * 1024 * 1024;
    source.extraLarge = 'x'.repeat(limit - Buffer.byteLength(JSON.stringify(run()), 'utf8') - Buffer.byteLength(',"extraLarge":""', 'utf8'));
    assert.equal(Buffer.byteLength(JSON.stringify(run()), 'utf8'), limit);
    source.extraLarge += 'x';
    assert.throws(run, /2 MiB/u);
    delete source.extraLarge;
    source.tenant = 'x'.repeat(2048);
    assert.equal(run().tenant.length, 2048);
    source.tenant += 'x';
    assert.throws(run, /partition key/u);
});

test('native subtree conversions retain structure and unknown properties while normalizing dates and exact decimals', t => {
    const data = documentFixture(t);
    const dataset = data.inventory.datasets[0];
    const parent = dataset.fields.find(field => field.id === 'details');
    for (const [id, name, type] of [['date', 'at', 'BSON Date'], ['amount', 'amount', 'BSON Decimal128']]) {
        dataset.fields.push({ id, path: [...parent.path, property('events'), { kind: 'array' }, property(name)],
            nativeTypes: [type], presence: 'optional', nullable: true, evidence: [sourcePath] });
    }
    const input = { events: [{ at: { $date: '2025-01-01T00:00:00.000Z' }, amount: { $numberDecimal: '12345678901234567890.0010' } }, {}, { at: null }], extra: ['retained'] };
    const output = { events: [{ at: '2025-01-01T00:00:00.000Z', amount: '12345678901234567890.0010' }, {}, { at: null }], extra: ['retained'] };
    const mapping = data.evidence.fieldMappings.find(entry => entry.target === 'details');
    mapping.conversions = [{ field: 'date', operation: 'date-iso8601' }, { field: 'amount', operation: 'extended-json-string' }];
    const original = structuredClone(input);
    assert.deepEqual(executeFieldMapping(mapping, [value(input)], data.inventory), value(output));
    assert.deepEqual(input, original);
    mapping.conversions.push({ field: 'date', operation: 'date-iso8601' });
    assert.throws(() => executeFieldMapping(mapping, [value(input)], data.inventory), /overlap/u);
    assert.deepEqual(executeMapping('date-iso8601', [value({ $date: { $numberLong: '0' } })]), value('1970-01-01T00:00:00.000Z'));
    for (const date of ['2025-02-31T00:00:00.000Z', '2025-01-01T00:00:00.0001Z', { $numberLong: '8640000000000001' }]) {
        assert.throws(() => executeMapping('date-iso8601', [value({ $date: date })]), /Date/u);
    }
});

test('native string identities retain compatible source IDs and reject unsafe or oversized values', t => {
    const data = fixture(workspace(t));
    data.entity.identity.encoding = 'native-string';
    data.inventory.datasets[0].fields[0].nativeTypes = ['string'];
    data.entity.attributes[0].source.type = 'string';
    data.entity.attributes[1].source.type = 'string';
    assert.deepEqual(validateCosmosModel(data.model), []);
    assert.equal(resolveItemId(data.entity, { ...data.item, sourceId: 'original-key' }), 'original-key');
    for (const id of ['', 'bad/id', 'bad\\id', 'bad?id', 'bad#id', 'trailing ', 'x'.repeat(1024), '\u00e9'.repeat(512)]) {
        assert.throws(() => resolveItemId(data.entity, { ...data.item, sourceId: id }), /identity|limit/u);
    }
    assert.equal(resolveItemId(data.entity, { ...data.item, sourceId: 'x'.repeat(1023) }).length, 1023);
});

function nativeDocumentFixture(t, encoding = 'native-string', rename = false) {
    const directory = workspace(t);
    const data = fixture(directory);
    const type = encoding === 'objectid-hex' ? 'ObjectId' : encoding === 'native-uuid' ? 'uuid' : 'string';
    const original = encoding === 'objectid-hex' ? { $oid: '507F1F77BCF86CD799439011' }
        : encoding === 'native-uuid' ? 'C56A4180-65AA-42EC-A945-5FD21DEC0538' : 'original-key';
    const source = { _id: original, tenant: 'a', extra: { retained: true } };
    data.inventory.datasets[0].fields[0].nativeTypes = [type];
    data.entity.identity.encoding = encoding;
    if (rename) data.entity.identity.sourceKey = 'rename';
    const idAttribute = data.entity.attributes[0];
    idAttribute.source.type = type;
    idAttribute.isPartitionKey = true;
    data.entity.attributes[2].isPartitionKey = false;
    data.model.containers[0].partitionKeys = [{ path: '/id' }];
    data.entity.attributes[1] = {
        target: '_id', type: encoding === 'objectid-hex' ? 'object' : 'string',
        source: { ...idAttribute.source },
    };
    data.evidence.fieldMappings[0] = {
        domain: 'Orders', container: 'Orders', entity: 'Order', target: '_id',
        inputs: [{ dataset: 'orders', field: '_id' }], operation: 'copy',
        examples: [{ inputs: [value(original)], output: value(structuredClone(original)) }],
    };
    data.item = { _id: structuredClone(original), tenant: 'a', extra: { retained: true }, docType: 'order',
        id: encodeSourceIdentity(data.entity, [original]) };
    if (rename) {
        data.entity.attributes.splice(1, 1);
        data.evidence.fieldMappings.shift();
        delete data.item._id;
    }
    data.evidence.identityExamples[0].cases = [{ item: data.item, id: data.item.id }];
    data.evidence.documentMappings[0].examples = [{ source, output: structuredClone(data.item) }];
    fs.writeFileSync(path.join(directory, sourcePath), JSON.stringify(source));
    data.inventory.files[0].sha256 = fileSha256(path.join(directory, sourcePath));
    data.inventory.sha256 = sourceFilesHash(data.inventory.source.engine, data.inventory.files);
    data.evidence.sourceSha256 = data.inventory.sha256;
    refreshDocumentModel(data);
    return data;
}

test('direct document identities retain source values and permit an explicit lossless root-key rename', t => {
    for (const encoding of ['native-string', 'native-uuid', 'objectid-hex']) for (const rename of [false, true]) {
        const data = nativeDocumentFixture(t, encoding, rename);
        assert.deepEqual(validateCosmosModel(data.model), []);
        assert.deepEqual(validateConversionEvidence(data.project, data.inventory, data.models, data.root, data.evidence), []);
        const decision = data.evidence.documentMappings[0];
        const original = structuredClone(decision.examples[0].source);
        const output = executeDocumentMapping(data.inventory, data.entity, data.evidence.fieldMappings, decision, original, {
            partitionKeys: data.model.containers[0].partitionKeys,
        });
        assert.equal(Object.hasOwn(output, '_id'), !rename);
        assert.equal(output.id, encoding === 'objectid-hex' ? original._id.$oid.toLowerCase() : original._id);
        assert.deepEqual(output.extra, original.extra);
        assert.deepEqual(original, decision.examples[0].source);
        assert.deepEqual(validateSampleData(data.root, { sampleData: [{ containerName: 'Orders', items: [output] }] }, undefined, data.inventory), []);
        decision.examples[0].output.id = 'incorrect';
        assert.match(validateConversionEvidence(data.project, data.inventory, data.models, data.root, data.evidence)[0].message, /Whole-document/u);
    }
});

test('ObjectId conversion rejects malformed values and direct identity rejects mixed or mismatched native types', t => {
    const data = nativeDocumentFixture(t, 'objectid-hex');
    for (const input of [{ $oid: 'not-an-objectid' }, { $oid: '507f1f77bcf86cd799439011', extra: true }, {}, 42]) {
        assert.throws(() => encodeSourceIdentity(data.entity, [input]), /ObjectId/u);
    }
    const dataset = data.inventory.datasets[0];
    dataset.fields[0].nativeTypes.push('string');
    assert.throws(() => directIdentityField(data.entity, dataset), /Mixed or unknown/u);
    dataset.fields[0].nativeTypes = ['string'];
    assert.throws(() => directIdentityField(data.entity, dataset), /evidenced native source type/u);
});

test('source-key renaming cannot bypass preservation of composite, relational, nested, or nullable identities', t => {
    const data = nativeDocumentFixture(t, 'native-string', true);
    const dataset = data.inventory.datasets[0];
    data.entity.identity.encoding = 'typed-hex-v1';
    assert(validateCosmosModel(data.model).some(error => /direct identity/u.test(error.message)));
    assert.throws(() => directIdentityField(data.entity, dataset), /direct, lossless/u);
    data.entity.identity.encoding = 'native-string';
    data.entity.identity.fields.push({ dataset: 'orders', field: 'tenant' });
    assert.throws(() => directIdentityField(data.entity, dataset), /one field/u);
    data.entity.identity.fields.pop();
    dataset.kind = 'relational';
    assert.throws(() => directIdentityField(data.entity, dataset), /root document identity/u);
    dataset.kind = 'document';
    dataset.fields[0].path = [property('nested'), property('_id')];
    assert.throws(() => directIdentityField(data.entity, dataset), /root document identity/u);
    dataset.fields[0].path = [property('_id')];
    dataset.fields[0].nullable = true;
    assert.throws(() => directIdentityField(data.entity, dataset), /required and non-null/u);
    dataset.fields[0].nullable = false;
    const source = { ...data.evidence.documentMappings[0].examples[0].source, id: 'existing-business-value' };
    assert.throws(() => executeDocumentMapping(data.inventory, data.entity, data.evidence.fieldMappings, data.evidence.documentMappings[0], source), /collides/u);
});

test('native-string IDs are checked against the source rather than a re-encoded natural-key copy', t => {
    const data = nativeDocumentFixture(t);
    const mapping = data.evidence.fieldMappings[0];
    mapping.operation = 'json-string';
    mapping.examples[0].output = value(JSON.stringify(mapping.examples[0].inputs[0].value));
    const decision = data.evidence.documentMappings[0];
    assert.throws(() => executeDocumentMapping(data.inventory, data.entity, data.evidence.fieldMappings, decision, decision.examples[0].source), /original source key/u);
});

test('shared containers detect identity collisions and can preserve source namespaces in partition routing', t => {
    const data = nativeDocumentFixture(t, 'native-string', true);
    const otherDataset = structuredClone(data.inventory.datasets[0]);
    otherDataset.id = 'other';
    otherDataset.name = 'native.other';
    data.inventory.datasets.push(otherDataset);
    data.project.phases.assessment.domains[0].datasets.push('other');
    const other = structuredClone(data.entity);
    other.name = 'OtherOrder';
    other.docType = 'otherOrder';
    other.sourceDataset = 'other';
    other.identity.fields[0].dataset = 'other';
    for (const attribute of other.attributes) attribute.source.dataset = 'other';
    data.model.containers[0].entities.push(other);
    const otherItem = { ...data.item, docType: other.docType };
    data.evidence.identityExamples.push({ domain: 'Orders', container: 'Orders', entity: other.name, cases: [{ item: otherItem, id: otherItem.id }] });
    data.evidence.documentMappings.push({ ...structuredClone(data.evidence.documentMappings[0]), entity: other.name,
        examples: [{ source: structuredClone(data.evidence.documentMappings[0].examples[0].source), output: otherItem }] });
    const otherMappings = structuredClone(data.evidence.fieldMappings);
    for (const mapping of otherMappings) {
        mapping.entity = other.name;
        for (const input of mapping.inputs) input.dataset = 'other';
    }
    data.evidence.fieldMappings.push(...otherMappings);
    refreshDocumentModel(data);
    const validate = () => validateConversionEvidence(data.project, data.inventory, data.models, data.root, data.evidence);
    assert.match(validate()[0].message, /identities collide/u);
    data.model.containers[0].partitionKeys = [{ path: '/docType' }, { path: '/id' }];
    for (const entity of [data.entity, other]) {
        entity.attributes.push({ target: 'docType', source: { generated: 'constant', type: 'string' }, type: 'string', isPartitionKey: true });
        data.evidence.fieldMappings.push({
            domain: 'Orders', container: 'Orders', entity: entity.name, target: 'docType', inputs: [], operation: 'constant',
            constant: entity.docType, examples: [{ inputs: [], output: value(entity.docType) }],
        });
    }
    refreshDocumentModel(data);
    assert.deepEqual(validate(), []);
});

test('reference samples resolve a renamed ObjectId key against retained native reference values', t => {
    const data = nativeDocumentFixture(t, 'objectid-hex', true);
    const childDataset = structuredClone(data.inventory.datasets[0]);
    childDataset.id = 'children';
    childDataset.name = 'native.children';
    childDataset.fields.push({ id: 'parent', path: [property('parent')], nativeTypes: ['ObjectId'],
        presence: 'required', nullable: false, evidence: [sourcePath] });
    data.inventory.datasets.push(childDataset);
    data.inventory.relationships.push({
        id: 'child-parent', kind: 'reference', from: { dataset: 'children', fields: ['parent'] },
        to: { dataset: 'orders', fields: ['_id'] }, evidence: [sourcePath],
    });
    const child = structuredClone(data.entity);
    child.name = 'Child';
    child.docType = 'child';
    child.sourceDataset = 'children';
    child.identity.fields[0].dataset = 'children';
    for (const attribute of child.attributes) attribute.source.dataset = 'children';
    child.attributes.push({ target: 'parent', source: { dataset: 'children', field: 'parent', type: 'ObjectId' }, type: 'object' });
    child.relationships = [{ targetEntity: data.entity.name, sourceRelationship: 'child-parent', type: 'one-to-one', strategy: 'reference' }];
    data.root.containers.push({ ...structuredClone(data.model.containers[0]), name: 'Children', entities: [child] });
    const item = { id: '507f1f77bcf86cd799439012', tenant: 'a', docType: 'child',
        parent: { $oid: data.item.id.toUpperCase() } };
    const samples = { sampleData: [{ containerName: 'Orders', items: [data.item] }, { containerName: 'Children', items: [item] }] };
    assert.deepEqual(validateSampleData(data.root, samples, undefined, data.inventory), []);
    item.parent.$oid = item.id;
    assert(validateSampleData(data.root, samples, undefined, data.inventory).some(error => /no order sample matching/u.test(error.message)));
});
