/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function prepareFixture(workspace, phase, skillRoot) {
    assert.ok(['preflight', 'assessment', 'provisioning'].includes(phase), `Unknown artifact scenario: ${phase}`);
    const { sourceFixture, discoveryFixture, assessmentFixture, conversionFixture, verificationSummary, writeFixture } =
        await import(pathToFileURL(join(skillRoot, 'tests/source-evidence-fixtures.mjs')).href);
    const { buildFreshnessManifest } = await import(pathToFileURL(join(skillRoot, 'scripts/freshness.mjs')).href);
    const project = {
        version: 1,
        name: 'orders-eval',
        sourceCode: 'parent',
        customMetadata: { preserve: 'user-owned-value' },
        phases: {
            discovery: {
                status: 'not-started',
                preflightStatus: 'not-started',
                ddlParsing: { method: 'model', decisionSource: 'explicit' },
                applicationAnalysis: {
                    projectName: 'Orders',
                    projectType: 'service',
                    language: 'TypeScript',
                    databaseType: 'SQL Server',
                    databaseAccess: 'SQL',
                    completedAt: '2026-10-01T00:00:00.000Z',
                },
            },
            assessment: { status: 'not-started', domains: [] },
            schemaConversion: { status: 'not-started', domains: [] },
            provisioning: { status: 'not-started' },
            codeMigration: { status: 'not-started' },
        },
    };
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
        join(workspace, 'orders.ts'),
        "export const readOrder = 'SELECT Id, TenantId, Pk FROM dbo.Orders WHERE Id = @id';\n",
    );
    const inventory = sourceFixture(workspace, project);
    for (const path of ['volumetrics/volumetrics.md', 'access-patterns/access-patterns.md']) {
        const file = join(workspace, '.cosmosdb-migration/phases/1-discovery', path);
        writeFileSync(file, readFileSync(file, 'utf8').replaceAll('observed', 'synthetic evaluation input'));
    }
    project.freshness.preflight = buildFreshnessManifest(workspace, project, 'preflight');
    if (phase !== 'preflight') {
        discoveryFixture(workspace, inventory, project, {
            patterns: [
                {
                    id: 'R001',
                    kind: 'read',
                    tables: ['dbo.Orders'],
                    sourcePaths: ['orders.ts'],
                    evidence: 'code',
                    tps: 10,
                    operation: 'SELECT Id, TenantId, Pk FROM dbo.Orders WHERE Id = @id',
                },
            ],
            noObservedAccess: [],
        });
        project.phases.discovery.status = 'complete';
    } else {
        // Leave supplied inputs, but no generated inventory or ready-made preflight answer.
        for (const name of ['preflight-summary.md', 'preflight-manifest.json']) {
            rmSync(join(workspace, '.cosmosdb-migration/phases/1-discovery', name));
        }
        delete project.freshness;
    }
    if (phase === 'provisioning') {
        const { buildProvisioningArtifacts } = await import(
            pathToFileURL(join(skillRoot, 'scripts/generate-provisioning-artifacts.mjs')).href
        );
        const { modelSha256 } = await import(
            pathToFileURL(join(skillRoot, 'scripts/validate-provisioning-verification.mjs')).href
        );
        project.phases.assessment = {
            status: 'complete',
            domains: [
                {
                    name: 'Orders',
                    tables: ['dbo.Orders'],
                    isMapped: true,
                    estimatedTokens: 1000,
                    crossDomainDependencies: [],
                },
            ],
        };
        project.phases.schemaConversion = { status: 'complete', domains: ['Orders'] };
        const model = {
            version: 1,
            domain: 'all',
            databaseName: 'orders-model-default',
            capacityMode: 'serverless',
            containers: [
                {
                    name: 'Orders',
                    partitionKeys: [{ path: '/id' }],
                    entities: [
                        {
                            name: 'Order',
                            docType: 'order',
                            sourceTable: 'dbo.Orders',
                            idTemplate: 'order-{Id}',
                            attributes: [
                                {
                                    target: 'id',
                                    source: { table: 'Orders', column: 'Id', type: 'int' },
                                    type: 'string',
                                    isId: true,
                                    isPartitionKey: true,
                                },
                                {
                                    target: 'orderId',
                                    source: { table: 'Orders', column: 'Id', type: 'int' },
                                    type: 'integer',
                                },
                                {
                                    target: 'TenantId',
                                    source: { table: 'Orders', column: 'TenantId', type: 'varchar' },
                                    type: 'string',
                                },
                                {
                                    target: 'Pk',
                                    source: { table: 'Orders', column: 'Pk', type: 'varchar' },
                                    type: 'string',
                                },
                            ],
                        },
                    ],
                    indexingPolicy: {
                        indexingMode: 'consistent',
                        automatic: true,
                        includedPaths: [{ path: '/*' }],
                        excludedPaths: [],
                    },
                },
            ],
        };
        assessmentFixture(workspace, project, inventory);
        conversionFixture(
            workspace,
            inventory,
            [{ domainName: 'Orders', model: { ...model, domain: 'Orders' } }],
            model,
            project,
        );
        const document = { id: 'order-1', docType: 'order', orderId: 1, TenantId: 'tenant-1', Pk: 'pk-1' };
        writeFixture(
            workspace,
            'phases/3-schema-conversion/domains/Orders/summary.md',
            [
                '# Orders Schema Conversion',
                '## Overview\nAccepted synthetic fixture design for target-switch evaluation, not a production assessment.',
                '## Tables to Container Mapping\ndbo.Orders maps to Orders without embedding or additional entities.',
                `## Container Summary\nOne order docType; source fields are retained.\n\n\`\`\`json\n${JSON.stringify(document, null, 2)}\n\`\`\``,
                '## Partition Key Decisions\n/id uses order-{Id} and preserves primary-key uniqueness; orderId retains the original integer value.',
                '## Embedding Strategy\nNo child collections exist in the supplied schema.',
                '## Access Pattern Mappings\nR001 looks up Id; the derived id supplies both point-read coordinates.',
                '## Cross-Partition Queries\nNone are required by the supplied lookup.',
                '## Indexing Policies\nConsistent indexing includes all properties for this small fixture.',
                '## Optimization Recommendations\nUse point reads for the known order ID.',
                '## Throughput & Storage Recommendations\n[volumetrics] [access patterns] Synthetic inputs: 100 rows, 1 KB per row, 10 read TPS and 1 write TPS; serverless. No production measurements.',
            ].join('\n\n') + '\n',
        );
        writeFixture(
            workspace,
            'phases/3-schema-conversion/summary.md',
            [
                '# Orders Migration Database',
                '## Database Overview\norders-model-default is the model default, not a deployment constraint. Synthetic fixture only.',
                '## Container Inventory\nOrders uses /id and serverless capacity.',
                '## Container Mappings\ndbo.Orders maps to Orders; Id is retained as orderId, while TenantId and Pk retain their names.',
                '## Cross-Domain Relationships\nNone.',
                '## Conflict Resolutions\nOne domain; no merge conflicts.',
                '## Deployment Notes\nUse the saved target database without renaming this accepted model or the project.',
                '## Per-Domain References\n[Orders](./domains/Orders/summary.md)',
            ].join('\n\n') + '\n',
        );
        project.freshness['schema-conversion'] = buildFreshnessManifest(workspace, project, 'schema-conversion');
        const verifiedAt = '2026-10-01T00:00:00.000Z';
        project.phases.targetEnvironment = {
            type: 'azure',
            accountName: 'orders-eval-account',
            endpoint: 'https://orders-eval-account.documents.azure.com/',
            databaseName: 'orders-previous-target',
            capacityMode: 'serverless',
            subscriptionId: '00000000-0000-0000-0000-000000000001',
            tenantId: '00000000-0000-0000-0000-000000000002',
            resourceGroup: 'orders-eval-group',
            location: 'eastus',
            verified: true,
            verifiedAt,
        };
        project.phases.provisioning = {
            status: 'complete',
            databaseName: 'orders-previous-target',
            containersCreated: ['Orders'],
            sampleDataInserted: true,
            completedAt: verifiedAt,
        };
        const sampleData = { sampleData: [{ containerName: 'Orders', items: [document] }] };
        writeFixture(workspace, 'phases/4-provisioning/sample-data.json', `${JSON.stringify(sampleData, null, 2)}\n`);
        for (const [name, content] of Object.entries(buildProvisioningArtifacts(model, sampleData, project))) {
            writeFixture(workspace, `phases/4-provisioning/${name}`, content);
        }
        verificationSummary(workspace, project, {
            version: 1,
            verifiedAt,
            modelSha256: modelSha256(model),
            target: {
                type: 'azure',
                accountName: project.phases.targetEnvironment.accountName,
                endpoint: project.phases.targetEnvironment.endpoint,
            },
            databaseName: 'orders-previous-target',
            containers: [
                {
                    name: 'Orders',
                    partitionKeys: ['/id'],
                    capacityMode: 'serverless',
                    indexingPolicy: model.containers[0].indexingPolicy,
                },
            ],
            sampleItems: [
                { containerName: 'Orders', id: document.id, partitionKeyValues: [document.id], found: true, document },
            ],
            failures: [],
        });
        writeFixture(
            workspace,
            'phases/4-provisioning/summary.md',
            [
                '# Previous target checkpoint',
                '## Summary\nSynthetic evaluation history only. No account was contacted or deployed by setup.',
                '## Target Verification\nThe fixture simulates completed provisioning of orders-previous-target. Its saved readback cannot verify a replacement database.',
                '## Warnings\nPreserve orders-previous-target and unrelated data. A database switch requires fresh verification after explicit mutation approval.',
            ].join('\n\n') + '\n',
        );
    }
    writeFileSync(join(workspace, '.cosmosdb-migration/project.json'), `${JSON.stringify(project, null, 2)}\n`);
    return { project, inventory };
}
