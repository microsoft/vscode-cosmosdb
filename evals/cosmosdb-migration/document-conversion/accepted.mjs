/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Planning-only prerequisite. Conversion starts one checkpoint earlier and never receives this module or model.
export async function stageAcceptedConversion(workspace, skillRoot) {
    const script = (name) => import(pathToFileURL(join(skillRoot, 'scripts', `${name}.mjs`)).href);
    const { buildFreshnessManifest } = await script('freshness');
    const { mergeCosmosModels } = await script('merge-cosmos-models');
    const { modelHash } = await script('validate-conversion-evidence');
    const { canonicalStringify } = await script('validate-cosmos-model');
    const { executeDocumentMapping } = await script('mapping-examples');

    const migration = join(workspace, '.cosmosdb-migration');
    const conversion = join(migration, 'phases/3-schema-conversion');
    const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
    const write = (p, value) =>
        writeFileSync(p, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
    const project = read(join(migration, 'project.json'));
    const { sourceInventory, sourceSha256 } = read(join(migration, 'phases/1-discovery/preflight-manifest.json'));
    const sample = read(join(workspace, 'evidence/sample.json'));
    const domain = 'Activity';
    const container = 'journal';
    const target = { domain, container, entity: 'JournalEvent' };
    const dataset = sourceInventory.datasets.find((entry) => entry.id === 'events');
    const fields = dataset.fields.filter((field) => field.path.length === 1);
    const key = fields.find((field) => field.path[0].name === '_id');
    const ref = (field) => ({ dataset: dataset.id, field: field.id });
    const lineage = (field) => ({ ...ref(field), type: field.nativeTypes[0] });
    const idSource = lineage(key);
    const entity = {
        name: target.entity,
        docType: 'event',
        sourceDataset: dataset.id,
        identity: { kind: 'fields', fields: [ref(key)], encoding: 'typed-hex-v1' },
        attributes: [{ target: 'id', source: idSource, type: 'string', isId: true, isPartitionKey: true }],
    };
    const fieldMappings = [];
    const value = (v) => ({ state: 'value', value: v });
    const missing = { state: 'missing' };
    for (const field of fields) {
        const name = field.path[0].name;
        const type = { _id: 'string', counter: 'string', note: 'string' }[name] ?? field.nativeTypes[0];
        entity.attributes.push({
            target: name,
            source: lineage(field),
            type,
            ...(field.presence === 'required' ? {} : { optional: true }),
            ...(field.nullable === false ? {} : { nullable: true }),
        });
        const operation = name === '_id' ? 'json-string' : name === 'counter' ? 'extended-json-string' : 'copy';
        const examples = sample
            .filter((doc) => Object.hasOwn(doc, name))
            .map((doc) => {
                const input = doc[name];
                const nativeType =
                    name === '_id'
                        ? typeof input === 'string'
                            ? 'string'
                            : 'ObjectId'
                        : input === null
                          ? 'null'
                          : field.nativeTypes[0];
                return {
                    inputs: [value(input)],
                    output: value(
                        name === '_id' ? JSON.stringify(input) : name === 'counter' ? input.$numberLong : input,
                    ),
                    nativeTypes: [nativeType],
                };
            });
        if (field.presence !== 'required') examples.push({ inputs: [missing], output: missing });
        if (field.nullable !== false && !examples.some((entry) => entry.output.value === null)) {
            examples.push({ inputs: [value(null)], output: value(null) });
        }
        if (name === 'note')
            examples.push({ inputs: [value('reviewed')], output: value('reviewed'), nativeTypes: ['string'] });
        fieldMappings.push({ ...target, target: name, inputs: [ref(field)], operation, examples });
    }
    const model = {
        version: 1,
        domain,
        sourceType: sourceInventory.source.engine,
        containers: [
            {
                name: container,
                partitionKeys: [{ path: '/id' }],
                entities: [entity],
                indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [] },
            },
        ],
    };
    const options = { databaseName: 'journal', capacityMode: 'serverless' };
    const merged = mergeCosmosModels([{ domainName: domain, model }], options);
    assert.ok(merged.model, JSON.stringify([merged.errors, merged.conflicts]));
    const decision = {
        ...target,
        mode: 'reshape',
        justification: {
            benefit: 'reliability',
            evidence: ['evidence/validator.json', 'evidence/collection.json'],
            rationale:
                'A type-tagged _id is needed to preserve collection-wide uniqueness for both BSON ObjectId and string keys.',
            tradeoffs:
                'Readers decode canonical Extended JSON text before comparing native keys. Int64 decimal text is exact but does not support numeric ordering or arithmetic.',
        },
    };
    // This additional example is constructed for validation; it is not a third observation from the export.
    const synthetic = {
        ...sample[0],
        _id: sample[0]._id.$oid,
        extension: { id: 'nested source id', docType: ['second', 'first'] },
    };
    const examples = [...sample, synthetic].map((source) => ({
        source,
        output: executeDocumentMapping(sourceInventory, entity, fieldMappings, decision, source, model.containers[0]),
    }));
    const domainDir = join(conversion, 'domains', domain);
    mkdirSync(domainDir, { recursive: true });
    write(join(domainDir, 'cosmos-model.json'), model);
    write(join(conversion, 'model.json'), canonicalStringify(merged.model));
    write(join(conversion, 'manifest.json'), {
        version: 1,
        ...options,
        blockingIssues: [],
        includeUnmappedDomains: false,
        sourceSha256,
        domainSha256: { [domain]: modelHash(model) },
        sourceDispositions: [{ domain, sourceDataset: dataset.id, targets: [{ ...target, kind: 'authoritative' }] }],
        fieldMappings,
        identityExamples: [{ ...target, cases: examples.map(({ output }) => ({ item: output, id: output.id })) }],
        documentMappings: [{ ...decision, examples }],
        behaviorDecisions: [],
    });
    write(
        join(domainDir, 'summary.md'),
        `# Journal activity
## Overview
Schema-only conversion of the assessed events domain. No application is available.
## Container Mappings
journal.events maps to one authoritative JournalEvent in journal for supported documents. In addition to the two
source samples, a constructed example checks an ordinary extra property and lookalike ObjectId/string keys.
## Container Summary
\`\`\`json
${JSON.stringify(examples[0].output, null, 2)}
\`\`\`
## Partition Key Decisions
Route by /id so the same source key always reaches the same partition; uniqueness is enforced on (id, id).
Store _id as canonical Extended JSON text (including quotes for strings); typed encoding of that text gives the item id.
Compared with /tenantId, this avoids relying on application enforcement across different tenant partitions.
Reject overlength encoded keys before import; never truncate. Confirm writer limits before migrating real data.
## Embedding Strategy
Keep nested detail and batches, array order, literal dotted names, missing/null, and noncolliding extra JSON properties.
Decode counter's decimal string as Int64; a JSON number is unsafe for the full source range.
## Access Pattern Mappings
R001 (declared): filter on the indexed tenantId across partitions. R002 (inferred only): a known encoded key permits a point read.
## Cross-Partition Queries
The tenant listing fans out. Measure its cost with real workloads and reconsider tenant routing with an explicit global identity registry if needed.
## Indexing Policies
Default inclusion supports tenantId filtering; the source index was not unique. Measure write costs before refining paths.
## Optimization Recommendations
Validate realistic tenant fan-out and ID lengths before deployment. No production traffic or latency evidence was supplied.
The open validator also permits a source id, docType or other target metadata name at the root. The mapping rejects
those collisions rather than overwriting either value. Stop before writing an affected record, retain the source,
inventory the actual path and type, and review and test a reversible remap before retrying.
The sample is not a BSON census. If a sample-only field changes type, or an additional value cannot be distinguished
from a literal Extended JSON-shaped object, do not guess its type or write a lossy value. Inspect BSON-aware source
evidence and require an approved representation and decoder with round-trip tests before importing affected records.
## Throughput & Storage Recommendations
[default assumed] Serverless is an offline scenario assumption. Obtain traffic, storage and latency requirements to choose production capacity.
`,
    );
    write(
        join(conversion, 'summary.md'),
        `# Journal model
## Database Overview
journal is an artifact-only schema design.
## Container Inventory
journal, with /id routing.
## Container Mappings
Activity owns journal.events; one authoritative event is emitted per supported source document.
## Cross-Domain Relationships
None; there is one domain.
## Conflict Resolutions
None across domains. Mixed source keys are represented reversibly.
## Deployment Notes
No deployment is authorized. Verify workload distribution, capacity and item/encoded ID sizes before import.
Root metadata collisions and unrepresentable or ambiguous BSON variants block affected writes until inventoried
and mapped reversibly. Conversion completion validates bounded examples, not population-wide BSON parity.
## Per-Domain References
[Activity](./domains/Activity/summary.md)
`,
    );
    Object.assign(project.phases.schemaConversion, { status: 'complete', domains: [domain] });
    project.freshness['schema-conversion'] = buildFreshnessManifest(workspace, project, 'schema-conversion');
    write(join(migration, 'project.json'), project);
}
