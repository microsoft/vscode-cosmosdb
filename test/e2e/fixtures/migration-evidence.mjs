/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Run in a Node subprocess so Playwright does not transform the portable ESM helpers into CommonJS.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkPhaseCompletion } from '../../../skills/cosmosdb-relational-migration/scripts/check-phase-completion.mjs';
import { buildFreshnessManifest } from '../../../skills/cosmosdb-relational-migration/scripts/freshness.mjs';
import { mergeCosmosModels } from '../../../skills/cosmosdb-relational-migration/scripts/merge-cosmos-models.mjs';
import { modelHash } from '../../../skills/cosmosdb-relational-migration/scripts/validate-conversion-evidence.mjs';
import {
    canonicalizeCosmosModel,
    canonicalStringify,
} from '../../../skills/cosmosdb-relational-migration/scripts/validate-cosmos-model.mjs';
import { sourceFilesHash } from '../../../skills/cosmosdb-relational-migration/scripts/validate-source-evidence.mjs';
import {
    assessmentFixture,
    discoveryFixture,
    evidenceReport,
    verificationSummary,
    writeFixture,
} from '../../../skills/cosmosdb-relational-migration/tests/source-evidence-fixtures.mjs';

const [workspace, phase] = process.argv.slice(2);
if (!workspace || !phase) throw new Error('Usage: migration-evidence.mjs <workspace> <phase>');
const root = path.join(workspace, '.cosmosdb-migration');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const writeJson = (relative, value) => writeFixture(workspace, relative, `${JSON.stringify(value, null, 2)}\n`);
const project = readJson('project.json');
const discoveryRoot = 'phases/1-discovery';
const inventoryPath = `${discoveryRoot}/preflight-manifest.json`;

function recordPreflight() {
    // This inventory describes the fixed seed DDL; hash the supplied file without replacing it.
    const tables = [
        {
            name: 'Orders',
            columns: [
                { name: 'OrderID', type: 'INT' },
                { name: 'CustomerID', type: 'INT' },
                { name: 'OrderDate', type: 'DATETIME' },
                { name: 'Total', type: 'DECIMAL(18,2)' },
            ],
            primaryKey: ['OrderID'],
            foreignKeys: [],
        },
        {
            name: 'OrderDetails',
            columns: [
                { name: 'OrderDetailID', type: 'INT' },
                { name: 'OrderID', type: 'INT' },
                { name: 'ProductID', type: 'INT' },
                { name: 'Quantity', type: 'INT' },
                { name: 'UnitPrice', type: 'DECIMAL(18,2)' },
            ],
            primaryKey: ['OrderDetailID'],
            foreignKeys: [
                {
                    name: 'FK_OrderDetails_Orders',
                    columns: ['OrderID'],
                    referencedTable: 'Orders',
                    referencedColumns: ['OrderID'],
                },
            ],
        },
    ].map((table) => ({ ...table, identity: [{ name: table.name, quoted: false }] }));
    const ddlPath = `.cosmosdb-migration/${discoveryRoot}/schema-ddl/schema.sql`;
    const files = [
        {
            path: ddlPath,
            sha256: createHash('sha256')
                .update(fs.readFileSync(path.join(workspace, ddlPath)))
                .digest('hex'),
        },
    ];
    const inventory = {
        version: 1,
        dialect: 'tsql',
        parser: { method: 'model' },
        files,
        tables,
        errors: [],
        sha256: sourceFilesHash('tsql', files),
    };
    project.phases.discovery.ddlParsing = { method: 'model', decisionSource: 'explicit' };
    writeJson(inventoryPath, {
        version: 1,
        blockingIssues: [],
        sourceSha256: inventory.sha256,
        sourceInventory: inventory,
    });
    writeFixture(
        workspace,
        `${discoveryRoot}/preflight-summary.md`,
        evidenceReport(['Summary', 'Warnings', 'Decisions']),
    );
    const table = (headers) => `| ${headers.join(' | ')} |\n|${headers.map(() => '---').join('|')}|\n`;
    writeFixture(
        workspace,
        `${discoveryRoot}/volumetrics/volumetrics.md`,
        '# Volumetrics\n' +
            table([
                '#',
                'Schema',
                'Table',
                'Est. Row Count',
                'Avg Row Size (KB)',
                'Growth Rate (month)',
                'Read TPS',
                'Write TPS',
                'Notes',
            ]) +
            tables
                .map(
                    (entry, index) =>
                        `| ${index + 1} | N/A | ${entry.name} | 100 | 1 | 0% | 10 | 1 | synthetic fixture |\n`,
                )
                .join(''),
    );
    writeFixture(
        workspace,
        `${discoveryRoot}/access-patterns/access-patterns.md`,
        '# Access Patterns\n## Read Patterns\n' +
            table([
                '#',
                'Pattern Name',
                'Tables / Entities',
                'Filter / Lookup Fields',
                'Frequency (TPS)',
                'Latency Requirement',
                'Notes',
            ]) +
            '\n## Write Patterns\n' +
            table([
                '#',
                'Pattern Name',
                'Tables / Entities',
                'Single / Batch',
                'Frequency (TPS)',
                'Latency Requirement',
                'Notes',
            ]) +
            tables.map((entry) => `\nNo observed application access: ${entry.name}\n`).join(''),
    );
}

switch (phase) {
    case 'preflight':
        recordPreflight();
        break;
    case 'discovery':
        discoveryFixture(workspace, readJson(inventoryPath).sourceInventory, project);
        break;
    case 'assessment':
        assessmentFixture(workspace, project, readJson(inventoryPath).sourceInventory);
        break;
    case 'schema-conversion': {
        const domainModels = project.phases.schemaConversion.domains.map((domainName) => ({
            domainName,
            model: readJson(`phases/3-schema-conversion/domains/${domainName}/cosmos-model.json`),
        }));
        const settings = { databaseName: 'E2E Migration', capacityMode: 'serverless' };
        const merged = mergeCosmosModels(domainModels, settings);
        if (!merged.model) throw new Error(JSON.stringify(merged));
        writeFixture(
            workspace,
            'phases/3-schema-conversion/model.json',
            canonicalStringify(canonicalizeCosmosModel(merged.model)),
        );
        writeJson('phases/3-schema-conversion/manifest.json', {
            version: 1,
            sourceSha256: readJson(inventoryPath).sourceInventory.sha256,
            includeUnmappedDomains: false,
            domainSha256: Object.fromEntries(domainModels.map((entry) => [entry.domainName, modelHash(entry.model)])),
            ...settings,
            blockingIssues: [],
        });
        break;
    }
    case 'provisioning':
        verificationSummary(workspace, project, readJson('phases/4-provisioning/provisioning-verification.json'));
        break;
    default:
        throw new Error(`Unsupported evidence phase: ${phase}`);
}
project.freshness ??= {};
project.freshness[phase] = buildFreshnessManifest(workspace, project, phase);
writeJson('project.json', project);
const result = checkPhaseCompletion(workspace, phase);
if (!result.complete) throw new Error(JSON.stringify(result, null, 2));
