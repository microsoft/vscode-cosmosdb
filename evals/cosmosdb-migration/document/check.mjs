/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPhaseCompletion } from '../../../skills/cosmosdb-migration/scripts/check-phase-completion.mjs';
import { domainSources, sourceFieldId } from '../../../skills/cosmosdb-migration/scripts/source-contract.mjs';
import { assertFreshInventory } from '../fresh-inventory.mjs';
import { snapshot, temporaryWorkspace } from '../workspace.mjs';
import { collection, declaration, prepareDocument, sample, validator, workload } from './fixtures.mjs';

const migration = '.cosmosdb-migration';
const projectPath = `${migration}/project.json`;
const discovery = `${migration}/phases/1-discovery`;
const preflightManifest = `${discovery}/preflight-manifest.json`;
const discoveryManifest = `${discovery}/discovery-manifest.json`;
const skillRoot = fileURLToPath(new URL('../../../skills/cosmosdb-migration/', import.meta.url));
const phases = {
    'document-preflight': 'preflight',
    'document-discovery': 'discovery',
    'document-assessment': 'assessment',
    'document-conversion': 'schema-conversion',
    'document-planning': 'code-migration',
};
const stateKey = {
    preflight: 'discovery',
    discovery: 'discovery',
    assessment: 'assessment',
    'schema-conversion': 'schemaConversion',
    'code-migration': 'codeMigration',
};

const read = (workspace, path) => readFileSync(join(workspace, path), 'utf8');
const readJson = (workspace, path) => JSON.parse(read(workspace, path));
const without = (object, keys) =>
    Object.fromEntries(Object.entries(object ?? {}).filter(([name]) => !keys.includes(name)));

function allowedOutput(path, phase, project) {
    if (path === `${migration}/memory.md`) return phase !== 'code-migration';
    const prefix = `${migration}/phases/`;
    if (!path.startsWith(prefix)) return false;
    const phasePath = path.slice(prefix.length);
    if (phase === 'assessment' && phasePath.startsWith('2-assessment/domains/')) {
        return project.phases.assessment.domains?.some(({ name }) =>
            [`2-assessment/domains/${name}.md`, `2-assessment/domains/${name}.manifest.json`].includes(phasePath),
        );
    }
    if (phase === 'schema-conversion' && phasePath.startsWith('3-schema-conversion/domains/')) {
        return project.phases.schemaConversion.domains?.some((name) =>
            [
                `3-schema-conversion/domains/${name}/summary.md`,
                `3-schema-conversion/domains/${name}/cosmos-model.json`,
            ].includes(phasePath),
        );
    }
    const outputs = {
        preflight:
            /^1-discovery\/(?:preflight-(?:manifest\.json|summary\.md)|volumetrics\/volumetrics\.md|access-patterns\/access-patterns\.md)$/u,
        discovery: /^1-discovery\/discovery-(?:report\.md|manifest\.json)$/u,
        assessment: /^2-assessment\/assessment-(?:summary\.md|manifest\.json)$/u,
        'schema-conversion': /^3-schema-conversion\/(?:model\.json|manifest\.json|summary\.md)$/u,
    };
    return outputs[phase]?.test(phasePath) ?? false;
}

function assertProjectBoundary(project, initial, phase) {
    assert.deepEqual(
        without(project, ['phases', 'execution', 'runCounts', 'freshness']),
        without(initial, ['phases', 'execution', 'runCounts', 'freshness']),
        'Changed project identity, scope or user metadata',
    );
    if (project.execution) assert.equal(project.execution.phase, phase, 'Out-of-phase execution state');
    const key = stateKey[phase];
    const allowedCount = phase === 'preflight' || phase === 'code-migration' ? [] : [key];
    const countPolicy = allowedCount.length ? `only runCounts.${key} may change` : `${phase} has no run counter`;
    assert.deepEqual(
        without(project.runCounts, allowedCount),
        without(initial.runCounts, allowedCount),
        `Changed out-of-phase run counts: ${countPolicy}`,
    );
    assert.deepEqual(
        without(project.freshness, [phase]),
        without(initial.freshness, [phase]),
        'Changed out-of-phase freshness',
    );
    const writable = {
        preflight: ['preflightCompletedAt', 'preflightStatus', 'applicationAnalysis'],
        discovery: ['completedAt', 'status', 'reportPath', 'manifestPath'],
        assessment: ['completedAt', 'status', 'domains', 'parsedAccessPatterns'],
        'schema-conversion': ['completedAt', 'status', 'domains'],
        'code-migration': [],
    }[phase];
    assert.deepEqual(
        without(project.phases, [key]),
        without(initial.phases, [key]),
        'Changed a phase outside the request',
    );
    assert.deepEqual(
        without(project.phases[key], writable),
        without(initial.phases[key], writable),
        'Changed unrelated checkpoint metadata',
    );
    if (phase === 'discovery') {
        for (const [property, artifact] of [
            ['reportPath', 'discovery-report.md'],
            ['manifestPath', 'discovery-manifest.json'],
        ]) {
            const path = project.phases.discovery[property];
            if (path === undefined) continue;
            const relative = `phases/1-discovery/${artifact}`;
            assert.ok(
                typeof path === 'string' && [relative, `${migration}/${relative}`].includes(path.replace(/^\.\//u, '')),
                `Wrong discovery ${property}`,
            );
        }
    }
    if (phase === 'code-migration') {
        assert.deepEqual(project.freshness, initial.freshness, 'Blocked planning cannot record freshness');
    }
}

// Rebuild the prerequisite snapshot on the host. Never trust a baseline, helper or recorded hash from the trial.
export async function assertDocumentBoundary(workspace, scenario) {
    const phase = phases[scenario];
    assert.ok(phase, `Unknown document grading scenario: ${scenario}`);
    const baseline = temporaryWorkspace();
    try {
        await prepareDocument(baseline, scenario, skillRoot);
        const before = snapshot(baseline);
        const after = snapshot(workspace);
        if (phase === 'code-migration') {
            assert.deepEqual(after, before, 'Out-of-phase file or change during read-only planning review');
            return;
        }
        const project = readJson(workspace, projectPath);
        for (const [path, hash] of before) {
            if (path !== projectPath) assert.equal(after.get(path), hash, `Changed supplied or accepted file: ${path}`);
        }
        for (const [path, stamp] of after) {
            assert.ok(
                stamp === 'directory' || before.has(path) || allowedOutput(path, phase, project),
                `Out-of-phase file: ${path}`,
            );
        }
        assertProjectBoundary(project, readJson(baseline, projectPath), phase);
    } finally {
        rmSync(baseline, { recursive: true, force: true });
    }
}

function assertSchemaOnly(analysis) {
    assert.equal(analysis?.codebaseAvailable, false, 'Record schema-only scope');
    assert.match(analysis.databaseType, /mongo/iu);
    for (const key of ['language', 'databaseAccess', 'projectType', 'sdkCompatibility']) {
        assert.ok(!analysis[key], `Invented application detail: ${key}`);
    }
    assert.ok(!analysis.frameworks?.length, 'Invented application frameworks');
}

function checkNativeIndexes(indexes, nativeIndexes) {
    assert.ok(Array.isArray(indexes), 'Record the native secondary indexes in the inventory');
    const remaining = new Map(nativeIndexes.map((index) => [index.name, index]));
    for (const index of indexes) {
        const native = remaining.get(index.name);
        assert.ok(native, `Unknown or duplicate native index: ${index.name}`);
        remaining.delete(index.name);
        assert.equal(index.unique, native.unique, `Wrong uniqueness for ${index.name}`);

        const key = Object.entries(native.key);
        if (index.key !== undefined) {
            const entries = Array.isArray(index.key)
                ? index.key.map(({ field, fieldId, direction }) => {
                      assert.equal(typeof field, 'string', `Missing key field for ${index.name}`);
                      if (fieldId !== undefined) {
                          assert.equal(
                              fieldId,
                              sourceFieldId([{ kind: 'property', name: field }]),
                              `Wrong field ID for ${index.name}`,
                          );
                      }
                      return [field, direction];
                  })
                : Object.entries(index.key);
            assert.deepEqual(entries, key, `Wrong ordered key or direction for ${index.name}`);
        }
        if (index.key === undefined || index.fields !== undefined) {
            const fields = key.map(([name]) => sourceFieldId([{ kind: 'property', name }]));
            assert.deepEqual(index.fields, fields, `Wrong indexed fields for ${index.name}`);
        }
        if (index.key === undefined || index.direction !== undefined) {
            const ascending = key[0][1] === 1;
            const directions = ascending ? ['asc', 'ascending', '1'] : ['desc', 'descending', '-1'];
            assert.ok(
                key.length === 1 && directions.includes(String(index.direction).toLowerCase()),
                `Wrong direction for ${index.name}`,
            );
        }
    }
    // The identities array already accounts for the native _id index.
    remaining.delete('_id_');
    assert.deepEqual([...remaining.keys()], [], 'Missing native secondary index');
}

function checkSampleFields(fields, documents, declared) {
    const observed = new Map();
    function visit(value, path) {
        const id = sourceFieldId(path);
        const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        if (!observed.has(id)) observed.set(id, new Set());
        observed.get(id).add(type);
        if (type === 'array') {
            for (const item of value) visit(item, [...path, { kind: 'array' }]);
        } else if (type === 'object') {
            for (const [name, item] of Object.entries(value)) visit(item, [...path, { kind: 'property', name }]);
        }
    }
    // In this fixture only the declared roots use Extended JSON wrappers. Do not inventory wrapper keys as fields.
    for (const doc of documents) {
        for (const [name, value] of Object.entries(doc)) {
            if (!Object.hasOwn(declared, name)) visit(value, [{ kind: 'property', name }]);
        }
    }
    for (const id of ['$.detail.label', '$["detail.label"]', '$.batches[*].values[*]']) {
        assert.ok(fields.has(id), `Missing source path ${id}`);
    }
    for (const [id, field] of fields) {
        if (field.path.length === 1 && Object.hasOwn(declared, field.path[0].name)) continue;
        const types = observed.get(id);
        assert.ok(types && field.evidence.includes(sample), `No sample evidence for ${id}`);
        const reported = new Set(field.nativeTypes.map(nativeType));
        for (const type of types) assert.ok(reported.has(type), `Missing observed ${type} for ${id}`);
        for (const type of reported) assert.ok(type === 'unknown' || types.has(type), `Unobserved ${type} for ${id}`);
        assert.notEqual(field.presence, 'required', `Sample cannot require ${id}`);
        assert.notEqual(field.nullable, false, `Sample cannot guarantee non-null for ${id}`);
        if (field.nullable === true) {
            assert.ok(
                types.has('null') || field.evidence.includes(validator),
                `Nullable ${id} needs an observed null or the open validator`,
            );
        }
    }
}

const nativeType = (type) => type.toLowerCase().replace(/^bson(?:\s+|:)/u, '');

function checkPreflight(workspace, manifest) {
    const inventory = manifest.sourceInventory;
    assertFreshInventory(inventory);
    assert.equal(inventory.parser ?? null, null, 'Non-DDL source does not require a parser');
    assert.equal(inventory.dialect ?? null, null, 'No SQL dialect was supplied');
    if (inventory.source.version !== null)
        assert.match(
            inventory.source.version,
            /unknown|unavailable|unspecified|not (?:provided|supplied|known)/iu,
            'No server version was supplied',
        );
    assert.match(inventory.source.engine, /mongo/iu);
    assert.equal(inventory.datasets.length, 1);
    const [dataset] = inventory.datasets;
    assert.match(dataset.name, /^(?:journal\.)?events$/u);
    assert.equal(dataset.kind, 'document');
    const kinds = new Map([
        [validator, 'metadata'],
        [collection, 'metadata'],
        [sample, 'sample'],
        [workload, 'documentation'],
    ]);
    assert.deepEqual(
        inventory.files.map((file) => file.path).sort(),
        [...kinds.keys()].sort(),
        'Missing selected native inputs',
    );
    for (const file of inventory.files) {
        assert.equal(file.kind, kinds.get(file.path), `Incorrect evidence kind: ${file.path}`);
        assert.equal(file.disposition, 'used', `Ignored useful evidence: ${file.path}`);
    }
    const workloadInput = manifest.workloadInputs.find(
        (entry) => entry.path === workload && entry.source === 'access-patterns',
    );
    assert.equal(workloadInput?.disposition, 'used');
    assert.notEqual(workloadInput.evidenceKind, 'observed', 'A declaration is not measured traffic');
    assert.equal(
        dataset.coverage.complete,
        false,
        'Open validator and bounded sample cannot certify complete field coverage',
    );
    if (dataset.coverage.basis === 'observed') {
        assert.equal(dataset.coverage.sampling.size, 2, 'The supplied sample contains two records');
    } else {
        // The contract also allows declared coverage and sampling:null; retain the bounded observation in its provenance.
        assert.equal(dataset.coverage.basis, 'declared');
        const sampleFile = inventory.files.find((file) => file.path === sample);
        assert.match(
            `${JSON.stringify(sampleFile.provenance)} ${sampleFile.rationale} ${read(workspace, `${discovery}/preflight-summary.md`)}`,
            /\b(?:2|two)\b/iu,
        );
    }

    // Resolve the typed paths via canonical IDs, not display names. In particular, "detail.label" is not two properties.
    const fields = new Map(dataset.fields.map((field) => [field.id, field]));
    const required = (id, types, presence, nullable, evidence) => {
        const field = fields.get(id);
        assert.ok(field, `Missing source path ${id}`);
        const nativeTypes = field.nativeTypes.map(nativeType);
        for (const type of types)
            assert.ok(
                nativeTypes.some((value) => type.test(value)),
                `Missing native type for ${id}: ${type}`,
            );
        assert.equal(field.presence, presence, `Wrong presence for ${id}`);
        assert.ok(
            nativeTypes.every((value) => types.some((type) => type.test(value)) || (nullable && value === 'null')),
            `Unsupported declared type for ${id}`,
        );
        assert.equal(field.nullable, nullable, `Wrong nullability for ${id}`);
        assert.ok(field.evidence.includes(evidence), `${id} must cite ${evidence}`);
    };
    required('$._id', [/^objectid$/u, /^string$/u], 'required', false, validator);
    required('$.tenantId', [/^string$/u], 'required', false, validator);
    required(
        '$.counter',
        [/^(?:long|numberlong|(?:signed )?(?:int(?:eger)?[\s-]?64|64-bit (?:signed )?integer))$/u],
        'required',
        false,
        validator,
    );
    required('$.note', [/^string$/u], 'optional', true, validator);
    const declared = readJson(workspace, validator).validator.$jsonSchema.properties;
    checkSampleFields(fields, readJson(workspace, sample), declared);
    const metadata = readJson(workspace, collection);
    const scopes = new Set(
        ['collection', 'collection-wide', 'collection-scoped', metadata.ns, metadata.identityScope].map((scope) =>
            scope.toLowerCase(),
        ),
    );
    assert.ok(dataset.identities.length, 'Missing collection-scoped native identity');
    for (const identity of dataset.identities) {
        assert.ok(['native', 'primary', 'unique'].includes(identity.kind), 'No shard routing key was declared');
        assert.deepEqual(identity.fields, ['$._id'], 'Only _id has a declared identity');
        assert.ok(identity.evidence.includes(collection), 'Identity requires collection metadata, not the sample');
        assert.ok(scopes.has(identity.scope.trim().toLowerCase()), 'Identity is collection-scoped');
    }
    checkNativeIndexes(dataset.indexes, metadata.indexes);
}

function readFacts(pattern, dataset) {
    // The compact form names a single top-level filter, not arbitrary fields mentioned in the operation or projection.
    const byField = /\bby ([A-Za-z_][A-Za-z_0-9]*)[.!]?$/iu.exec(pattern.operation.trim());
    const compact = byField && dataset.fields.find(({ path }) => path.length === 1 && path[0].name === byField[1]);
    const filters = pattern.filterFields ?? (compact ? [compact.id] : undefined);
    assert.ok(Array.isArray(filters), 'Identify the read predicates in filterFields, or end operation with by FIELD');
    assert.equal(new Set(filters).size, filters.length, 'Duplicate read predicate fields');
    for (const id of filters)
        assert.ok(
            dataset.fields.some((field) => field.id === id),
            `Unknown predicate: ${id}`,
        );
    const result = pattern.resultKind ?? 'records';
    assert.ok(
        ['records', 'one', 'count', 'aggregate', 'exists', 'distinct', 'projection'].includes(result),
        'Unknown resultKind',
    );
    return { filters, result };
}

function checkDiscovery(workspace, dataset) {
    const manifest = readJson(workspace, discoveryManifest);
    assert.equal(manifest.sdkCompatibility, undefined, 'No SDK can be evaluated without a codebase');
    for (const pattern of manifest.patterns) {
        assert.deepEqual(domainSources(pattern), [dataset.id]);
        assert.equal(pattern.kind, 'read', 'No writes are evidenced');
        assert.equal(pattern.tps, null, 'No measured traffic rates were supplied');
        assert.ok(
            ['user-declared', 'schema-inferred'].includes(pattern.evidence),
            'No observed traffic, query logs or code',
        );
    }
    const confirmed = manifest.patterns.filter((pattern) => pattern.evidence === 'user-declared');
    assert.equal(confirmed.length, 1, 'Exactly one read was confirmed');
    const [declared] = confirmed;
    assert.equal(declared.declaration, declaration, 'Retain the supplied engineer declaration verbatim');
    const cites = (pattern, path) => pattern.sourcePaths.some((ref) => ref.split('#')[0] === path);
    assert.ok(cites(declared, workload), 'Cite the engineer workload handoff for the confirmed read');
    assert.deepEqual(
        readFacts(declared, dataset),
        { filters: ['$.tenantId'], result: 'records' },
        'Confirmed tenant listing',
    );

    const inferred = manifest.patterns.filter((pattern) => pattern.evidence === 'schema-inferred');
    assert.equal(inferred.length, 1, 'Supply one additional schema-inferred read');
    const [candidate] = inferred;
    assert.ok(candidate.declaration == null, 'The engineer did not declare the candidate');
    const { filters, result } = readFacts(candidate, dataset);
    assert.ok(filters.length !== 1 || filters[0] !== '$.tenantId' || result !== 'records', 'Duplicate tenant listing');
    const nativeSources = dataset.evidence.filter((path) => cites(candidate, path));
    assert.ok(nativeSources.length, 'The candidate must cite supporting native evidence');
    const facts = [...dataset.fields, ...dataset.identities, ...dataset.indexes];
    for (const id of filters) {
        assert.ok(
            facts.some(
                (fact) =>
                    (fact.id === id || fact.fields?.includes(id)) &&
                    fact.evidence?.some((source) => nativeSources.includes(source)),
            ),
            `No cited native evidence for candidate predicate ${id}`,
        );
    }
}

export async function checkDocument(workspace, scenario) {
    await assertDocumentBoundary(workspace, scenario);
    const phase = phases[scenario];
    assert.notEqual(phase, 'schema-conversion', 'Document conversion has its own grader');
    const result = checkPhaseCompletion(workspace, phase === 'code-migration' ? 'schema-conversion' : phase);
    assert.ok(result.complete && result.freshness === 'current', JSON.stringify(result));
    const project = readJson(workspace, projectPath);
    assertSchemaOnly(project.phases.discovery.applicationAnalysis);
    const manifest = readJson(workspace, preflightManifest);
    assert.equal(manifest.sdkCompatibility, undefined);
    if (phase === 'preflight') {
        checkPreflight(workspace, manifest);
    } else if (phase === 'discovery') {
        checkDiscovery(workspace, manifest.sourceInventory.datasets[0]);
    } else if (phase === 'assessment') {
        const domains = project.phases.assessment.domains;
        assert.ok(
            domains.every((domain) => domain.isMapped === false),
            'No application mapping exists',
        );
        assert.deepEqual(
            domains.flatMap(domainSources).sort(),
            manifest.sourceInventory.datasets.map((dataset) => dataset.id).sort(),
            'Every selected dataset needs exactly one owner',
        );
        for (const pattern of project.phases.assessment.parsedAccessPatterns ?? []) {
            assert.equal(pattern.codeReferences.length, 0, 'No application code references exist');
            assert.ok(!pattern.codeExample && !pattern.sqlExample, 'Do not invent an application or SQL query');
        }
        assert.equal(
            readJson(workspace, `${migration}/phases/2-assessment/assessment-manifest.json`).sdkCompatibility,
            undefined,
        );
    } else {
        assert.equal(
            checkPhaseCompletion(workspace, 'code-migration').ready,
            false,
            'Schema-only conversion is not a code handoff',
        );
    }
}
