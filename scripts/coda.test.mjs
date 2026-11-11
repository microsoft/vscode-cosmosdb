/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fetchCoda, parseArguments, readCodaPin } from './coda.mjs';

const pin = {
    repo: 'https://example.test/team/_git/contract',
    trackingRef: 'refs/heads/main',
    commit: 'a'.repeat(40),
    featurePath: 'specs/detectors',
};

test('requires immutable pin metadata without credentials or traversable paths', () => {
    assert.deepEqual(readCodaPin({ externalSpecifications: { coda: pin } }), pin);
    for (const change of [
        { commit: 'main' },
        { commit: 'abc123' },
        { featurePath: '../private' },
        { featurePath: 'specs\\detectors' },
        { repo: 'https://token@example.test/repo' },
        { repo: 'https://example.test/repo?token=secret' },
        { repo: 'file:///local' },
        { trackingRef: 'HEAD' },
    ]) {
        assert.throws(() => readCodaPin({ externalSpecifications: { coda: { ...pin, ...change } } }), /Invalid/);
    }
});

test('defaults to all features and requires explicit valid subset selection', () => {
    assert.deepEqual(parseArguments(['test']), { command: 'test', detectors: undefined });
    assert.deepEqual(parseArguments(['test', '--detectors', 'DX-001,DX-011']), {
        command: 'test',
        detectors: ['DX-001', 'DX-011'],
    });
    for (const args of [
        [],
        ['fetch', '--detectors', 'DX-001'],
        ['test', '--unknown'],
        ['test', '--detectors', ''],
        ['test', '--detectors', 'DX-001,DX-001'],
        ['test', '--detectors', 'DX-1'],
    ]) {
        assert.throws(() => parseArguments(args));
    }
});

function git(directory, args) {
    const result = spawnSync('git', ['--no-pager', '-C', directory, '-c', 'core.hooksPath=', ...args], {
        encoding: 'utf8',
        windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
}

function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'coda-fetch-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'source');
    const cache = path.join(directory, 'cache');
    mkdirSync(path.join(source, 'specs', 'detectors'), { recursive: true });
    git(source, ['init', '--quiet']);
    git(source, ['config', 'core.autocrlf', 'false']);
    const feature = 'Feature: Synthetic fetch fixture\n  Scenario: Initial snapshot\n    Given a fixture\n';
    writeFileSync(path.join(source, 'specs', 'detectors', 'dx900_fixture.feature'), feature);
    writeFileSync(path.join(source, '.gitignore'), 'ignored.feature\n');
    git(source, ['add', '.']);
    git(source, [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'fixture',
    ]);
    return { source, cache, feature, config: { ...pin, repo: source, commit: git(source, ['rev-parse', 'HEAD']) } };
}

test('fetches the exact commit instead of source HEAD and reuses a verified checkout', (t) => {
    const { source, cache, feature, config } = fixture(t);
    writeFileSync(path.join(source, 'specs', 'detectors', 'dx900_fixture.feature'), 'changed upstream\n');
    git(source, ['add', '.']);
    git(source, [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'newer',
    ]);
    const downloaded = fetchCoda(config, cache);
    assert.equal(readFileSync(path.join(downloaded, 'dx900_fixture.feature'), 'utf8'), feature);
    assert.equal(git(path.join(downloaded, '..', '..'), ['rev-parse', 'HEAD']), config.commit);
    assert.equal(fetchCoda(config, cache), downloaded);
    assert.equal(readdirSync(cache).length, 1);
});

test('a failed fetch leaves the previous pin intact and removes only its staging directory', (t) => {
    const { cache, config, feature } = fixture(t);
    const previous = fetchCoda(config, cache);
    assert.throws(() => fetchCoda({ ...config, commit: 'b'.repeat(40) }, cache), /Git operation failed/);
    assert.equal(readFileSync(path.join(previous, 'dx900_fixture.feature'), 'utf8'), feature);
    assert.equal(readdirSync(cache).length, 1);
});

test('rejects dirty caches without resetting or replacing local modifications', (t) => {
    const { cache, config } = fixture(t);
    const features = fetchCoda(config, cache);
    const file = path.join(features, 'dx900_fixture.feature');
    writeFileSync(file, 'local modification\n');
    assert.throws(() => fetchCoda(config, cache), /local changes/);
    assert.equal(readFileSync(file, 'utf8'), 'local modification\n');
});

test('rejects injected ignored feature files as well as tracked modifications', (t) => {
    const { cache, config } = fixture(t);
    const features = fetchCoda(config, cache);
    writeFileSync(path.join(features, 'ignored.feature'), 'injected\n');
    assert.throws(() => fetchCoda(config, cache), /local changes/);
});

test('rejects substituted cache origins and commits', (t) => {
    const { cache, config } = fixture(t);
    const features = fetchCoda(config, cache);
    const checkout = path.join(features, '..', '..');
    git(checkout, ['remote', 'set-url', 'origin', 'https://example.test/other']);
    assert.throws(() => fetchCoda(config, cache), /origin does not match/);
    git(checkout, ['remote', 'set-url', 'origin', config.repo]);
    git(checkout, [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '--allow-empty',
        '-m',
        'substitution',
    ]);
    assert.throws(() => fetchCoda(config, cache), /HEAD does not match/);
});
