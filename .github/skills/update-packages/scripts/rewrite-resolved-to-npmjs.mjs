// Rewrite every `resolved`/`integrity` this run introduced to the canonical npmjs.org tarball.
//
// `npm update --package-lock-only --registry <feed>` writes the FEED's tarball host into every
// changed `resolved` (e.g. *.pkgs.visualstudio.com). This helper replaces those with the
// npmjs.org tarball URL and npmjs `dist.integrity`, so the committed lockfile stays canonical
// and reproducible. It only touches entries THIS run changed — a `resolved` that is byte-identical
// to `HEAD:package-lock.json` is pre-existing and left alone (its integrity was computed from the
// feed tarball, so rewriting only the host would break `npm ci`).
//
// Usage: node .github/skills/update-packages/scripts/rewrite-resolved-to-npmjs.mjs
// Env:   NPM_REGISTRY (default https://registry.npmjs.org/), CONCURRENCY (default 12)

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const LOCK = 'package-lock.json';
const NPM = (process.env.NPM_REGISTRY || 'https://registry.npmjs.org/').replace(/\/?$/, '/');
const CONCURRENCY = Number(process.env.CONCURRENCY || 12);
const NPMJS_HOST = 'registry.npmjs.org';

const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));

// Baseline lockfile from HEAD, to tell apart entries this run changed from pre-existing ones.
let head = { packages: {} };
try {
    head = JSON.parse(execFileSync('git', ['show', 'HEAD:' + LOCK], { encoding: 'utf8', maxBuffer: 1 << 30 }));
} catch {
    console.warn('warning: could not read HEAD:package-lock.json — treating every entry as changed');
}

const pkgName = (key) => key.split('node_modules/').pop();

// Entries whose resolved points somewhere other than npmjs AND that differ from HEAD.
const targets = [];
for (const [key, entry] of Object.entries(lock.packages)) {
    if (!entry || typeof entry.resolved !== 'string') continue;
    if (entry.resolved.includes(NPMJS_HOST)) continue;
    const headEntry = head.packages[key];
    if (headEntry && headEntry.resolved === entry.resolved) continue; // pre-existing, out of scope
    targets.push({ key, name: pkgName(key), version: entry.version });
}

console.log(`Entries to rewrite: ${targets.length}`);
if (targets.length === 0) process.exit(0);

const cache = new Map();
function packument(name) {
    if (cache.has(name)) return cache.get(name);
    const p = fetch(NPM + name.replace('/', '%2f'), {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
    }).then((r) => {
        if (!r.ok) throw new Error(`fetch ${name} -> ${r.status}`);
        return r.json();
    });
    cache.set(name, p);
    return p;
}

let idx = 0;
let changed = 0;
const failures = [];

async function worker() {
    while (idx < targets.length) {
        const t = targets[idx++];
        try {
            const doc = await packument(t.name);
            const v = doc.versions && doc.versions[t.version];
            if (!v || !v.dist || !v.dist.tarball || !v.dist.integrity) {
                failures.push(`${t.name}@${t.version}: not found on npmjs`);
                continue;
            }
            const entry = lock.packages[t.key];
            entry.resolved = v.dist.tarball;
            entry.integrity = v.dist.integrity;
            changed++;
        } catch (e) {
            failures.push(`${t.name}@${t.version}: ${e.message}`);
        }
    }
}

await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));

if (failures.length) {
    console.error('FAILURES:\n' + failures.join('\n'));
    process.exit(1);
}

fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
console.log(`Rewrote ${changed} entries to npmjs resolved/integrity.`);
