/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPhaseCompletion } from '../../../skills/cosmosdb-migration/scripts/check-phase-completion.mjs';
import { assertFreshInventory } from '../fresh-inventory.mjs';
import { fileStamp, snapshot, temporaryWorkspace } from '../workspace.mjs';
import { writeAcceptedCheckpoint } from './checkpoint.mjs';

const here = fileURLToPath(new URL('./', import.meta.url));
const skill = fileURLToPath(new URL('../../../skills/cosmosdb-migration/', import.meta.url));
const migration = '.cosmosdb-migration/';
const discovery = `${migration}phases/1-discovery/`;
const projectFile = `${migration}project.json`;
const readJson = (workspace, file) => JSON.parse(readFileSync(join(workspace, file), 'utf8'));

function assertFamilyScope(identity, family) {
    // A scope can be a name or a qualified role ("ordered source routing tuple for weather.pulses").
    // Match the remaining location in full: "per station in weather.pulses" is a different scope.
    const role =
        identity.kind === 'routing'
            ? /\brouting(?: tuple| key)?\b/u
            : /\b(?:unique |primary )?(?:row )?(?:key|identity)\b/u;
    const statement = identity.scope.trim().toLowerCase().replace(/\s+/gu, ' ').replace(/\.$/u, '');
    // A routing tuple need not be unique. Do not discard other qualifiers, or this disclaimer on a unique row key.
    const location = identity.kind === 'routing' ? statement.replace(/\s*;\s*no uniqueness claim$/u, '') : statement;
    const scope = location
        .replace(/\bwide[- ]column family\b/gu, 'family')
        .replace(/\b(?:ordered|declared|source|native)\s+/gu, '')
        .replace(role, '')
        .trim()
        .replace(/^(?:(?:for|in|within|of) )?(?:the )?/u, '');
    const name = family.wideColumnFamily;
    const qualified = `${family.namespace}.${name}`;
    const scopes = ['family', 'family-wide', 'family-scoped', 'dataset', name, qualified];
    for (const label of [name, qualified]) scopes.push(`${label} family`, `family ${label}`);
    assert.ok(
        scopes.includes(scope),
        `The ${identity.kind} identity scope must be the source family, not ${identity.scope}`,
    );
}

function assertGustObservation(inventory, gust, raw) {
    const filename = 'slice.jsonl';
    const sample = inventory.files.find((file) => file.path === filename);
    assert.ok(
        gust?.evidence.includes(filename) && ['optional', 'unknown'].includes(gust.presence),
        'gust is sampled, not required',
    );
    assert.deepEqual(gust.nativeTypes, ['unknown'], 'The export does not declare a native gust type');
    assert.equal(gust.nullable, null, 'A missing gust is not evidence of native nullability');

    // The raw slice is the oracle, never the submission. Check both attestations when both are supplied.
    const rows = readFileSync(join(raw, filename), 'utf8')
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line));
    const present = rows.filter((row) => Object.hasOwn(row, 'gust'));
    assert.ok(
        Object.hasOwn(gust, 'sampleObservation') || Object.hasOwn(sample, 'sampleRows'),
        'The submitted inventory must attest gust JSON values and omissions with sampleObservation or sampleRows',
    );
    if (Object.hasOwn(gust, 'sampleObservation')) {
        const observation = gust.sampleObservation;
        assert.equal(observation?.source, filename, 'Identify the gust observation source');
        assert.deepEqual(
            observation.values,
            present.map((row) => row.gust),
            'Wrong observed gust JSON values',
        );
        assert.equal(observation.missing, rows.length - present.length, 'Wrong sampled gust missing count');
    }
    if (Object.hasOwn(sample, 'sampleRows')) {
        assert.ok(Array.isArray(sample.sampleRows), 'sampleRows must contain the sampled JSON rows');
        const byOrdinal = (a, b) => a.ordinal - b.ordinal;
        assert.deepEqual([...sample.sampleRows].sort(byOrdinal), rows.sort(byOrdinal), 'Wrong submitted slice rows');
    }
}

function checkPreflight(workspace, after) {
    const raw = join(here, 'unfamiliar');
    const before = snapshot(raw);
    const generated = new Set([
        projectFile,
        `${migration}memory.md`,
        `${discovery}volumetrics/volumetrics.md`,
        `${discovery}access-patterns/access-patterns.md`,
        `${discovery}preflight-summary.md`,
        `${discovery}preflight-manifest.json`,
    ]);
    for (const [file, stamp] of before) {
        if (file !== projectFile) assert.equal(after.get(file), stamp, `Changed supplied input: ${file}`);
    }
    for (const [file, stamp] of after) {
        if (stamp !== 'directory') assert.ok(before.has(file) || generated.has(file), `Out-of-phase file: ${file}`);
    }
    const project = readJson(workspace, projectFile);
    const initial = readJson(raw, projectFile);
    for (const key of ['version', 'name', 'sourceCode']) assert.equal(project[key], initial[key]);
    const { discovery: phase, ...later } = project.phases;
    const { discovery: input, ...untouched } = initial.phases;
    assert.deepEqual(later, untouched, 'Advanced a downstream phase');
    for (const key of ['status', 'schemaInventory', 'volumetrics', 'accessPatterns']) {
        assert.deepEqual(phase[key], input[key], `Changed discovery ${key}`);
    }
    for (const key of ['codebaseAvailable', 'projectName', 'databaseType']) {
        assert.equal(phase.applicationAnalysis[key], input.applicationAnalysis[key]);
    }
    assert.ok(!phase.ddlParsing && !phase.applicationAnalysis.language, 'Invented parser decision or application');
    assert.deepEqual(Object.keys(project.freshness ?? {}), ['preflight'], 'Require only preflight freshness');
    const manifest = readJson(workspace, `${discovery}preflight-manifest.json`);
    const inventory = manifest.sourceInventory;
    assertFreshInventory(inventory);
    assert.equal(inventory.source.engine, 'LoomCell');
    assert.equal(inventory.parser, undefined, 'No DDL parser applies to the native evidence');
    assert.deepEqual(Object.fromEntries(inventory.files.map((file) => [file.path, [file.kind, file.disposition]])), {
        'family.json': ['metadata', 'used'],
        'slice.jsonl': ['sample', 'used'],
        'requirements.md': ['documentation', 'used'],
    });
    assert.equal(inventory.datasets.length, 1);
    const [dataset] = inventory.datasets;
    const family = readJson(raw, 'family.json');
    assert.deepEqual(inventory.source.namespaces, [family.namespace], 'Retain the declared family namespace');
    assert.ok([family.wideColumnFamily, `${family.namespace}.${family.wideColumnFamily}`].includes(dataset.name));
    assert.equal(dataset.kind, 'other');
    assert.ok(dataset.evidence.includes('family.json') && dataset.evidence.includes('slice.jsonl'));
    assert.ok(
        ['declared', 'observed'].includes(dataset.coverage.basis),
        'Use the declaration or bounded sample as coverage basis',
    );
    assert.equal(dataset.coverage.complete, false, 'Two rows cannot certify complete coverage of an open family');
    if (dataset.coverage.basis === 'observed') {
        assert.equal(dataset.coverage.sampling.size, 2, 'Retain the two-row sample boundary');
    }
    const ids = (names) => names.map((name) => `$.${name}`);
    const routing = ids(family.routingTupleInOrder);
    const key = ids(family.uniqueRowKeyInOrder);
    assert.ok(
        dataset.identities.some((entry) => entry.kind === 'routing'),
        'No declared routing tuple',
    );
    assert.ok(
        dataset.identities.some((entry) => entry.kind !== 'routing'),
        'No declared row key',
    );
    for (const identity of dataset.identities) {
        assert.deepEqual(identity.fields, identity.kind === 'routing' ? routing : key, 'Wrong ordered native key');
        assert.ok(identity.evidence.includes('family.json'), 'A sample does not declare routing or uniqueness');
        assertFamilyScope(identity, family);
    }
    const fields = new Map(dataset.fields.map((field) => [field.id, field]));
    for (const [name, type] of Object.entries(family.keyTypes)) {
        const field = fields.get(`$.${name}`);
        assert.ok(field?.evidence.includes('family.json'), `Missing declared field ${name}`);
        assert.deepEqual(field.nativeTypes, [type], `Wrong declared native type for ${name}`);
    }
    assertGustObservation(inventory, fields.get('$.gust'), raw);
    assert.ok(!inventory.relationships.length, 'No relationship or foreign key was declared');
    const twinSeal = inventory.semantics.filter(
        (s) =>
            s.datasets.includes(dataset.id) &&
            /twinseal|atomic|partial|all.or.nothing|half|visibility/iu.test(`${s.id} ${s.kind} ${s.description}`),
    );
    assert.ok(twinSeal.length, 'Missing the paired correction obligation');
    for (const obligation of twinSeal) {
        assert.ok(obligation.required && obligation.status === 'unresolved', 'Cannot certify TwinSeal from the export');
        assert.ok(obligation.evidence.includes('requirements.md'), 'The guarantee is required by the engineer');
    }
    for (const workload of manifest.workloadInputs ?? []) {
        assert.ok(
            workload.evidenceKind === 'synthetic' && workload.disposition === 'used',
            'Use synthetic workload as such',
        );
    }
    const result = checkPhaseCompletion(workspace, 'preflight');
    assert.ok(result.complete && result.freshness === 'current', JSON.stringify(result));
}

export async function checkEvidence(workspace, scenario, trajectory) {
    const after = snapshot(workspace);
    if (scenario === 'unfamiliar-preflight') return checkPreflight(workspace, after);
    assert.ok(['resume-code', 'resume-metadata'].includes(scenario), `Unknown evidence scenario: ${scenario}`);
    const code = scenario === 'resume-code';
    const changed = code ? 'orders.ts' : 'catalog.json';
    // Rebuild independently with trusted host code, never a baseline or helper from the graded workspace.
    const baseline = temporaryWorkspace();
    try {
        await writeAcceptedCheckpoint(baseline, skill);
        const expected = snapshot(baseline);
        const revised = fileStamp(join(here, 'revisions', code ? 'orders.ts.txt' : changed));
        assert.notEqual(revised, expected.get(changed), `Missing controlled change to ${changed}`);
        expected.set(changed, revised);
        for (const [file, stamp] of expected) assert.equal(after.get(file), stamp, `Changed or removed: ${file}`);
        for (const file of after.keys()) assert.ok(expected.has(file), `Unexpected file or directory: ${file}`);
    } finally {
        rmSync(baseline, { recursive: true, force: true });
    }
    const preflight = checkPhaseCompletion(workspace, 'preflight');
    assert.ok(!preflight.complete && preflight.freshness === 'stale');
    assert.ok(
        preflight.staleInputs.some((input) => input.path === changed),
        `Expected stale input: ${changed}`,
    );
    const history = checkPhaseCompletion(workspace, 'code-migration');
    assert.equal(history.complete, true, 'Historical execution does not depend on ongoing source freshness');
    assert.equal(history.ready, code, 'Accepted handoff must exempt only the selected code change');
    const text = trajectory?.output ?? '';
    const verdicts = [...text.matchAll(/^Planning handoff:[ \t]*(READY|BLOCKED)[ \t]*\r?$/gimu)].map((m) =>
        m[1].toUpperCase(),
    );
    assert.deepEqual(verdicts, [code ? 'READY' : 'BLOCKED'], 'Missing, ambiguous or incorrect planning verdict');
    assert.ok(text.includes(changed), `Identify the changed evidence: ${changed}`);
}
