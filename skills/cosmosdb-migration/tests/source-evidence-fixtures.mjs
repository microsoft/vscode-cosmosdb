import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildCompatibilityReport } from '../scripts/check-sdk-compatibility.mjs';
import { buildFreshnessManifest, fileSha256 } from '../scripts/freshness.mjs';
import { resolveItemId } from '../scripts/identity-mapping.mjs';
import { mergeCosmosModels } from '../scripts/merge-cosmos-models.mjs';
import { modelHash } from '../scripts/validate-conversion-evidence.mjs';
import { canonicalStringify, canonicalizeCosmosModel } from '../scripts/validate-cosmos-model.mjs';
import { sourceFilesHash } from '../scripts/validate-source-evidence.mjs';
import { VALID_DOMAIN_SUMMARY, VALID_ROOT_SUMMARY } from './schema-conversion-summary-fixtures.mjs';

const root = '.cosmosdb-migration';

export function writeFixture(workspace, relative, content) {
    const destination = path.join(workspace, root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
}

export function evidenceReport(headings) {
    return '# Migration evidence\n\n' + headings.map(heading => `## ${heading}\nRecorded source evidence; no unresolved issues.\n`).join('\n');
}

function writeReport(workspace, summaryPath, manifestPath, headings, evidence) {
    writeFixture(workspace, summaryPath, evidenceReport(headings));
    writeFixture(workspace, manifestPath, `${JSON.stringify({ version: 1, blockingIssues: [], ...evidence }, null, 2)}\n`);
}

function checkpointFreshness(workspace, project, phase) {
    project.freshness ??= {};
    project.freshness[phase] = buildFreshnessManifest(workspace, project, phase);
    writeFixture(workspace, 'project.json', JSON.stringify(project));
}

export function sourceFixture(workspace, project, tables = ['dbo.Orders'], fileName = 'Schema.sql') {
    project.phases.discovery.applicationAnalysis ??= { projectName: 'app', projectType: 'service', language: 'TypeScript', frameworks: ['Node.js'], databaseType: 'SQL Server', databaseAccess: 'ORM', completedAt: '2026-09-08T00:00:00.000Z' };
    project.phases.discovery.ddlParsing ??= { method: 'model', decisionSource: 'explicit' };
    const sql = tables.map(table => `CREATE TABLE ${table} (Id INT PRIMARY KEY, TenantId VARCHAR(100), Pk VARCHAR(100));`).join('\n');
    writeFixture(workspace, `phases/1-discovery/schema-ddl/${fileName}`, sql);
    const files = [{ path: `${root}/phases/1-discovery/schema-ddl/${fileName}`, sha256: createHash('sha256').update(sql).digest('hex') }];
    const inventory = { version: 1, dialect: 'tsql', parser: { method: 'model' }, files, errors: [],
        tables: tables.map(name => ({ name, identity: name.split('.').map(part => ({ name: part, quoted: false })), columns: [{ name: 'Id', type: 'INT' }, { name: 'TenantId', type: 'VARCHAR(100)' }, { name: 'Pk', type: 'VARCHAR(100)' }], primaryKey: ['Id'], foreignKeys: [] })),
        sha256: sourceFilesHash('tsql', files),
    };
    const columns = ['#', 'Schema', 'Table', 'Est. Row Count', 'Avg Row Size (KB)', 'Growth Rate (month)', 'Read TPS', 'Write TPS', 'Notes'];
    const header = fields => '| ' + fields.join(' | ') + ' |\n|' + fields.map(() => '---').join('|') + '|\n';
    writeFixture(workspace, 'phases/1-discovery/volumetrics/volumetrics.md', '# Volumetrics\n' + header(columns) + tables.map((table, index) => `| ${index + 1} | ${table.split('.')[0]} | ${table.split('.')[1]} | 100 | 1 | 0% | 10 | 1 | observed |\n`).join(''));
    writeFixture(workspace, 'phases/1-discovery/access-patterns/access-patterns.md', '# Access Patterns\n## Read Patterns\n' + header(['#', 'Pattern Name', 'Tables / Entities', 'Filter / Lookup Fields', 'Frequency (TPS)', 'Latency Requirement', 'Notes']) + tables.map((table, index) => `| R${String(index + 1).padStart(3, '0')} | Read${index} | ${table} | Id | 10 | 10ms | observed |\n`).join('') + '## Write Patterns\n' + header(['#', 'Pattern Name', 'Tables / Entities', 'Single / Batch', 'Frequency (TPS)', 'Latency Requirement', 'Notes']));
    writeReport(workspace, 'phases/1-discovery/preflight-summary.md', 'phases/1-discovery/preflight-manifest.json', ['Summary', 'Warnings', 'Decisions'], { sourceSha256: inventory.sha256, sourceInventory: inventory });
    checkpointFreshness(workspace, project, 'preflight');
    return inventory;
}

export function discoveryFixture(
    workspace,
    inventory,
    project = JSON.parse(fs.readFileSync(path.join(workspace, root, 'project.json'), 'utf8')),
    { patterns = [], noObservedAccess = inventory.tables.map(table => table.name) } = {},
) {
    project.phases.discovery.preflightStatus = 'complete';
    writeFixture(workspace, 'project.json', JSON.stringify(project));
    const languages = String(project.phases.discovery.applicationAnalysis.language)
        .split(',')
        .map((language) => language.trim())
        .filter(Boolean);
    writeReport(workspace, 'phases/1-discovery/discovery-report.md', 'phases/1-discovery/discovery-manifest.json', ['Source Overview', 'Read Patterns', 'Write Patterns', 'Relational Semantics', 'Warnings'], { sourceSha256: inventory.sha256, tables: inventory.tables.map(table => table.name), patterns, noObservedAccess, sdkCompatibility: buildCompatibilityReport(languages) });
    checkpointFreshness(workspace, project, 'discovery');
}

export function assessmentFixture(workspace, project, inventory) {
    project.phases.discovery.preflightStatus = 'complete';
    project.phases.discovery.status = 'complete';
    writeFixture(workspace, 'project.json', JSON.stringify(project));
    const discoveryPath = path.join(workspace, root, 'phases/1-discovery/discovery-report.md');
    if (!fs.existsSync(discoveryPath)) discoveryFixture(workspace, inventory, project);
    const domains = project.phases.assessment.domains;
    writeReport(workspace, 'phases/2-assessment/assessment-summary.md', 'phases/2-assessment/assessment-manifest.json', ['Overview', 'Domains', 'Cross-Domain Dependencies', 'Recommendations', 'Warnings'], { sourceSha256: inventory.sha256, tables: inventory.tables.map(table => table.name), domains: domains.map(domain => domain.name), crossDomainEdges: [] });
    for (const domain of domains) writeReport(workspace, `phases/2-assessment/domains/${domain.name}.md`, `phases/2-assessment/domains/${domain.name}.manifest.json`, ['Purpose', 'Tables', 'Access Patterns', 'Cross-Domain Dependencies'], { sourceSha256: inventory.sha256, domain: domain.name, tables: domain.tables });
    checkpointFreshness(workspace, project, 'assessment');
}

export function conversionFixture(workspace, inventory, domains, rootModel, project = JSON.parse(fs.readFileSync(path.join(workspace, root, 'project.json'), 'utf8'))) {
    project.phases.discovery.preflightStatus = 'complete';
    project.phases.discovery.status = 'complete';
    project.phases.assessment.status = 'complete';
    writeFixture(workspace, 'project.json', JSON.stringify(project));
    const assessmentPath = path.join(workspace, root, 'phases/2-assessment/assessment-summary.md');
    if (!fs.existsSync(assessmentPath)) assessmentFixture(workspace, project, inventory);
    for (const entry of domains) {
        writeFixture(workspace, `phases/3-schema-conversion/domains/${entry.domainName}/summary.md`, domainSummary());
        writeFixture(workspace, `phases/3-schema-conversion/domains/${entry.domainName}/cosmos-model.json`, `${JSON.stringify(entry.model, null, 2)}\n`);
    }
    writeFixture(workspace, 'phases/3-schema-conversion/model.json', canonicalStringify(canonicalizeCosmosModel(rootModel)));
    writeFixture(workspace, 'phases/3-schema-conversion/summary.md', VALID_ROOT_SUMMARY);
    writeFixture(workspace, 'phases/3-schema-conversion/manifest.json', `${JSON.stringify({ version: 1, sourceSha256: inventory.sha256, includeUnmappedDomains: false, domainSha256: Object.fromEntries(domains.map(entry => [entry.domainName, modelHash(entry.model)])), databaseName: rootModel.databaseName, capacityMode: rootModel.capacityMode, blockingIssues: [], }, null, 2)}\n`);
    checkpointFreshness(workspace, project, 'schema-conversion');
}

export function domainSummary() {
    return VALID_DOMAIN_SUMMARY;
}

export function verificationSummary(workspace, project, verification) {
    const summary = evidenceReport(['Summary', 'Target Verification', 'Warnings']);
    writeFixture(workspace, 'phases/4-provisioning/summary.md', summary);
    writeFixture(workspace, 'phases/4-provisioning/manifest.json', `${JSON.stringify({ version: 1, blockingIssues: [], verification }, null, 2)}\n`);
    checkpointFreshness(workspace, project, 'provisioning');
    return summary;
}

export function createSourceNeutralFixture(workspace, engine = 'ExampleDocumentStore') {
    const sourcePath = 'source.json';
    const value = entry => ({ state: 'value', value: entry });
    fs.writeFileSync(path.join(workspace, sourcePath), '{"_id":{"$oid":"507f1f77bcf86cd799439011"},"tenant":"a"}');
    const files = [{
        path: sourcePath, sha256: fileSha256(path.join(workspace, sourcePath)), kind: 'sample',
        disposition: 'used', rationale: 'Selected sample export reviewed.',
        provenance: { method: 'user export', scope: 'one document' },
    }];
    const field = (id, nativeType) => ({
        id, path: [{ kind: 'property', name: id }], nativeTypes: [nativeType], presence: 'required', nullable: false, evidence: [sourcePath],
    });
    const inventory = {
        version: 2, source: { engine, version: null, namespaces: ['native'], capabilities: [] }, files, errors: [],
        datasets: [{
            id: 'orders', name: 'native.orders', kind: 'document', evidence: [sourcePath],
            coverage: { basis: 'observed', scope: 'selected document', complete: false,
                sampling: { method: 'bounded export', size: 1, limitations: 'Rare variants may be absent.' } },
            fields: [field('_id', 'ObjectId'), field('tenant', 'string')],
            identities: [{ id: 'native-id', kind: 'native', fields: ['_id'], scope: 'collection', evidence: [sourcePath] }],
        }], relationships: [], semantics: [],
    };
    const project = {
        version: 1, name: 'app', sourceCode: 'parent', custom: { preserve: true },
        phases: {
            discovery: {
                status: 'complete', preflightStatus: 'complete', schemaInventory: { files: ['../source.json'], excludedFiles: [] },
                applicationAnalysis: { projectName: 'app', projectType: 'service', language: 'TypeScript',
                    databaseType: engine, databaseAccess: 'driver', completedAt: '2026-10-01T00:00:00Z' },
            },
            assessment: { status: 'complete', domains: [{ name: 'Orders', datasets: ['orders'],
                crossDomainDependencies: [], estimatedTokens: 100, isMapped: true }] },
            schemaConversion: { status: 'complete', domains: ['Orders'] },
        },
    };
    const source = fieldId => ({ dataset: 'orders', field: fieldId, type: fieldId === '_id' ? 'ObjectId' : 'string' });
    const entity = {
        name: 'Order', docType: 'order', sourceDataset: 'orders',
        identity: { kind: 'fields', fields: [{ dataset: 'orders', field: '_id' }], encoding: 'typed-hex-v1' },
        attributes: [
            { target: 'id', source: source('_id'), type: 'string', isId: true },
            { target: 'sourceId', source: source('_id'), type: 'string' },
            { target: 'tenant', source: source('tenant'), type: 'string', isPartitionKey: true },
        ],
    };
    const model = { version: 1, domain: 'Orders', sourceType: engine, containers: [{
        name: 'Orders', partitionKeys: [{ path: '/tenant' }], entities: [entity],
        indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [] },
    }] };
    const models = [{ domainName: 'Orders', model }];
    const root = mergeCosmosModels(models, { databaseName: 'app', capacityMode: 'serverless' }).model;
    const item = { sourceId: '507f1f77bcf86cd799439011', tenant: 'a', docType: 'order' };
    item.id = resolveItemId(entity, item);
    inventory.sha256 = sourceFilesHash(engine, files);
    const evidence = {
        version: 1, includeUnmappedDomains: false, sourceSha256: inventory.sha256,
        domainSha256: { Orders: modelHash(model) }, databaseName: 'app', capacityMode: 'serverless', blockingIssues: [],
        fieldMappings: [
            { domain: 'Orders', container: 'Orders', entity: 'Order', target: 'sourceId', inputs: [{ dataset: 'orders', field: '_id' }],
                operation: 'extended-json-string', examples: [{ inputs: [value({ $oid: item.sourceId })], output: value(item.sourceId) }] },
            { domain: 'Orders', container: 'Orders', entity: 'Order', target: 'tenant', inputs: [{ dataset: 'orders', field: 'tenant' }],
                operation: 'copy', examples: [{ inputs: [value('a')], output: value('a') }] },
        ],
        identityExamples: [{ domain: 'Orders', container: 'Orders', entity: 'Order', cases: [{ item, id: item.id }] }],
        documentMappings: [{
            domain: 'Orders', container: 'Orders', entity: 'Order', mode: 'preserve',
            examples: [{ source: { _id: { $oid: item.sourceId }, tenant: 'a' }, output: structuredClone(item) }],
        }],
        behaviorDecisions: [],
    };
    return { project, inventory, model, models, root, entity, item, evidence };
}

export function writeSourceNeutralAnalysis(workspace, fixture) {
    const { project, inventory, model, root, evidence } = fixture;
    const json = (file, content) => writeFixture(workspace, file, JSON.stringify(content));
    const report = (prefix, name, headings, manifest) => {
        writeFixture(workspace, `${prefix}/${name}.md`, evidenceReport(headings));
        json(`${prefix}/${name.replace(/(?:summary|report)$/u, 'manifest')}.json`, { version: 1, blockingIssues: [], sourceSha256: inventory.sha256, ...manifest });
    };
    report('phases/1-discovery', 'preflight-summary', ['Summary', 'Warnings', 'Decisions'], { sourceInventory: inventory });
    writeFixture(workspace, 'phases/1-discovery/volumetrics/volumetrics.md',
        '# Volumetrics\n| # | Namespace | Dataset | Est. Record Count | Avg Record Size (KB) | Growth Rate (month) | Read TPS | Write TPS | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | native | orders | unknown | 1 | unknown | unknown | unknown | sampled |\n');
    writeFixture(workspace, 'phases/1-discovery/access-patterns/access-patterns.md',
        '# Access Patterns\n## Read Patterns\n| # | Pattern Name | Datasets | Filter / Lookup Fields | Frequency (TPS) | Latency Requirement | Notes |\n|---|---|---|---|---|---|---|\n## Write Patterns\n| # | Pattern Name | Datasets | Single / Batch | Frequency (TPS) | Latency Requirement | Notes |\n|---|---|---|---|---|---|---|\nNo observed application access: orders\n');
    report('phases/1-discovery', 'discovery-report', ['Source Overview', 'Read Patterns', 'Write Patterns', 'Source Semantics', 'Warnings'],
        { datasets: ['orders'], patterns: [], noObservedAccess: ['orders'],
            ...(project.phases.discovery.applicationAnalysis.codebaseAvailable === false ? {} : { sdkCompatibility: buildCompatibilityReport(['TypeScript']) }) });
    report('phases/2-assessment', 'assessment-summary', ['Overview', 'Domains', 'Cross-Domain Dependencies', 'Recommendations', 'Warnings'],
        { datasets: ['orders'], domains: ['Orders'], crossDomainEdges: [] });
    writeFixture(workspace, 'phases/2-assessment/domains/Orders.md', evidenceReport(['Purpose', 'Datasets', 'Access Patterns', 'Cross-Domain Dependencies']));
    json('phases/2-assessment/domains/Orders.manifest.json', { version: 1, blockingIssues: [], sourceSha256: inventory.sha256, domain: 'Orders', datasets: ['orders'] });
    json('phases/3-schema-conversion/domains/Orders/cosmos-model.json', model);
    writeFixture(workspace, 'phases/3-schema-conversion/domains/Orders/summary.md', VALID_DOMAIN_SUMMARY);
    writeFixture(workspace, 'phases/3-schema-conversion/model.json', canonicalStringify(canonicalizeCosmosModel(root)));
    writeFixture(workspace, 'phases/3-schema-conversion/summary.md', VALID_ROOT_SUMMARY);
    json('phases/3-schema-conversion/manifest.json', evidence);
    project.freshness = Object.fromEntries(['preflight', 'discovery', 'assessment', 'schema-conversion'].map(phase => [phase, buildFreshnessManifest(workspace, project, phase)]));
    json('project.json', project);
}
