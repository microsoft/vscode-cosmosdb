/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Both reviews start at the same accepted application checkpoint, including the historical execution.
export async function writeAcceptedCheckpoint(workspace, skillRoot) {
    const load = (relative) => import(pathToFileURL(join(skillRoot, relative)).href);
    const { createSourceNeutralFixture, writeSourceNeutralAnalysis, writeFixture } = await load(
        'tests/source-evidence-fixtures.mjs',
    );
    const { sourceFilesHash } = await load('scripts/validate-source-evidence.mjs');
    const { checkPhaseCompletion } = await load('scripts/check-phase-completion.mjs');
    const { buildFreshnessManifest } = await load('scripts/freshness.mjs');
    mkdirSync(workspace, { recursive: true });
    const data = createSourceNeutralFixture(workspace);
    const { project, inventory } = data;
    const discovery = project.phases.discovery;
    discovery.applicationAnalysis.codebaseAvailable = true;
    const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const fileHash = (file) => digest(readFileSync(join(workspace, file)));
    const write = (file, content) => writeFileSync(join(workspace, file), content);
    write(
        'orders.ts',
        'export type NativeOrder = { _id: { $oid: string }; tenant: string };\n' +
            'export const displayOrder = (row: NativeOrder) => row.tenant;\n',
    );
    write('catalog.json', '{"collection":"native.orders","identity":{"field":"_id","scope":"collection"}}\n');
    write('package.json', '{"private":true,"dependencies":{"@azure/cosmos":"4.2.0"}}\n');
    write(
        'client.ts',
        "import { CosmosClient } from '@azure/cosmos';\nexport const client = new CosmosClient(process.env.COSMOS_CONNECTION!);\n",
    );
    for (const [file, kind, scope] of [
        ['orders.ts', 'code', 'NativeOrder application shape'],
        ['catalog.json', 'metadata', 'native.orders identity declaration'],
    ]) {
        discovery.schemaInventory.files.push(`../${file}`);
        inventory.files.push({
            path: file,
            sha256: fileHash(file),
            kind,
            disposition: 'used',
            rationale: scope,
            provenance: { method: 'engineer handoff', scope },
        });
    }
    const dataset = inventory.datasets[0];
    dataset.evidence.push('catalog.json', 'orders.ts');
    dataset.identities[0].evidence = ['catalog.json'];
    for (const field of dataset.fields) field.evidence.push('orders.ts');
    inventory.sha256 = sourceFilesHash(inventory.source.engine, inventory.files);
    data.evidence.sourceSha256 = inventory.sha256;
    const planPath = '.cosmosdb-migration/code-migration-plan.md';
    project.phases.codeMigration = {
        status: 'complete',
        planPath,
        outputPaths: ['client.ts'],
        completedAt: '2026-10-02T00:00:00.000Z',
    };
    writeSourceNeutralAnalysis(workspace, data);
    const sectionsMarkdown = (sections) =>
        Object.entries(sections)
            .map(([heading, text]) => `## ${heading}\n${text}\n`)
            .join('\n');
    const conversion = 'phases/3-schema-conversion';
    const [container] = data.model.containers;
    const [routing] = container.partitionKeys;
    const domain = data.model.domain;
    const mapping = `${dataset.name} maps to ${container.name} in ${data.root.databaseName}.`;
    writeFixture(
        workspace,
        `${conversion}/domains/${domain}/summary.md`,
        `# ${domain}\n\n` +
            sectionsMarkdown({
                Overview: mapping,
                'Container Mappings': `One ${data.entity.docType} item per source document.`,
                'Container Summary': `\`\`\`json\n${JSON.stringify(data.item, null, 2)}\n\`\`\``,
                'Partition Key Decisions': `Route by ${routing.path}; use the complete partition key and item ID for point reads.`,
                'Embedding Strategy': 'Keep each order together; preserve the native identifier as sourceId.',
                'Access Pattern Mappings': 'No application database operation has been observed or cut over.',
                'Cross-Partition Queries': 'Lookups without the tenant route may fan out.',
                'Indexing Policies':
                    'The default inclusive policy covers order fields; no measured query workload is available.',
                'Optimization Recommendations': 'Measure the actual operations before narrowing the index.',
                'Throughput & Storage Recommendations': `[default assumed] ${data.root.capacityMode}; verify against real traffic before deployment.`,
            }),
    );
    writeFixture(
        workspace,
        `${conversion}/summary.md`,
        `# ${data.root.databaseName}\n\n` +
            sectionsMarkdown({
                'Database Overview': `${data.root.databaseName} is the accepted logical database; this model is not a deployed target.`,
                'Container Inventory': `${container.name}, routed by ${routing.path}.`,
                'Container Mappings': mapping,
                'Cross-Domain Relationships': 'No cross-domain relationships were declared.',
                'Conflict Resolutions': 'There is one owning domain and no merge conflicts.',
                'Deployment Notes':
                    'The source remains authoritative; the previously introduced client is not a cutover.',
                'Per-Domain References': `[${domain}](./domains/${domain}/summary.md)`,
            }),
    );
    project.freshness['schema-conversion'] = buildFreshnessManifest(workspace, project, 'schema-conversion');
    writeFixture(workspace, 'project.json', JSON.stringify(project));
    const sections = {
        Overview: 'Prior iteration: introduce the shared client without changing presentation.',
        'Affected Files': 'client.ts',
        'Ordered Changes': '1. Add the shared Cosmos client.',
        'Access Pattern Migration':
            'No operation was cut over. At review, displayOrder returned only the tenant label.',
        'Configuration and Authentication': 'Read COSMOS_CONNECTION from the deployment environment.',
        Validation: 'Historical synthetic build and behavior checks verified the shared client.',
        Rollback: 'Remove the unused client module.',
        'Applied Rules': 'sdk-singleton-client',
        'Blocker Review': 'No candidate blockers.',
        'Unresolved Blockers': 'None.',
    };
    write(planPath, sectionsMarkdown(sections));
    const phases = '.cosmosdb-migration/phases';
    const sdk = JSON.parse(
        readFileSync(join(workspace, phases, '1-discovery/discovery-manifest.json')),
    ).sdkCompatibility;
    writeFixture(
        workspace,
        'code-migration-manifest.json',
        JSON.stringify({
            version: 1,
            mode: 'migrate',
            modelSha256: fileHash(`${phases}/3-schema-conversion/model.json`),
            sdkReportSha256: digest(`${JSON.stringify(sdk, null, 2)}\n`),
            bestPractices: { rules: ['sdk-singleton-client'], unresolvedConcerns: [] },
            outputFiles: [{ path: 'client.ts', sha256: fileHash('client.ts') }],
            blockingSteps: [],
            validation: [
                {
                    command: 'npm run verify',
                    status: 'passed',
                    exitCode: 0,
                    checks: ['build', 'behavior'],
                    coverage: 'Synthetic historical record: compiled the client module and tested singleton reuse.',
                },
            ],
        }),
    );
    const analysis = checkPhaseCompletion(workspace, 'schema-conversion');
    assert.equal(analysis.complete, true, JSON.stringify(analysis));
    const history = checkPhaseCompletion(workspace, 'code-migration');
    assert.ok(history.complete && history.ready, JSON.stringify(history));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const file = process.argv[2];
    assert.ok(['orders.ts', 'catalog.json'].includes(file));
    await writeAcceptedCheckpoint(resolve('app'), resolve('cosmosdb-migration'));
    renameSync('revision', join('app', file));
    // Only the resulting inputs and the runtime skill are visible when the executor starts.
    rmSync('cosmosdb-migration/tests', { recursive: true });
    rmSync(fileURLToPath(import.meta.url));
}
