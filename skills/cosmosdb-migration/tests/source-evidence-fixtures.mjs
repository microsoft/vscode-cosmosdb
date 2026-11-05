import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildCompatibilityReport } from '../scripts/check-sdk-compatibility.mjs';
import { buildFreshnessManifest } from '../scripts/freshness.mjs';
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
