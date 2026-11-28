/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { applyEnvironment, loadEvalSpec } from '@microsoft/vally';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { checkPhaseCompletion } from '../../skills/cosmosdb-migration/scripts/check-phase-completion.mjs';
import { buildFreshnessManifest, fileSha256 } from '../../skills/cosmosdb-migration/scripts/freshness.mjs';
import { sourceFilesHash } from '../../skills/cosmosdb-migration/scripts/validate-source-evidence.mjs';
import { writeFixture } from '../../skills/cosmosdb-migration/tests/source-evidence-fixtures.mjs';
import { checkEvidence } from './evidence/check.mjs';
import { writeAcceptedCheckpoint } from './evidence/checkpoint.mjs';
import { assertFreshInventory } from './fresh-inventory.mjs';
import { temporaryWorkspace } from './workspace.mjs';

const here = join(import.meta.dirname, 'evidence');
const skillRoot = resolve(here, '../../../skills/cosmosdb-migration');
const spec = await loadEvalSpec(join(here, 'eval.yaml'));
const stimulus = (scenario) => spec.stimuli.find((entry) => entry.tags.contract === scenario);
const discovery = 'phases/1-discovery/';
const read = (app, name) => JSON.parse(readFileSync(join(app, '.cosmosdb-migration', name)));
const write = (app, name, value) => writeFixture(app, name, JSON.stringify(value));

function workdir(t) {
    const dir = temporaryWorkspace();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

async function stage(t, scenario) {
    const dir = workdir(t);
    await applyEnvironment({ ...spec.environment, ...stimulus(scenario).environment }, dir, here);
    assert.deepEqual(readdirSync(dir).sort(), ['app', 'cosmosdb-best-practices', 'cosmosdb-migration']);
    assert.ok(!existsSync(join(dir, 'cosmosdb-migration/tests')), 'Portable regression answers are not trial inputs');
    return join(dir, 'app');
}

function passedPreflight(app) {
    const files = [
        ['family.json', 'metadata'],
        ['slice.jsonl', 'sample'],
        ['requirements.md', 'documentation'],
    ].map(([path, kind]) => ({
        path,
        kind,
        disposition: 'used',
        sha256: fileSha256(join(app, path)),
        rationale: 'Engineer-provided source evidence',
        provenance: { method: 'handoff', scope: 'weather.pulses' },
    }));
    const sourceSha256 = sourceFilesHash('LoomCell', files);
    const dataset = {
        id: 'pulses',
        name: 'weather.pulses',
        kind: 'other',
        evidence: ['family.json', 'slice.jsonl'],
        coverage: {
            basis: 'observed',
            complete: false,
            scope: 'One station and day',
            sampling: { method: 'supplied row slice', size: 2, limitations: 'Other cell names or types may exist' },
        },
        fields: ['station', 'day', 'ordinal', 'gust'].map((name) => ({
            id: `$.${name}`,
            path: [{ kind: 'property', name }],
            nativeTypes: [name === 'gust' ? 'unknown' : name === 'ordinal' ? 'integer' : 'text'],
            presence: name === 'gust' ? 'optional' : 'required',
            nullable: name === 'gust' ? null : false,
            evidence: [name === 'gust' ? 'slice.jsonl' : 'family.json'],
            ...(name === 'gust' && { sampleObservation: { source: 'slice.jsonl', values: [18], missing: 1 } }),
        })),
        identities: [
            {
                id: 'route',
                kind: 'routing',
                fields: ['$.station', '$.day'],
                scope: 'family routing',
                evidence: ['family.json'],
            },
            {
                id: 'key',
                kind: 'native',
                fields: ['$.station', '$.day', '$.ordinal'],
                scope: 'family row key',
                evidence: ['family.json'],
            },
        ],
    };
    const manifest = {
        version: 1,
        sourceSha256,
        blockingIssues: [],
        workloadInputs: ['volumetrics', 'access-patterns'].map((source) => ({
            source,
            path: 'workload.md',
            sha256: fileSha256(join(app, 'workload.md')),
            disposition: 'used',
            evidenceKind: 'synthetic',
            rationale: 'Engineer planning rates, not measurements',
        })),
        sourceInventory: {
            version: 2,
            source: { engine: 'LoomCell', version: null, namespaces: ['weather'], capabilities: [] },
            files,
            datasets: [dataset],
            relationships: [],
            errors: [],
            semantics: [
                {
                    id: 'TwinSeal',
                    kind: 'atomicity',
                    datasets: ['pulses'],
                    required: true,
                    status: 'unresolved',
                    evidence: ['requirements.md'],
                    description: 'All-or-nothing visibility across two routing tuples',
                },
            ],
        },
    };
    const table = (columns, rows = []) =>
        [columns, columns.map(() => '---'), ...rows].map((row) => `| ${row.join(' | ')} |`).join('\n');
    writeFixture(
        app,
        `${discovery}volumetrics/volumetrics.md`,
        '# Volumetrics\n' +
            table(
                [
                    '#',
                    'Namespace',
                    'Dataset',
                    'Est. Record Count',
                    'Avg Record Size (KB)',
                    'Growth Rate (month)',
                    'Read TPS',
                    'Write TPS',
                    'Notes',
                ],
                [['1', 'weather', 'pulses', '10000', '1', '2%', '12', '3', 'synthetic']],
            ),
    );
    writeFixture(
        app,
        `${discovery}access-patterns/access-patterns.md`,
        '# Access Patterns\n## Read Patterns\n' +
            table(
                [
                    '#',
                    'Pattern Name',
                    'Datasets',
                    'Filter / Lookup Fields',
                    'Frequency (TPS)',
                    'Latency Requirement',
                    'Notes',
                ],
                [['R001', 'Read pulses', 'pulses', 'station, day', '12', '50 ms', 'synthetic']],
            ) +
            '\n## Write Patterns\n' +
            table(
                ['#', 'Pattern Name', 'Datasets', 'Single / Batch', 'Frequency (TPS)', 'Latency Requirement', 'Notes'],
                [['W001', 'Append reading', 'pulses', 'Single', '3', '100 ms', 'synthetic']],
            ),
    );
    writeFixture(
        app,
        `${discovery}preflight-summary.md`,
        '# Preflight\n## Summary\nThe open family is sampled for one day and station.\n## Warnings\n' +
            'Request the producer’s cross-tuple visibility specification for TwinSeal.\n## Decisions\n' +
            'Retain the ordered native key and do not assume that incomplete writes are invisible.\n',
    );
    const project = read(app, 'project.json');
    project.phases.discovery.preflightStatus = 'complete';
    return function commit(variant = manifest) {
        write(app, `${discovery}preflight-manifest.json`, variant);
        project.freshness = { preflight: buildFreshnessManifest(app, project, 'preflight') };
        write(app, 'project.json', project);
        return structuredClone(manifest);
    };
}

test('unfamiliar preflight starts with native inputs only; the grader rejects one changed finding at a time', async (t) => {
    const app = await stage(t, 'unfamiliar-preflight');
    assert.deepEqual(readdirSync(join(app, '.cosmosdb-migration')), ['project.json']);
    assert.equal(checkPhaseCompletion(app, 'preflight').complete, false);
    const commit = passedPreflight(app);
    const original = commit();
    const grade = () => checkEvidence(app, 'unfamiliar-preflight');
    await grade();
    for (const [change, message] of [
        [(i) => i.datasets[0].identities[0].fields.reverse(), /ordered native key/],
        [(i) => i.datasets[0].identities[1].fields.pop(), /ordered native key/],
        [(i) => (i.source.namespaces = ['global']), /declared family namespace/],
        [(i) => (i.datasets[0].identities[0].scope = 'global'), /scope must be the source family/],
        [(i) => (i.datasets[0].identities[1].scope = 'per station in weather.pulses'), /identity scope/],
        [
            (i) =>
                (i.datasets[0].identities[0].scope =
                    'Per station in the weather.pulses wide-column family; no uniqueness claim.'),
            /identity scope/,
        ],
        [(i) => (i.datasets[0].identities[1].scope = 'weather.pulses; no uniqueness claim.'), /identity scope/],
        [(i) => (i.datasets[0].fields[2].nativeTypes = ['number']), /declared native type for ordinal/],
        [(i) => (i.datasets[0].fields[2].evidence = ['slice.jsonl']), /Missing declared field ordinal/],
        [
            (i) => {
                i.datasets[0].coverage.complete = true;
            },
            /complete coverage/,
        ],
        [
            (i) => {
                i.datasets[0].coverage.sampling.size = 100;
            },
            /two-row sample/,
        ],
        [
            (i) => {
                i.datasets[0].fields[3].presence = 'required';
            },
            /sampled/,
        ],
        [(i) => (i.datasets[0].fields[3].nativeTypes = ['integer']), /does not declare a native gust type/],
        [(i) => (i.datasets[0].fields[3].nullable = true), /native nullability/],
        [(i) => delete i.datasets[0].fields[3].sampleObservation, /submitted inventory must attest/],
        [(i) => (i.datasets[0].fields[3].sampleObservation.source = 'family.json'), /observation source/],
        [(i) => (i.datasets[0].fields[3].sampleObservation.values = ['18']), /observed gust JSON values/],
        [(i) => (i.datasets[0].fields[3].sampleObservation.values = [19]), /observed gust JSON values/],
        [(i) => (i.datasets[0].fields[3].sampleObservation.values = [18, 18]), /observed gust JSON values/],
        [(i) => (i.datasets[0].fields[3].sampleObservation.missing = 0), /gust missing count/],
        [
            (i) => {
                i.semantics[0].status = 'known';
            },
            /TwinSeal/,
        ],
        [
            (i) => {
                i.semantics[0].required = false;
            },
            /TwinSeal/,
        ],
        [
            (i) => {
                i.relationships.push({
                    id: 'invented',
                    kind: 'foreign-key',
                    evidence: ['slice.jsonl'],
                    from: { dataset: 'pulses', fields: ['$.station'] },
                    to: { dataset: 'pulses', fields: ['$.day'] },
                });
            },
            /foreign key/,
        ],
    ]) {
        const variant = structuredClone(original);
        change(variant.sourceInventory);
        commit(variant); // Re-sign the changed manifest so the rejection is not simply a stale output digest.
        await assert.rejects(grade, message);
    }
    commit();
    const project = read(app, 'project.json');
    project.phases.discovery.preflightStatus = 'in-progress';
    write(app, 'project.json', project);
    await assert.rejects(grade);
    commit();
    writeFixture(app, `${discovery}discovery-report.md`, '# Premature discovery\n');
    await assert.rejects(grade, /Out-of-phase/);
});

test('unfamiliar declared coverage can attest JSON values and omissions with submitted sample rows', async (t) => {
    const app = await stage(t, 'unfamiliar-preflight');
    const commit = passedPreflight(app);
    const variant = commit();
    const dataset = variant.sourceInventory.datasets[0];
    dataset.coverage = {
        basis: 'declared',
        complete: false,
        scope: 'Native keys only; sampled open cells',
        sampling: null,
    };
    dataset.identities[0].scope = 'Routing tuple for the weather.pulses wide-column family; no uniqueness claim.';
    dataset.identities[1].scope = 'Declared unique row key within the weather.pulses wide-column family.';
    const gust = dataset.fields.find((field) => field.id === '$.gust');
    gust.presence = 'unknown'; // Population-wide constraints remain unknown even though absence was observed.
    delete gust.sampleObservation;
    const sample = variant.sourceInventory.files.find((entry) => entry.path === 'slice.jsonl');
    sample.sampleRows = [
        { station: 'W7', day: '2026-08-04', ordinal: 2 },
        { station: 'W7', day: '2026-08-04', ordinal: 1, gust: 18 },
    ];
    const grade = () => checkEvidence(app, 'unfamiliar-preflight');
    commit(variant);
    await grade();
    sample.sampleRows[0].gust = null; // An explicit null cannot stand in for the omitted cell.
    commit(variant);
    await assert.rejects(grade, /Wrong submitted slice rows/);
    gust.sampleObservation = { source: 'slice.jsonl', values: [18], missing: 1 };
    commit(variant);
    await assert.rejects(grade, /Wrong submitted slice rows/); // Conflicting attestations cannot mask each other.
});

function fileContents(app) {
    return Object.fromEntries(
        readdirSync(app, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => {
                const path = join(entry.parentPath, entry.name);
                return [relative(app, path).split(sep).join('/'), readFileSync(path, 'utf8')];
            }),
    );
}

test('the paired read-only reviews have one differing input each and opposite planning decisions', async (t) => {
    assert.equal(stimulus('resume-code').prompt, stimulus('resume-metadata').prompt);
    const original = workdir(t);
    await writeAcceptedCheckpoint(original, skillRoot);
    const baseline = fileContents(original);
    const conversion = 'phases/3-schema-conversion';
    const model = read(original, `${conversion}/model.json`);
    const [container] = model.containers;
    const summary = baseline[`.cosmosdb-migration/${conversion}/summary.md`];
    const domainSummary = baseline[`.cosmosdb-migration/${conversion}/domains/Orders/summary.md`];
    assert.ok(summary.includes(`${container.name} in ${model.databaseName}`));
    assert.ok(domainSummary.includes(`Route by ${container.partitionKeys[0].path};`));
    const example = JSON.parse(domainSummary.match(/```json\n([\s\S]+?)\n```/u)[1]);
    assert.deepEqual(example, read(original, `${conversion}/manifest.json`).documentMappings[0].examples[0].output);
    assert.match(
        baseline['.cosmosdb-migration/code-migration-plan.md'],
        /displayOrder returned only the tenant label/u,
    );
    const inventory = read(original, `${discovery}preflight-manifest.json`).sourceInventory;
    assert.equal(inventory.version, 2);
    assert.throws(() => assertFreshInventory(inventory), /Fresh field ID/);
    for (const [scenario, file, verdict, wrong] of [
        ['resume-code', 'orders.ts', 'READY', 'BLOCKED'],
        ['resume-metadata', 'catalog.json', 'BLOCKED', 'READY'],
    ]) {
        const app = await stage(t, scenario);
        const now = fileContents(app);
        assert.deepEqual(Object.keys(now).sort(), Object.keys(baseline).sort());
        assert.deepEqual(
            Object.keys(now).filter((name) => now[name] !== baseline[name]),
            [file],
        );
        const grade = (decision) =>
            checkEvidence(app, scenario, { output: `Changed input: ${file}\nPlanning handoff: ${decision}` });
        await grade(verdict); // Opaque IDs and all historical checkpoint bytes remain intact on resume.
        await assert.rejects(() => grade(wrong), /incorrect planning verdict/);
        if (scenario === 'resume-code') {
            write(app, 'code-migration-manifest.json', { ...read(app, 'code-migration-manifest.json'), mode: 'plan' });
            await assert.rejects(() => grade(verdict), /Changed or removed: .*code-migration-manifest.json/);
        } else {
            const project = read(app, 'project.json');
            const stale = project.freshness.preflight.inputs.find((entry) => entry.path === file);
            stale.sha256 = fileSha256(join(app, file));
            write(app, 'project.json', project);
            await assert.rejects(() => grade(verdict), /Changed or removed: .*project.json/);
            writeFileSync(join(app, '.cosmosdb-migration/project.json'), baseline['.cosmosdb-migration/project.json']);
            mkdirSync(join(app, 'repairs'));
            await assert.rejects(() => grade(verdict), /Unexpected file or directory/);
        }
    }
});
