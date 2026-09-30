// Sync node_modules to package-lock.json with an INCREMENTAL `npm install`, working around the
// EALLOWREMOTE trap that a pre-existing feed `resolved` URL triggers when its package must be fetched.
//
// Why this exists:
//   The skill's Phase A (sync a drifted tree before selecting) and Phase E (reify after the bump) both
//   need `npm install` to run. But a user config with `replace-registry-host=npmjs` makes npm REFUSE any
//   `resolved` that points at a feed host it must download ("EALLOWREMOTE"). A lockfile can legitimately
//   carry such a pre-existing feed URL (e.g. @azure/arm-features) that we must NOT rewrite in the commit.
//   When that package is already installed, `npm install` never fetches it and all is well; when it is
//   missing (a fresh/wiped tree), the install aborts. Doing the fix by hand is a three-step dance repeated
//   every run — this script does it deterministically:
//     1. Snapshot the exact lockfile bytes.
//     2. Temp-patch every NON-npmjs `resolved`/`integrity` to the canonical npmjs tarball (so npm can
//        fetch it without EALLOWREMOTE), in a throwaway copy of the lockfile.
//     3. Run an incremental `npm install` (never `npm ci` — see the skill).
//     4. Restore the original lockfile bytes verbatim, so the committed diff is untouched.
//   The installed bytes for those few packages come from npmjs (same version, canonical tarball), which is
//   exactly what we want to build against; only the lockfile's `resolved` host stays as it was.
//
// Usage: node .github/skills/update-packages/scripts/sync-tree.mjs
// Env:   NPM_REGISTRY (default https://registry.npmjs.org/), CONCURRENCY (default 8)

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const LOCK = 'package-lock.json';
const NPM = (process.env.NPM_REGISTRY || 'https://registry.npmjs.org/').replace(/\/?$/, '/');
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const NPMJS_HOST = new URL(NPM).host;
const NPM_CLI = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const NPM_COMMAND = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_PREFIX = process.platform === 'win32' ? [NPM_CLI] : [];

if (process.platform === 'win32' && !fs.existsSync(NPM_CLI)) {
    throw new Error(`npm CLI not found at ${NPM_CLI}`);
}

const originalBytes = fs.readFileSync(LOCK, 'utf8');
const lock = JSON.parse(originalBytes);

// Every entry whose resolved points at a non-npmjs (feed) host — these are the EALLOWREMOTE risks.
const pkgName = (key) => key.split('node_modules/').pop();
const targets = [];
for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry || typeof entry.resolved !== 'string') continue;
    if (!/^https?:/.test(entry.resolved)) continue; // skip file:/link:/git: specs
    if (new URL(entry.resolved).host === NPMJS_HOST) continue;
    targets.push({ key, name: pkgName(key), version: entry.version });
}

const cache = new Map();
function packument(name) {
    if (cache.has(name)) return cache.get(name);
    const p = (async () => {
        const url = NPM + encodeURIComponent(name);
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
    cache.set(name, p);
    return p;
}

if (targets.length) {
    console.log(`Temp-patching ${targets.length} pre-existing feed URL(s) to npmjs for the install…`);
    let idx = 0;
    const skipped = [];
    async function worker() {
        while (idx < targets.length) {
            const t = targets[idx++];
            try {
                const doc = await packument(t.name);
                const v = doc.versions && doc.versions[t.version];
                if (!v?.dist?.tarball || !v?.dist?.integrity) {
                    skipped.push(`${t.name}@${t.version}: not on npmjs — left as-is (install may still fail)`);
                    continue;
                }
                lock.packages[t.key].resolved = v.dist.tarball;
                lock.packages[t.key].integrity = v.dist.integrity;
            } catch (e) {
                skipped.push(`${t.name}@${t.version}: ${e.message} — left as-is`);
            }
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
    if (skipped.length) console.warn('WARN:\n  ' + skipped.join('\n  '));
    fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
}

let installErr;
try {
    console.log('Running incremental `npm install`…');
    execFileSync(
        NPM_COMMAND,
        [...NPM_PREFIX, 'install', '--registry', NPM, '--no-audit', '--no-fund'],
        { stdio: 'inherit' },
    );
} catch (e) {
    installErr = e;
} finally {
    // Always restore the original lockfile bytes verbatim, so the committed diff is never disturbed.
    fs.writeFileSync(LOCK, originalBytes);
    console.log('Restored package-lock.json to its original bytes.');
}

if (installErr) {
    console.error('npm install failed:', installErr.message);
    process.exit(1);
}
console.log('node_modules synced to the lockfile.');
