/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { filterStimuli, loadEvalSpec } from '@microsoft/vally';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveEvalSelection } from '../../scripts/eval-options.mjs';
import { checkPhaseCompletions } from '../../skills/cosmosdb-relational-migration/scripts/check-phase-completion.mjs';
import {
    applicationSnapshot,
    checkAdventureWorks,
    checkAdventureWorksInventory,
    checkControllerCoverage,
    checkPlanningBoundary,
    checkPhaseBoundary,
} from './adventureworks/check-artifacts.mjs';
import {
    analyticalPhases,
    checkpointRoot,
    materializePrerequisites,
    phaseOrder,
    prerequisiteStages,
    readCheckpoint,
} from './adventureworks/checkpoints.mjs';
import { fetchSample, verifySample } from './adventureworks/sample.mjs';
import { setupAdventureWorks } from './adventureworks/setup.mjs';

const contract = JSON.parse(readFileSync(new URL('./adventureworks/schema-contract.json', import.meta.url), 'utf8'));
const ddl = fileURLToPath(new URL('./adventureworks/AdventureworksLT.sql', import.meta.url));

function temporary(t) {
    const root = mkdtempSync(join(tmpdir(), 'adventureworks-eval-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

function schemaInventory() {
    return {
        dialect: 'tsql',
        tables: Object.entries(contract).map(([name, value]) => ({
            name,
            identity: name.split('.').map((part) => ({ name: part, quoted: true })),
            columns: value.columns.map((column) => ({ name: column })),
            primaryKey: [...value.primaryKey],
            foreignKeys: structuredClone(value.foreignKeys),
        })),
    };
}

test('pinned checkout is fetched once, reused offline, and never resets modified files', (t) => {
    const root = temporary(t);
    const source = join(root, 'source');
    const cache = join(root, 'cache');
    mkdirSync(source);
    const git = (...args) =>
        execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '--quiet');
    writeFileSync(join(source, 'sample.txt'), 'original');
    git('add', 'sample.txt');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Fixture');
    const revision = git('rev-parse', 'HEAD');
    assert.equal(fetchSample(cache, source, revision), cache);
    rmSync(source, { recursive: true });
    assert.equal(fetchSample(cache, source, revision), cache, 'Cached use must not fetch the now-absent source');
    assert.throws(() => fetchSample(cache, source, '0'.repeat(40)), /pinned commit/);
    writeFileSync(join(cache, 'sample.txt'), 'user edit');
    assert.throws(() => verifySample(cache, revision), /local changes/);
    assert.throws(() => fetchSample(cache, source, revision), /local changes/);
    assert.equal(readFileSync(join(cache, 'sample.txt'), 'utf8'), 'user edit');
});

test('fixture setup copies source and optional DDL without leaking DDL into inference', async (t) => {
    const root = temporary(t);
    const source = join(root, 'source');
    mkdirSync(join(source, '.git'), { recursive: true });
    writeFileSync(join(source, 'model.cs'), 'synthetic source');
    writeFileSync(join(source, 'LICENSE.md'), 'synthetic license');
    const supplied = join(root, 'supplied');
    const inferred = join(root, 'inferred');
    await setupAdventureWorks(supplied, source, ddl);
    await setupAdventureWorks(inferred, source);
    assert.deepEqual(applicationSnapshot(supplied), applicationSnapshot(source));
    assert.deepEqual(applicationSnapshot(inferred), applicationSnapshot(source));
    assert.equal(existsSync(join(supplied, '.git')), false);
    assert.deepEqual(
        readFileSync(join(supplied, '.cosmosdb-migration/phases/1-discovery/schema-ddl/AdventureworksLT.sql')),
        readFileSync(ddl),
    );
    assert.equal(existsSync(join(inferred, '.cosmosdb-migration/phases/1-discovery/schema-ddl')), false);
    await assert.rejects(setupAdventureWorks(supplied, source, ddl), /overwrite/);
    writeFileSync(join(supplied, '.cosmosdb-migration/phases/1-discovery/volumetrics/workload.json'), '{}');
    assert.throws(() => checkAdventureWorks(supplied, 'supplied-ddl', source), /workload evidence changed/);
});

function fixtureSource(root) {
    const source = join(root, 'sample');
    mkdirSync(source);
    // These placeholders exercise materialization/path contracts, not live application interpretation.
    for (const stage of analyticalPhases) {
        for (const path of readCheckpoint(stage).consulted.filter((path) => !path.startsWith('.cosmosdb-migration/'))) {
            const file = join(source, path);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, `Synthetic offline source for ${path}\n`);
        }
    }
    return source;
}

for (const phase of phaseOrder) {
    test(`${phase}: only validated predecessors are staged; current outputs are absent`, async (t) => {
        const root = temporary(t);
        const sample = fixtureSource(root);
        const app = join(root, 'app');
        await setupAdventureWorks(app, sample, ddl, phase);
        const results = checkPhaseCompletions(app, [...prerequisiteStages(phase), phase]);
        for (const predecessor of prerequisiteStages(phase)) assert.equal(results[predecessor].complete, true);
        assert.equal(results[phase].complete, false);
        const projectPath = join(app, '.cosmosdb-migration/project.json');
        const project = JSON.parse(readFileSync(projectPath, 'utf8'));
        checkPhaseBoundary(app, phase, project);
        assert.throws(() => checkAdventureWorks(app, phase, sample));
        if (analyticalPhases.includes(phase)) {
            await materializePrerequisites(app, phaseOrder[phaseOrder.indexOf(phase) + 1]);
            checkAdventureWorks(app, phase, sample);
        }
    });
}

test('isolated grading rejects predecessor mutations and future-phase artifacts', async (t) => {
    const root = temporary(t);
    const sample = fixtureSource(root);
    const app = join(root, 'app');
    await setupAdventureWorks(app, sample, ddl, 'provisioning');
    const migration = join(app, '.cosmosdb-migration');
    const project = JSON.parse(readFileSync(join(migration, 'project.json'), 'utf8'));
    checkPhaseBoundary(app, 'provisioning', project);
    writeFileSync(join(migration, 'code-migration-plan.md'), 'Premature plan');
    assert.throws(() => checkPhaseBoundary(app, 'provisioning', project), /Out-of-phase artifact/);
    rmSync(join(migration, 'code-migration-plan.md'));
    project.phases.assessment.domains[0].isMapped = false;
    assert.throws(() => checkPhaseBoundary(app, 'provisioning', project), /predecessor phase state/);
    project.phases.assessment.domains[0].isMapped = true;
    writeFileSync(join(migration, 'phases/3-schema-conversion/summary.md'), 'Changed accepted design');
    assert.throws(() => checkPhaseBoundary(app, 'provisioning', project), /predecessor artifact/);
});

test('checkpoint drift fails before an agent can use it', async (t) => {
    const root = temporary(t);
    const fixtures = join(root, 'fixtures');
    cpSync(join(checkpointRoot, 'preflight'), join(fixtures, 'preflight'), { recursive: true });
    writeFileSync(join(fixtures, 'preflight/phases/1-discovery/preflight-summary.md'), 'Unreviewed edit');
    assert.throws(() => readCheckpoint('preflight', fixtures), /changed without review/);
    const sample = fixtureSource(root);
    const app = join(root, 'app');
    await setupAdventureWorks(app, sample, ddl);
    writeFileSync(join(app, '.cosmosdb-migration/phases/1-discovery/schema-ddl/AdventureworksLT.sql'), 'changed DDL');
    await assert.rejects(materializePrerequisites(app, 'discovery'), /DDL differs/);
});

test('integration is opt-in and each extended phase has a separate session and budget', async () => {
    const phases = await loadEvalSpec(fileURLToPath(new URL('./adventureworks/eval.yaml', import.meta.url)));
    const integration = await loadEvalSpec(
        fileURLToPath(new URL('./adventureworks/integration/eval.yaml', import.meta.url)),
    );
    const count = (spec, args) =>
        filterStimuli(spec.stimuli, spec.tags, resolveEvalSelection(args).filter).matched.length;
    assert.equal(count(phases, []), 7);
    assert.equal(count(integration, []), 0);
    assert.equal(count(integration, ['--tag', 'sample=adventureworks']), 0);
    assert.equal(count(integration, ['--tag', 'category!=extended']), 0);
    assert.equal(count(integration, ['--tag=category=integration']), 1);
    assert.equal(count(phases, ['--tag', 'category=integration']), 0);
    assert.equal(count(phases, ['--tag', 'phase=provisioning']), 1);
    for (const phase of phaseOrder) {
        const stimulus = phases.stimuli.find((entry) => entry.tags.phase === phase);
        assert.equal(stimulus.turns, undefined, 'Independent phases must not share conversation history');
        assert.equal(
            stimulus.constraints?.max_duration ?? phases.defaults.timeout,
            phase === 'schema-conversion' ? '45m' : '20m',
        );
        const staged = (stimulus.environment?.files ?? []).filter(({ src }) => src.startsWith('checkpoints/'));
        assert.deepEqual(
            staged.map(({ src }) => src.slice('checkpoints/'.length)),
            prerequisiteStages(phase),
        );
    }
});

test('independent inventory checks accept quoted references and reject lost relational structure', () => {
    const inventory = schemaInventory();
    for (const table of inventory.tables) {
        for (const key of table.foreignKeys)
            key.referencedTable = key.referencedTable
                .split('.')
                .map((part) => `[${part}]`)
                .join('.');
    }
    checkAdventureWorksInventory(inventory);
    for (const mutate of [
        (value) => value.tables.pop(),
        (value) => value.tables.find(({ name }) => name === 'SalesLT.Product').columns.pop(),
        (value) => value.tables.find(({ name }) => name === 'SalesLT.CustomerAddress').primaryKey.reverse(),
        (value) => value.tables.find(({ name }) => name === 'SalesLT.ProductCategory').foreignKeys.splice(0),
        (value) => {
            value.tables.find(({ name }) => name === 'SalesLT.SalesOrderHeader').foreignKeys[0].columns = [
                'ShipToAddressID',
            ];
        },
    ]) {
        const changed = structuredClone(inventory);
        mutate(changed);
        assert.throws(() => checkAdventureWorksInventory(changed));
    }
});

test('controller coverage requires code-evidenced reads and writes from each CRUD controller', () => {
    const patterns = ['Customers', 'Products', 'ProductCategories'].flatMap((controller) =>
        ['read', 'write'].map((kind) => ({
            kind,
            evidence: 'code',
            sourcePaths: [`Controllers/${controller}Controller.cs`],
        })),
    );
    checkControllerCoverage({ patterns });
    checkControllerCoverage({
        patterns: patterns.map((pattern) => ({
            ...pattern,
            sourcePaths: pattern.sourcePaths.map((path) => `./${path}#L24`),
        })),
    });
    assert.throws(() => checkControllerCoverage({ patterns: patterns.slice(1) }), /CustomersController/);
    assert.throws(
        () => checkControllerCoverage({ patterns: patterns.map((pattern) => ({ ...pattern, kind: 'read' })) }),
        /write evidence/,
    );
    assert.throws(
        () =>
            checkControllerCoverage({
                patterns: patterns.map((pattern) => ({ ...pattern, evidence: 'schema-inferred' })),
            }),
        /read evidence/,
    );
});

test('planning checks reject fabricated deployment and application-execution success', () => {
    const project = { phases: { provisioning: { status: 'in-progress' }, targetEnvironment: { verified: false } } };
    const plan = { mode: 'plan', outputFiles: [], validation: [] };
    checkPlanningBoundary(project, plan);
    assert.throws(() => checkPlanningBoundary(project, { ...plan, mode: 'migrate' }), /does not authorize/);
    assert.throws(
        () => checkPlanningBoundary(project, { ...plan, outputFiles: [{ path: 'Program.cs' }] }),
        /application outputs/,
    );
    assert.throws(() => checkPlanningBoundary(project, plan, { verification: {} }), /fabricate cloud/);
    assert.throws(
        () => checkPlanningBoundary(project, { ...plan, validation: [{ status: 'passed', checks: ['build'] }] }),
        /not built/,
    );
    assert.throws(
        () => checkPlanningBoundary({ phases: { provisioning: { status: 'complete' } } }, plan),
        /incomplete/,
    );
    assert.throws(
        () => checkPlanningBoundary({ phases: { targetEnvironment: { verified: true } } }, plan),
        /not a verified target/,
    );
});

test('real artifact checker rejects missing evidence and byte changes to application files', (t) => {
    const root = temporary(t);
    const source = join(root, 'source');
    const app = join(root, 'app');
    mkdirSync(source);
    writeFileSync(join(source, 'asset.bin'), Buffer.from([255]));
    cpSync(source, app, { recursive: true });
    assert.throws(() => checkAdventureWorks(app, 'supplied-ddl', source), /ENOENT/);
    writeFileSync(join(app, 'asset.bin'), Buffer.from([254]));
    assert.throws(() => checkAdventureWorks(app, 'supplied-ddl', source), /Application source changed/);
});

test(
    'filtered small-suite runs do not invoke Git to prepare AdventureWorks',
    { skip: process.platform === 'win32' },
    (t) => {
        const root = temporary(t);
        writeFileSync(join(root, 'git'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
        const result = spawnSync(process.execPath, ['scripts/eval.mjs', '--tag', 'category=guidance', '--help'], {
            cwd: fileURLToPath(new URL('../../', import.meta.url)),
            env: { ...process.env, PATH: `${root}:${process.env.PATH}`, VALLY_TELEMETRY_OPTOUT: '1' },
            encoding: 'utf8',
            timeout: 30_000,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Run stimuli against an agent/);
    },
);
