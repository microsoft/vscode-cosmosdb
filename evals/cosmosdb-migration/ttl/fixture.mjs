/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function prepareTtlFixture(workspace, skillRoot) {
    mkdirSync(workspace, { recursive: true });
    const load = (path) => import(pathToFileURL(join(skillRoot, path)).href);
    const { createSourceNeutralFixture, writeSourceNeutralAnalysis, writeFixture } = await load(
        'tests/source-evidence-fixtures.mjs',
    );
    const { resolveItemId } = await load('scripts/identity-mapping.mjs');
    const { mergeCosmosModels } = await load('scripts/merge-cosmos-models.mjs');
    const { modelHash } = await load('scripts/validate-conversion-evidence.mjs');
    const { buildFreshnessManifest, fileSha256 } = await load('scripts/freshness.mjs');
    const { sourceFilesHash } = await load('scripts/validate-source-evidence.mjs');
    const { checkPhaseCompletion } = await load('scripts/check-phase-completion.mjs');
    const { buildProvisioningArtifacts } = await load('scripts/generate-provisioning-artifacts.mjs');
    const write = (path, content) =>
        writeFixture(workspace, path, typeof content === 'string' ? content : JSON.stringify(content));
    const data = createSourceNeutralFixture(workspace);
    const { model, evidence, inventory, item, project } = data;
    const policy = 'orders-contract.json';
    const declaration = 'List order memberships by tenant independently of order payload reads.';
    writeFileSync(
        join(workspace, policy),
        JSON.stringify({
            dataset: 'native.orders',
            requiredNonNullFields: { _id: 'ObjectId', tenant: 'string' },
            uniqueKey: { field: '_id', scope: 'collection' },
            retention: 'Orders and all membership copies expire 30 seconds after the last source write.',
            declaredRead: declaration,
            reviewScope:
                'Synthetic replay: the initial source write and both target writes occur at second 100; all are updated at second 120. No delayed writes or historical import are approved.',
        }),
    );
    project.phases.discovery.schemaInventory.files.push(`../${policy}`);
    project.phases.discovery.applicationAnalysis = {
        codebaseAvailable: false,
        projectName: 'Orders',
        databaseType: inventory.source.engine,
        completedAt: '2026-10-01T00:00:00Z',
    };
    project.phases.assessment.domains[0].isMapped = false;
    inventory.files.push({
        path: policy,
        sha256: fileSha256(join(workspace, policy)),
        kind: 'documentation',
        disposition: 'used',
        rationale: 'Engineer-declared schema, retention policy and read requirement for the synthetic replay.',
        provenance: { method: 'engineer declaration', scope: 'native.orders' },
    });
    inventory.datasets[0].evidence.push(policy);
    inventory.datasets[0].identities[0].evidence = [policy];
    for (const field of inventory.datasets[0].fields) field.evidence.push(policy);
    inventory.sha256 = sourceFilesHash(inventory.source.engine, inventory.files);
    evidence.sourceSha256 = inventory.sha256;
    inventory.semantics.push({
        id: 'retention',
        kind: 'expiration',
        expirationBasis: 'sliding',
        status: 'known',
        required: true,
        datasets: ['orders'],
        description: 'All order data expires 30 seconds after the last write.',
        evidence: [policy],
    });
    const primary = { domain: 'Orders', container: 'Orders', entity: 'Order' };
    const target = { domain: 'Orders', container: 'OrdersByTenant', entity: 'OrderMembership' };
    model.containers[0].defaultTtl = 30;
    const copy = structuredClone(model.containers[0]);
    copy.name = target.container;
    const entity = copy.entities[0];
    entity.name = target.entity;
    entity.docType = 'membership';
    model.containers.push(copy);
    const projected = { ...item, docType: entity.docType, id: resolveItemId(entity, item) };
    evidence.fieldMappings.push(...evidence.fieldMappings.map((mapping) => ({ ...mapping, ...target })));
    evidence.identityExamples.push({ ...target, cases: [{ item: projected, id: projected.id }] });
    const justification = {
        benefit: 'performance',
        rationale: 'Serve membership lookups independently.',
        tradeoffs: 'The derived copy must be kept current.',
        evidence: [policy],
    };
    Object.assign(evidence.documentMappings[0], { mode: 'reshape', justification });
    evidence.documentMappings.push({
        ...target,
        mode: 'projection',
        justification,
        examples: [{ source: evidence.documentMappings[0].examples[0].source, output: projected }],
    });
    evidence.sourceDispositions = [
        {
            sourceDataset: 'orders',
            domain: 'Orders',
            targets: [
                { ...primary, kind: 'authoritative' },
                { ...target, kind: 'projection' },
            ],
        },
    ];
    evidence.behaviorDecisions = [
        {
            semantic: 'retention',
            action: 'preserve',
            rationale: 'Keep the source write-relative window.',
            implementation:
                'Both targets inherit the 30-second default for this same-second write replay. Block delayed writes or historical import until remaining lifetime is modeled and verified.',
            examples: [primary, target].map((entry) => ({
                ...entry,
                operation: 'ttl-relative',
                input: {
                    backfill: { exampleIndex: 0, lastModifiedSeconds: 100, sourceExpiresAtSeconds: 130 },
                    update: { exampleIndex: 0, lastModifiedSeconds: 120, sourceExpiresAtSeconds: 150 },
                },
                expected: { equivalent: true },
            })),
        },
    ];
    evidence.domainSha256.Orders = modelHash(model);
    data.root = mergeCosmosModels(data.models, { databaseName: 'app', capacityMode: 'serverless' }).model;
    writeSourceNeutralAnalysis(workspace, data);
    const discovery = 'phases/1-discovery';
    const conversion = 'phases/3-schema-conversion';
    const provisioning = 'phases/4-provisioning';
    write(
        `${discovery}/access-patterns/access-patterns.md`,
        `# Access Patterns
## Read Patterns
| # | Pattern Name | Datasets | Filter / Lookup Fields | Frequency (TPS) | Latency Requirement | Notes |
|---|---|---|---|---|---|---|
| R001 | Tenant memberships | orders | tenant | unknown | unknown | ${declaration} Engineer-declared, not measured. |
## Write Patterns
| # | Pattern Name | Datasets | Single / Batch | Frequency (TPS) | Latency Requirement | Notes |
|---|---|---|---|---|---|---|
`,
    );
    write(`${discovery}/discovery-manifest.json`, {
        version: 1,
        blockingIssues: [],
        sourceSha256: inventory.sha256,
        datasets: ['orders'],
        noObservedAccess: [],
        patterns: [
            {
                id: 'R001',
                kind: 'read',
                datasets: ['orders'],
                evidence: 'user-declared',
                declaration,
                operation: declaration,
                sourcePaths: [policy],
                tps: null,
            },
        ],
    });
    write(
        `${discovery}/discovery-report.md`,
        `# Orders discovery
## Source Overview
Schema-only review of native.orders, using one synthetic document and ${policy}.
## Read Patterns
R001 (engineer-declared): ${declaration}
## Write Patterns
No application operations or production rates were observed.
## Source Semantics
The declared retention window is relative to the source write and also applies to copies.
## Warnings
The sample is not evidence of completeness or of the retention policy.
`,
    );
    write(
        `${conversion}/domains/Orders/summary.md`,
        `# Orders
## Overview
One authoritative item and one derived membership per order in the synthetic replay.
## Container Mappings
native.orders maps to Orders/Order and OrdersByTenant/OrderMembership.
## Container Summary
\`\`\`json
${JSON.stringify([item, projected], null, 2)}
\`\`\`
## Partition Key Decisions
Both containers route by /tenant. A target address includes its container, tenant and id.
## Embedding Strategy
Keep order content on the authoritative item. The membership copy contains only lookup fields.
## Access Pattern Mappings
R001 uses the tenant-routed membership projection so the lookup workload can be served independently.
## Cross-Partition Queries
The declared read supplies its tenant. There is no measured traffic or approved cross-tenant lookup.
## Indexing Policies
Both containers use the inclusive default indexing policy.
## Optimization Recommendations
Each target uses a 30-second container default in this synchronized replay. A late copy or late backfill
would reset the window: do not use this design for those writes without a verified remaining-lifetime mapping.
## Throughput & Storage Recommendations
[default assumed] Serverless for the synthetic workload; measure both copies before deployment.
`,
    );
    write(
        `${conversion}/summary.md`,
        `# Orders conversion
## Database Overview
app is a serverless logical database, not a verified deployment.
## Container Inventory
Orders and OrdersByTenant route by /tenant and use a 30-second default TTL.
## Container Mappings
Orders is authoritative; OrdersByTenant is the derived membership view.
## Cross-Domain Relationships
None; both targets are owned by Orders.
## Conflict Resolutions
The source retention policy applies independently to each target write.
## Deployment Notes
Samples are generated test data, not source rows. No deployment or seed operation was run.
## Per-Domain References
[Orders](./domains/Orders/summary.md)
`,
    );
    const sampleData = {
        sampleData: model.containers.map(({ name, entities: [entity] }) => ({
            containerName: name,
            items: [1, 2, 3].map((n) => {
                const seed = {
                    sourceId: n.toString(16).padStart(24, '0'),
                    tenant: `seed-tenant-${n}`,
                    docType: entity.docType,
                };
                return { ...seed, id: resolveItemId(entity, seed) };
            }),
        })),
    };
    const samplePath = `${provisioning}/sample-data.json`;
    write(samplePath, sampleData);
    for (const [name, content] of Object.entries(
        buildProvisioningArtifacts(data.root, sampleData, project, undefined, inventory),
    )) {
        write(`${provisioning}/${name}`, content);
    }
    const stamp = (phase) => {
        project.freshness[phase] = buildFreshnessManifest(workspace, project, phase);
        write('project.json', project);
    };
    for (const phase of ['preflight', 'discovery', 'assessment', 'schema-conversion']) stamp(phase);
    const control = checkPhaseCompletion(workspace, 'schema-conversion');
    assert.ok(control.complete && control.freshness === 'current', JSON.stringify(control));

    // Plant only the missing projection witness and the seed override. The saved flag and hashes stay current;
    // neither should be mistaken for semantic validation.
    evidence.behaviorDecisions[0].examples.pop();
    write(`${conversion}/manifest.json`, evidence);
    sampleData.sampleData[0].items[0].ttl = 60;
    write(samplePath, sampleData);
    stamp('schema-conversion');
}
