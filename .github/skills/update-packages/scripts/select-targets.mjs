// Select safe target versions for dependency bumps — like `npm update`, but constrained to versions the
// Microsoft package feed actually serves, and guarded against pre-release/beta jumps.
//
// How it works:
//   1. Run `npm outdated --all --json` against the MICROSOFT FEED. npm does the real resolution — it
//      respects every declared range (direct deps' package.json ranges and transitive deps' parent
//      ranges) and reports `wanted` per install location. Because the query runs against the feed,
//      `wanted` is automatically limited to versions the feed serves (i.e. past the ~7-day quarantine),
//      so it can never propose something CI cannot install.
//   2. For each package's HOISTED (top-level) install, the target is the MINIMUM `wanted` across every
//      dependent that shares that install — a single hoisted copy must satisfy all of them, so the most
//      constrained dependent wins. (This is what stops false bumps such as an aliased `typescript`, where
//      some dependents allow a newer major but others pin the current one.)
//   3. The CURRENT version is read from package-lock.json (the committed source of truth), not from
//      `node_modules`, so the report is correct even if the installed tree has drifted.
//   4. Apply the npmjs.org `latest` dist-tag guard: the feed ignores dist-tags, so its highest version
//      may be one npmjs still keeps off `latest` (a beta / `next`). If the target would exceed npmjs'
//      `latest`, or is itself a pre-release, do NOT auto-bump — flag it for manual review.
//   5. Feed-availability pass: the steps above only catch versions the feed serves NEWER than the
//      lockfile. They are blind to the opposite hazard — a lockfile pinned to a version the feed does NOT
//      serve (e.g. a bump installed straight from npmjs before it cleared the feed's ~7-day quarantine),
//      which CI restoring from the feed cannot resolve. For every DIRECT dependency we check the pinned
//      version against the feed and, when it is missing, propose the highest feed version that still
//      satisfies the declared range (a downgrade).
//
// Registry metadata (a package's versions and its `latest` dist-tag) is read with a single HTTPS
// `fetch` of the abbreviated packument (`application/vnd.npm.install-v1+json`) per package+registry,
// cached and shared across both passes. This replaces per-package `npm view` subprocesses (each of which
// paid full npm/Node start-up cost on top of the network round-trip), and returns versions AND dist-tags
// in one request — dramatically fewer, faster calls on large trees. When FEED_REGISTRY is an authenticated
// feed (e.g. Azure Artifacts / PowerBI), the feed requests carry an Authorization header derived from the
// token vsts-npm-auth writes to .npmrc, so the feed-availability pass works against private feeds too.
//
// It never mutates anything. It prints a human-readable table plus a machine-readable JSON block
// (delimited by BEGIN_JSON / END_JSON) that the agent can act on. For accurate results the installed
// tree should match the lockfile — run `npm ci` first if unsure.
//
// Usage:
//   node .github/skills/update-packages/scripts/select-targets.mjs [pkg ...]
//     - no arguments  -> every outdated top-level package
//     - with names    -> restrict the report to those packages
//
// Optional environment overrides:
//   FEED_REGISTRY   default https://packagefeedproxy.microsoft.io/npm/   (no-auth Microsoft proxy)
//   NPM_REGISTRY    default https://registry.npmjs.org/
//   CONCURRENCY     default 24   (parallel packument fetches)

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const semver = require('semver');

const FEED_REGISTRY = process.env.FEED_REGISTRY ?? 'https://packagefeedproxy.microsoft.io/npm/';
const NPM_REGISTRY = process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org/';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 24);

// Reduce a registry URL to npm's "nerf dart" — protocol stripped, path kept, trailing slash — so it can be
// matched against the `//host/path/:_authToken` style keys npm writes to .npmrc.
function nerf(registryUrl) {
    const u = new URL(registryUrl);
    const path = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
    return `//${u.host}${path}`;
}

// Parse an .npmrc into a flat key -> value map (quotes stripped, ${VAR} expanded from the environment).
function parseNpmrc(file) {
    const map = new Map();
    if (!existsSync(file)) return map;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const val = line
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, '')
            .replace(/\$\{([^}]+)\}/g, (_, v) => process.env[v] ?? '');
        map.set(key, val);
    }
    return map;
}

// Build the Authorization header for a registry from the tokens npm/vsts-npm-auth wrote to .npmrc, or
// undefined when the registry needs no auth (e.g. the no-auth proxy). Reads the user .npmrc first, then the
// project .npmrc (project wins, matching npm's precedence). Supports both `_authToken` (Bearer) and the
// `username` + base64 `_password` (Basic) form Azure Artifacts / vsts-npm-auth emit; the most specific
// (longest) matching path prefix wins.
function feedAuthHeader(registry) {
    const merged = new Map();
    for (const file of [join(homedir(), '.npmrc'), join(process.cwd(), '.npmrc')]) {
        for (const [k, v] of parseNpmrc(file)) merged.set(k, v);
    }
    const target = nerf(registry);
    let prefix;
    for (const key of merged.keys()) {
        const m = /^(\/\/.+\/):(?:_authToken|_password|_auth|username)$/.exec(key);
        if (m && target.startsWith(m[1]) && (!prefix || m[1].length > prefix.length)) prefix = m[1];
    }
    if (!prefix) return undefined;
    const authToken = merged.get(`${prefix}:_authToken`);
    if (authToken) return `Bearer ${authToken}`;
    const basic = merged.get(`${prefix}:_auth`);
    if (basic) return `Basic ${basic}`;
    const password = merged.get(`${prefix}:_password`);
    if (password) {
        const username = merged.get(`${prefix}:username`) ?? '';
        const decoded = Buffer.from(password, 'base64').toString('utf8');
        return `Basic ${Buffer.from(`${username}:${decoded}`).toString('base64')}`;
    }
    return undefined;
}

const FEED_AUTH = feedAuthHeader(FEED_REGISTRY);

const only = new Set(process.argv.slice(2));

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
function lockTopLevelVersion(name) {
    return lock.packages?.[`node_modules/${name}`]?.version;
}

// `npm outdated` exits with code 1 when anything is outdated; capture stdout from the thrown error too.
async function npmOutdated() {
    try {
        const { stdout } = await execFileAsync(
            'npm',
            ['outdated', '--all', '--json', '--registry', FEED_REGISTRY],
            { shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 },
        );
        return JSON.parse(stdout || '{}');
    } catch (err) {
        if (err.stdout) return JSON.parse(err.stdout || '{}');
        throw err;
    }
}

// Fetch the abbreviated packument for a package from a registry, once per (registry, name). Returns
// `{ versions: string[], latest: string | undefined }`, or null if the package is not served there.
// Requests to an authenticated feed carry the Authorization header derived from .npmrc.
const packumentCache = new Map();
function packument(registry, name) {
    const key = `${registry}\u0000${name}`;
    let pending = packumentCache.get(key);
    if (pending) return pending;
    const base = registry.endsWith('/') ? registry : `${registry}/`;
    // Scoped names (@scope/pkg) must have the slash percent-encoded in the request path.
    const url = base + name.replace('/', '%2F');
    const headers = { accept: 'application/vnd.npm.install-v1+json' };
    if (registry === FEED_REGISTRY && FEED_AUTH) headers.authorization = FEED_AUTH;
    pending = fetch(url, { headers })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) =>
            body
                ? { versions: Object.keys(body.versions ?? {}), latest: body['dist-tags']?.latest }
                : null,
        )
        .catch(() => null);
    packumentCache.set(key, pending);
    return pending;
}

async function npmjsLatest(name) {
    return (await packument(NPM_REGISTRY, name))?.latest;
}

// All versions the Microsoft feed currently serves for a package (past its ~7-day quarantine).
async function feedVersions(name) {
    return (await packument(FEED_REGISTRY, name))?.versions ?? [];
}

// Direct dependencies declared in package.json, with `npm:` aliases resolved to their real name + range
// (e.g. "typescript": "npm:@typescript/typescript6@~6.0.2" -> realName @typescript/typescript6, range ~6.0.2).
function readDirectDeps() {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const deps = [];
    for (const group of [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies]) {
        for (const [name, spec] of Object.entries(group ?? {})) {
            const alias = /^npm:(.+)@([^@]+)$/.exec(spec ?? '');
            deps.push({ name, realName: alias ? alias[1] : name, range: alias ? alias[2] : (spec ?? '*') });
        }
    }
    return deps;
}

function isTopLevel(location, name) {
    if (!location) return false;
    const norm = location.replace(/\\/g, '/');
    // a hoisted install lives directly under the root node_modules, with no nested node_modules
    return norm.endsWith(`/node_modules/${name}`) && (norm.match(/node_modules/g) ?? []).length === 1;
}

async function pool(items, worker, size) {
    const out = new Array(items.length);
    let next = 0;
    async function run() {
        while (next < items.length) {
            const i = next++;
            out[i] = await worker(items[i]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
    return out;
}

const outdated = await npmOutdated();

// Build one candidate per hoisted package: target = min(wanted) across its top-level dependents,
// current = committed lockfile version.
const candidates = [];
for (const [name, raw] of Object.entries(outdated)) {
    if (only.size && !only.has(name)) continue;
    const entries = (Array.isArray(raw) ? raw : [raw]).filter((e) => e.wanted && isTopLevel(e.location, name));
    if (!entries.length) continue; // package is only present nested (governed by its parents) — skip
    const wanted = entries.map((e) => e.wanted).filter((v) => semver.valid(v)).sort(semver.compare)[0];
    const current = lockTopLevelVersion(name) ?? entries[0].current;
    if (!semver.valid(current) || !semver.valid(wanted)) continue;
    if (!semver.gt(wanted, current)) continue; // already satisfied by the committed lockfile
    candidates.push({ name, current, wanted });
}

// Apply the npmjs `latest` dist-tag guard.
const upgradeResults = await pool(
    candidates,
    async ({ name, current, wanted }) => {
        const latest = await npmjsLatest(name);
        if (semver.prerelease(wanted)) {
            return { name, current, wanted, latest, target: null, note: 'wanted is a pre-release — review' };
        }
        if (latest && semver.gt(wanted, latest)) {
            return {
                name,
                current,
                wanted,
                latest,
                target: null,
                note: 'feed ahead of npmjs latest (possible pre-release) — review',
            };
        }
        return { name, current, wanted, latest: latest ?? '(unknown)', target: wanted, note: '' };
    },
    CONCURRENCY,
);

// Feed-availability pass: flag direct deps whose committed lockfile version the feed does not serve,
// proposing the highest in-range feed version as a downgrade so CI can restore from the feed.
const directDeps = readDirectDeps().filter((d) => !only.size || only.has(d.name));
const availabilityResults = (
    await pool(
        directDeps,
        async ({ name, realName, range }) => {
            const current = lockTopLevelVersion(name);
            if (!current || !semver.valid(current)) return null;
            const versions = (await feedVersions(realName)).filter((v) => semver.valid(v));
            if (!versions.length || versions.includes(current)) return null; // on the feed (or feed unknown)
            // Choose the highest version that is on the feed AND satisfies the range AND is not ahead of
            // npmjs' `latest` — the feed ignores npm dist-tags, so its top version may be a beta npmjs never
            // promoted. Capping at `latest` applies the same "take the minimum" rule as the upgrade pass.
            const latest = await npmjsLatest(realName);
            const inRange = versions.filter((v) => semver.satisfies(v, range));
            const capped = latest ? inRange.filter((v) => !semver.gt(v, latest)) : inRange;
            const target = capped.sort(semver.rcompare)[0];
            if (!target || target === current) {
                return {
                    name,
                    current,
                    wanted: current,
                    latest: latest ?? '-',
                    target: null,
                    note: `lockfile ${current} not on feed; no in-range feed version at/below npmjs latest — review`,
                };
            }
            return {
                name,
                current,
                wanted: target,
                latest: latest ?? '-',
                target,
                note: `lockfile ahead of feed — downgrade to feed max in range (${target})`,
            };
        },
        CONCURRENCY,
    )
).filter(Boolean);

// Merge both passes; the availability pass wins on the rare name collision (a package cannot be both
// behind and ahead of the feed at once, but guard against duplicate rows regardless).
const byName = new Map();
for (const r of [...upgradeResults, ...availabilityResults]) byName.set(r.name, r);
const results = [...byName.values()];

results.sort((a, b) => a.name.localeCompare(b.name));
const bumps = results.filter((r) => r.target);

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('package', 44), pad('current', 14), pad('target', 14), pad('npmjs latest', 14), 'note');
console.log('-'.repeat(104));
for (const r of results) {
    console.log(
        pad(r.name, 44),
        pad(r.current, 14),
        pad(r.target ?? '-', 14),
        pad(r.latest ?? '-', 14),
        r.note,
    );
}
console.log(`\n${bumps.length} package(s) to bump; ${results.length - bumps.length} flagged for review.`);

console.log('BEGIN_JSON');
console.log(JSON.stringify(bumps.map(({ name, current, target }) => ({ name, current, target })), null, 2));
console.log('END_JSON');
