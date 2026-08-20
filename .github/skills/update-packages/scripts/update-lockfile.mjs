// Run a standard lockfile-only npm update against the selected registry, then replace metadata for every
// changed registry package with its canonical npmjs tarball URL and integrity. On any failure, restore the
// original lockfile bytes.
//
// Usage:
//   node .github/skills/update-packages/scripts/update-lockfile.mjs [--guard-npm-latest] [package ...]
//
// Environment:
//   FEED_REGISTRY  Registry used by npm update (default: no-auth Microsoft proxy)
//   NPM_REGISTRY   Canonical metadata registry (default: npmjs.org)
//   CONCURRENCY    Parallel npmjs metadata requests (default: 8)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const semver = require('semver');

const LOCK = 'package-lock.json';
const FEED = process.env.FEED_REGISTRY ?? 'https://packagefeedproxy.microsoft.io/npm/';
const NPM = (process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org/').replace(/\/?$/, '/');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);
const NPMJS_HOST = new URL(NPM).host;
const NPM_CLI = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const NPM_COMMAND = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_PREFIX = process.platform === 'win32' ? [NPM_CLI] : [];

if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) {
    throw new Error('CONCURRENCY must be a positive integer');
}
if (process.platform === 'win32' && !fs.existsSync(NPM_CLI)) {
    throw new Error(`npm CLI not found at ${NPM_CLI}`);
}

const args = process.argv.slice(2);
const guardNpmLatest = args.includes('--guard-npm-latest');
const packages = args.filter((arg) => arg !== '--guard-npm-latest');

const originalBytes = fs.readFileSync(LOCK, 'utf8');
const original = JSON.parse(originalBytes);
const packageName = (key) => key.split('node_modules/').pop();

function restoreAndThrow(error) {
    fs.writeFileSync(LOCK, originalBytes);
    throw error;
}

try {
    execFileSync(
        NPM_COMMAND,
        [
            ...NPM_PREFIX,
            'update',
            ...packages,
            '--package-lock-only',
            '--registry',
            FEED,
            '--no-audit',
            '--no-fund',
        ],
        { stdio: 'inherit' },
    );

    const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));

    // npm 12 recalculates flags such as `dev` across the lockfile even when an entry's version did not
    // change. Preserve those entries byte-for-byte at the object level so the resulting diff contains only
    // the dependency tree changes produced by the requested npm update.
    for (const [key, before] of Object.entries(original.packages ?? {})) {
        const after = lock.packages?.[key];
        if (after && after.version === before.version) lock.packages[key] = before;
    }

    const versionChanges = [];
    const registryChanges = [];
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
        const before = original.packages?.[key];
        if (before?.version === entry.version) continue;
        const change = { key, name: packageName(key), current: before?.version, target: entry.version };
        versionChanges.push(change);
        if (typeof entry.resolved === 'string' && /^https?:/.test(entry.resolved)) {
            registryChanges.push(change);
        } else if (guardNpmLatest && semver.valid(entry.version)) {
            throw new Error(`${key}: changed package cannot be checked against npmjs metadata`);
        }
    }
    for (const [key, entry] of Object.entries(original.packages ?? {})) {
        if (!lock.packages?.[key] && entry.version) {
            versionChanges.push({ key, name: packageName(key), current: entry.version, target: undefined });
        }
    }

    const cache = new Map();
    function packument(name) {
        let pending = cache.get(name);
        if (pending) return pending;
        const url = NPM + name.replace('/', '%2F');
        pending = (async () => {
            for (let attempt = 1; ; attempt++) {
                try {
                    const res = await fetch(url, { headers: { accept: 'application/vnd.npm.install-v1+json' } });
                    if (res.ok) return res.json();
                    if (attempt === 3 || (res.status !== 429 && res.status < 500)) {
                        throw new Error(`fetch ${url} -> ${res.status} ${res.statusText}`);
                    }
                } catch (error) {
                    if (attempt === 3) throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, attempt * 500));
            }
        })();
        cache.set(name, pending);
        return pending;
    }

    let next = 0;
    async function worker() {
        while (next < registryChanges.length) {
            const target = registryChanges[next++];
            const metadata = await packument(target.name);
            const versionMetadata = metadata.versions?.[target.target];
            const dist = versionMetadata?.dist;
            if (!dist?.tarball || !dist?.integrity) {
                throw new Error(`${target.name}@${target.target}: canonical npmjs metadata not found`);
            }
            if (guardNpmLatest) {
                const latest = metadata['dist-tags']?.latest;
                if (!semver.valid(target.target) || semver.prerelease(target.target)) {
                    throw new Error(`${target.name}@${target.target}: pre-release selected by the feed`);
                }
                if (!semver.valid(latest) || semver.gt(target.target, latest)) {
                    throw new Error(
                        `${target.name}@${target.target}: feed selection exceeds npmjs latest ${latest ?? '(missing)'}`,
                    );
                }
            }
            lock.packages[target.key].resolved = dist.tarball;
            lock.packages[target.key].integrity = dist.integrity;
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, Math.max(1, registryChanges.length)) }, worker),
    );

    for (const target of registryChanges) {
        const resolved = lock.packages[target.key].resolved;
        if (new URL(resolved).host !== NPMJS_HOST) {
            throw new Error(`${target.key}: canonical resolved URL has unexpected host ${resolved}`);
        }
    }

    fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
    if (versionChanges.length) {
        console.log('\nUpdated packages:');
        for (const { name, current, target } of versionChanges) {
            console.log(`  ${name}: ${current ?? '(new)'} -> ${target ?? '(removed)'}`);
        }
    }
    console.log(
        `Changed ${versionChanges.length} package entries; canonicalized ${registryChanges.length} registry entries` +
            (guardNpmLatest ? ' (guarded by npmjs.org latest tag).' : '.'),
    );
} catch (error) {
    restoreAndThrow(error);
}
