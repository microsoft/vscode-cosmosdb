/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    applicationSnapshot,
    checkAdventureWorks,
    checkAdventureWorksInventory,
    checkControllerCoverage,
    checkPlanningBoundary,
} from './adventureworks/check-artifacts.mjs';
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

test('fixture setup copies source and optional DDL without leaking DDL into inference', (t) => {
    const root = temporary(t);
    const source = join(root, 'source');
    mkdirSync(join(source, '.git'), { recursive: true });
    writeFileSync(join(source, 'model.cs'), 'synthetic source');
    writeFileSync(join(source, 'LICENSE.md'), 'synthetic license');
    const supplied = join(root, 'supplied');
    const inferred = join(root, 'inferred');
    setupAdventureWorks(supplied, source, ddl);
    setupAdventureWorks(inferred, source);
    assert.deepEqual(applicationSnapshot(supplied), applicationSnapshot(source));
    assert.deepEqual(applicationSnapshot(inferred), applicationSnapshot(source));
    assert.equal(existsSync(join(supplied, '.git')), false);
    assert.deepEqual(
        readFileSync(join(supplied, '.cosmosdb-migration/phases/1-discovery/schema-ddl/AdventureworksLT.sql')),
        readFileSync(ddl),
    );
    assert.equal(existsSync(join(inferred, '.cosmosdb-migration/phases/1-discovery/schema-ddl')), false);
    assert.throws(() => setupAdventureWorks(supplied, source, ddl), /overwrite/);
    writeFileSync(join(supplied, '.cosmosdb-migration/phases/1-discovery/volumetrics/workload.json'), '{}');
    assert.throws(() => checkAdventureWorks(supplied, 'supplied-ddl', source), /workload evidence changed/);
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
