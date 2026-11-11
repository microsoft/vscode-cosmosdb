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
import { checkCodaFreshness, formatFreshness, main } from './check-coda-freshness.mjs';

function git(directory, ...args) {
    const result = spawnSync('git', ['--no-pager', '-C', directory, '-c', 'core.hooksPath=', ...args], {
        encoding: 'utf8',
        windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
}

function commit(source, message) {
    git(
        source,
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
        message,
    );
    return git(source, 'rev-parse', 'HEAD');
}

function fixture(t) {
    const directory = mkdtempSync(path.join(tmpdir(), 'coda-freshness-test-'));
    const source = path.join(directory, 'source');
    const temporaryRoot = path.join(directory, 'scratch');
    mkdirSync(source);
    mkdirSync(temporaryRoot);
    t.after(() => {
        try {
            assert.deepEqual(readdirSync(temporaryRoot), [], 'Every temporary graph must be cleaned up.');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
    git(source, 'init', '--quiet', '--initial-branch=main');
    const pin = {
        repo: source,
        trackingRef: 'refs/heads/main',
        commit: commit(source, 'initial'),
        featurePath: 'specs/detectors',
    };
    const options = { temporaryRoot, token: '' };
    return { source, pin, options };
}

test('equal HEAD passes without changing the configured pin, repository or cached source', (t) => {
    const { source, pin, options } = fixture(t);
    const original = JSON.stringify(pin);
    writeFileSync(path.join(source, 'local-cache-sentinel'), 'keep local work');
    const status = git(source, 'status', '--porcelain');
    assert.deepEqual(checkCodaFreshness(pin, options), {
        pin: pin.commit,
        head: pin.commit,
        ref: pin.trackingRef,
        ahead: 0,
        behind: 0,
        relationship: 'equal',
    });
    assert.equal(JSON.stringify(pin), original);
    assert.equal(git(source, 'status', '--porcelain'), status);
    assert.equal(readFileSync(path.join(source, 'local-cache-sentinel'), 'utf8'), 'keep local work');
});

test('counts every upstream-only commit, not a shallow fetch depth', (t) => {
    const { source, pin, options } = fixture(t);
    commit(source, 'next');
    const head = commit(source, 'latest');
    const result = checkCodaFreshness(pin, options);
    assert.deepEqual(result, {
        pin: pin.commit,
        head,
        ref: pin.trackingRef,
        ahead: 2,
        behind: 0,
        relationship: 'ahead',
    });
    assert.match(formatFreshness(result), /2 commits ahead.*0 commits behind/);
});

test('reports an upstream branch behind the pinned commit', (t) => {
    const { source, pin, options } = fixture(t);
    git(source, 'checkout', '--quiet', '-b', 'future-pin');
    commit(source, 'newer');
    const future = commit(source, 'newest');
    const result = checkCodaFreshness({ ...pin, commit: future }, options);
    assert.equal(result.relationship, 'behind');
    assert.equal(result.ahead, 0);
    assert.equal(result.behind, 2);
});

test('distinguishes divergent branches and reports both exact counts', (t) => {
    const { source, pin, options } = fixture(t);
    git(source, 'checkout', '--quiet', '-b', 'pin-side');
    const pinned = commit(source, 'pin-only');
    git(source, 'checkout', '--quiet', 'main');
    commit(source, 'upstream-only-1');
    commit(source, 'upstream-only-2');
    const result = checkCodaFreshness({ ...pin, commit: pinned }, options);
    assert.equal(result.relationship, 'diverged');
    assert.equal(result.ahead, 2);
    assert.equal(result.behind, 1);
});

test('does not describe unrelated histories as an ordinary ahead update', (t) => {
    const { source, pin, options } = fixture(t);
    git(source, 'checkout', '--quiet', '--orphan', 'replacement');
    const head = commit(source, 'new root');
    const result = checkCodaFreshness({ ...pin, trackingRef: 'refs/heads/replacement' }, options);
    assert.equal(result.head, head);
    assert.equal(result.relationship, 'unrelated');
    assert.equal(result.ahead, 1);
    assert.equal(result.behind, 1);
});

test('missing refs and unavailable pinned objects fail rather than passing or repinning', (t) => {
    const { pin, options } = fixture(t);
    assert.throws(() => checkCodaFreshness({ ...pin, trackingRef: 'refs/heads/missing' }, options), /operation failed/);
    assert.throws(() => checkCodaFreshness({ ...pin, commit: 'f'.repeat(40) }, options), /operation failed/);
    assert.throws(
        () => checkCodaFreshness({ ...pin, repo: path.join(pin.repo, 'missing-repository') }, options),
        /operation failed/,
    );
});

test('credentials are absent from public reports and local repository configuration', (t) => {
    const { source, pin, options } = fixture(t);
    commit(source, 'upstream');
    const token = 'synthetic-sensitive-value';
    const result = checkCodaFreshness(pin, { ...options, token });
    assert.doesNotMatch(formatFreshness(result), /synthetic-sensitive-value|Authorization|Basic/);
    assert.doesNotMatch(
        readFileSync(path.join(source, '.git', 'config'), 'utf8'),
        /synthetic-sensitive-value|extraheader/,
    );
});

test('command returns nonzero on mismatch and zero only on equality', (t) => {
    const { source, pin } = fixture(t);
    t.mock.method(console, 'log', () => {});
    assert.equal(main([], pin, {}), 0);
    commit(source, 'upstream');
    assert.equal(main([], pin, {}), 1);
    assert.throws(() => main(['--repin'], pin), /Usage/);
});

test('hosted freshness is independent and private credentials are withheld from every PR', () => {
    const workflow = readFileSync(new URL('../.github/workflows/package-feed.yml', import.meta.url), 'utf8');
    const job = workflow.split('\n  coda-freshness:\n')[1];
    assert.ok(job, 'The checker must have its own sibling job.');
    assert.match(workflow, /\n  package-feed:\n/);
    assert.doesNotMatch(job, /^\s+(?:needs|continue-on-error|strategy):/m);
    assert.match(job, /persist-credentials: false/);
    assert.match(job, /github\.event_name != 'pull_request' && secrets\.CODA_READ_TOKEN/);
    assert.match(job, /run: npm run coda:check/);
    assert.doesNotMatch(job, /pull_request_target|npm ci|test:coda|upload-artifact/);
});
