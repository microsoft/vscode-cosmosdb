/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { checkPackages } from './check-package-feed.mjs';

const npm = 'https://registry.npmjs.org/%40example%2Fpkg';
const ms = 'https://packagefeedproxy.microsoft.io/npm/%40example%2Fpkg';
const npmTarball = 'https://registry.npmjs.org/@example/pkg/-/pkg-1.0.0.tgz';
const msTarball = 'https://ms-feed-25.pkgs.visualstudio.com/registry/@example/pkg/-/pkg-1.0.0.tgz';
const archive = Buffer.from('archive bytes');
const hash = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const integrity = hash(archive);
const lock = (overrides = {}) => ({
    lockfileVersion: 3,
    packages: { 'node_modules/@example/pkg': { version: '1.0.0', integrity, ...overrides } },
});
const packument = (dist) => Response.json({ versions: { '1.0.0': { dist } } });

function mockFeed(routes) {
    const calls = [];
    return {
        calls,
        async fetchImpl(url, options) {
            calls.push([url, options.method, options.headers.authorization]);
            return routes.get(url)?.() ?? new Response(null, { status: 404 });
        },
    };
}

test('a missing resolved URL defaults to npm and checks the lockfile integrity in both feeds', async () => {
    const feed = mockFeed(
        new Map([
            [npm, () => packument({ tarball: npmTarball, integrity })],
            [ms, () => packument({ tarball: msTarball, integrity })],
        ]),
    );
    const result = await checkPackages(lock(), 'public', feed);
    assert.deepEqual(result.errors, []);
    assert.equal(result.passed, 1);
    assert.deepEqual(feed.calls, [
        [npm, 'GET', undefined],
        [ms, 'GET', undefined],
    ]);
});

test('rejects a Microsoft feed digest that differs from the public registry and lockfile', async () => {
    const feed = mockFeed(
        new Map([
            [npm, () => packument({ tarball: npmTarball, integrity })],
            [ms, () => packument({ tarball: msTarball, integrity: hash('other archive') })],
        ]),
    );
    const result = await checkPackages(lock({ resolved: npmTarball }), 'public', feed);
    assert.equal(result.passed, 0);
    assert.match(result.errors.join('\n'), /integrity mismatch in MS feed/);
});

test('rejects a public registry digest that differs from the lockfile', async () => {
    const feed = mockFeed(
        new Map([
            [npm, () => packument({ tarball: npmTarball, integrity: hash('other archive') })],
            [ms, () => packument({ tarball: msTarball, integrity })],
        ]),
    );
    const result = await checkPackages(lock(), 'public', feed);
    assert.match(result.errors.join('\n'), /integrity mismatch in npm registry/);
});

test('hashes the Microsoft archive when the packument only has a legacy shasum', async () => {
    const cdn = 'https://test.vsblob.vsassets.io/archive';
    const feed = mockFeed(
        new Map([
            [npm, () => packument({ tarball: npmTarball, integrity })],
            [ms, () => packument({ tarball: msTarball, shasum: 'legacy' })],
            [msTarball, () => Response.redirect(cdn)],
            [cdn, () => new Response(archive)],
        ]),
    );
    assert.deepEqual((await checkPackages(lock(), 'public', feed)).errors, []);
    assert.deepEqual(feed.calls.slice(2), [
        [msTarball, 'GET', undefined],
        [cdn, 'GET', undefined],
    ]);
});

test('rejects incorrect archive bytes when the Microsoft packument has no digest', async () => {
    const feed = mockFeed(
        new Map([
            [npm, () => packument({ tarball: npmTarball, integrity })],
            [ms, () => packument({ tarball: msTarball })],
            [msTarball, () => new Response('other archive')],
        ]),
    );
    const result = await checkPackages(lock(), 'public', feed);
    assert.match(result.errors.join('\n'), /integrity mismatch in MS feed/);
});

test('does not follow a Microsoft tarball redirect outside the feed and its CDN', async () => {
    const feed = mockFeed(
        new Map([
            [npm, () => packument({ tarball: npmTarball, integrity })],
            [ms, () => packument({ tarball: msTarball })],
            [msTarball, () => Response.redirect('https://other.example/archive')],
        ]),
    );
    const result = await checkPackages(lock(), 'public', feed);
    assert.match(result.errors.join('\n'), /unexpected host/);
    assert.equal(feed.calls.length, 3);
});

test('uses an explicitly configured private registry for omitted URLs with path-scoped credentials', async () => {
    const registry = 'https://private.example/npm/';
    const feed = mockFeed(
        new Map([[`${registry}%40example%2Fpkg`, () => packument({ tarball: `${registry}archive`, integrity })]]),
    );
    const config = new Map([['//private.example/npm/:_authToken', 'mock-token']]);
    assert.deepEqual((await checkPackages(lock(), 'private', { ...feed, registry, config })).errors, []);
    assert.deepEqual(feed.calls, [[`${registry}%40example%2Fpkg`, 'GET', 'Bearer mock-token']]);
    assert.match((await checkPackages(lock(), 'private', feed)).errors.join('\n'), /--registry/);
});

test('rejects a public tarball advertised by a private registry even when the integrity matches', async () => {
    const registry = 'https://private.example/npm/';
    const metadata = `${registry}%40example%2Fpkg`;
    const feed = mockFeed(new Map([[metadata, () => packument({ tarball: npmTarball, integrity })]]));
    const result = await checkPackages(lock(), 'private', { ...feed, registry });
    assert.match(result.errors.join('\n'), /private registry: Tarball points to an unexpected host/);
    assert.equal(result.passed, 0);
    assert.deepEqual(feed.calls, [[metadata, 'GET', undefined]]);
});

test('preserves explicit private tarball availability checks and rejects explicit private URLs in public repos', async () => {
    const tarball = 'https://private.example/npm/pkg.tgz';
    const feed = mockFeed(new Map([[tarball, () => new Response()]]));
    assert.deepEqual((await checkPackages(lock({ resolved: tarball }), 'private', feed)).errors, []);
    assert.match(
        (await checkPackages(lock({ resolved: tarball }), 'public', feed)).errors.join('\n'),
        /public repositories/,
    );
    assert.deepEqual(feed.calls, [[tarball, 'HEAD', undefined]]);
});

test('does not treat a malformed explicit resolved URL as omitted', async () => {
    const feed = mockFeed(new Map());
    const result = await checkPackages(lock({ resolved: '' }), 'public', feed);
    assert.match(result.errors.join('\n'), /resolved must be an HTTPS registry tarball URL/);
    assert.deepEqual(feed.calls, []);
});

test('requires a valid lockfile integrity before making requests for an omitted URL', async () => {
    const feed = mockFeed(new Map());
    const result = await checkPackages(lock({ integrity: 'sha512-not-a-digest' }), 'public', feed);
    assert.match(result.errors.join('\n'), /missing or invalid lockfile integrity/);
    assert.deepEqual(feed.calls, []);
});
