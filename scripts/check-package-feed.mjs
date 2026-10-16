/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { clearLine, cursorTo } from 'node:readline';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// Usage: npm run feed:check -- [--visibility public|private] [--path <package-lock.json>]
// Relative paths resolve from the working directory; project credentials come from .npmrc beside the lockfile.
// Progress goes to stderr: plain logs in CI/redirected output, with a progress bar in interactive terminals.

const MS_FEED = 'https://packagefeedproxy.microsoft.io/npm/';
const NPM_HOST = 'registry.npmjs.org';
const CONCURRENCY = 8;

function createProgress(total, initialErrors) {
    const output = process.stderr;
    const ci = ['CI', 'GITHUB_ACTIONS', 'TF_BUILD'].some((key) => {
        const value = process.env[key]?.toLowerCase();
        return value && value !== 'false' && value !== '0';
    });
    const interactive = output.isTTY && !ci && process.env.TERM !== 'dumb';
    const started = Date.now();
    let completed = 0;
    let errors = initialErrors.length;
    const percent = () => (total === 0 ? 100 : Math.floor((completed / total) * 100));
    const status = () =>
        `${completed}/${total} lookups (${percent()}%), ${errors} errors, ${Math.floor((Date.now() - started) / 1000)}s`;
    const clear = () => {
        if (interactive) {
            clearLine(output, 0);
            cursorTo(output, 0);
        }
    };
    const draw = () => {
        if (!interactive) return;
        clear();
        const filled = Math.floor(percent() / 5);
        const line = `[${'#'.repeat(filled)}${'-'.repeat(20 - filled)}] ${status()}`;
        output.write(line.slice(0, Math.max(0, (output.columns || 80) - 1)));
    };
    const log = (message) => {
        clear();
        output.write(`[feed] ${message}\n`);
        draw();
    };

    log(`Starting ${total} unique feed lookups with up to ${CONCURRENCY} concurrent requests.`);
    for (const error of initialErrors) log(`ERROR: ${error}`);
    // Heartbeats also show activity while requests are waiting on timeouts or retry delays.
    const timer = setInterval(() => log(status()), 10_000);
    timer.unref();
    return {
        log,
        complete(labels, failures) {
            completed++;
            errors += failures.length;
            for (const failure of failures) log(`ERROR: ${failure}`);
            if (completed % 25 === 0 || completed === total) {
                log(`${status()}. Last: ${labels}`);
            } else {
                draw();
            }
        },
        close() {
            clearInterval(timer);
            clear();
            output.write(`[feed] Finished: ${status()}\n`);
        },
    };
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function secureUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
        throw new Error('Expected an HTTPS URL without embedded credentials or a fragment');
    }
    return url;
}

export function planChecks(lock, visibility) {
    if (!['public', 'private'].includes(visibility)) throw new Error('Invalid repository visibility');
    if (![2, 3].includes(lock.lockfileVersion) || !isObject(lock.packages)) {
        throw new Error('Expected a package-lock.json with lockfileVersion 2 or 3 and a packages object');
    }

    const checks = new Map();
    const errors = [];
    let entries = 0;
    let links = 0;
    for (const [location, entry] of Object.entries(lock.packages)) {
        // Root/workspace manifests are not registry dependencies; their nested node_modules still are.
        if (!location.split('/').includes('node_modules')) continue;
        if (!isObject(entry)) {
            errors.push(`${location}: invalid lockfile entry`);
            continue;
        }
        if (entry.link) {
            const target = lock.packages[entry.resolved];
            if (
                typeof entry.resolved === 'string' &&
                entry.resolved &&
                !entry.resolved.split('/').includes('node_modules') &&
                isObject(target) &&
                !target.link
            ) {
                links++;
            } else {
                errors.push(`${location}: link does not reference a local workspace in the lockfile`);
            }
            continue;
        }

        entries++;
        const name = entry.name ?? location.split('node_modules/').at(-1);
        const version = entry.version;
        if (
            typeof name !== 'string' ||
            !/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) ||
            typeof version !== 'string' ||
            !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)
        ) {
            errors.push(`${location}: missing or invalid registry package name/version`);
            continue;
        }
        const label = `${name}@${version}`;
        let url;
        try {
            url = secureUrl(entry.resolved);
        } catch {
            errors.push(`${label}: resolved must be an HTTPS registry tarball URL without embedded credentials`);
            continue;
        }

        const npm = url.hostname === NPM_HOST;
        if (visibility === 'public' && (!npm || url.port || url.search)) {
            errors.push(`${label}: public repositories must resolve packages from https://${NPM_HOST}/`);
            continue;
        }
        if (visibility === 'private' && npm) {
            errors.push(`${label}: private repositories must resolve packages from a private feed`);
            continue;
        }
        const key = visibility === 'public' ? name : url.href;
        if (!checks.has(key)) {
            checks.set(key, {
                url: visibility === 'public' ? MS_FEED + encodeURIComponent(name) : url.href,
                name,
                versions: new Set(),
                labels: new Set(),
            });
        }
        checks.get(key).versions.add(version);
        checks.get(key).labels.add(label);
    }
    return { checks: [...checks.values()], errors, entries, links };
}

export function parseNpmrc(text) {
    const config = new Map();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const separator = line.indexOf('=');
        if (separator < 0) continue;
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        config.set(key, value.replace(/^(['"])(.*)\1$/, '$2'));
    }
    return config;
}

function readNpmrc(projectDirectory) {
    const config = new Map();
    const userConfig =
        process.env.npm_config_userconfig ?? process.env.NPM_CONFIG_USERCONFIG ?? join(homedir(), '.npmrc');
    for (const file of [userConfig, join(projectDirectory, '.npmrc')]) {
        if (!existsSync(file)) continue;
        for (const [key, value] of parseNpmrc(readFileSync(file, 'utf8'))) config.set(key, value);
    }
    return config;
}

export function authHeader(url, config, env = process.env) {
    const target = `//${url.host}${url.pathname}`;
    const prefixes = [...config.keys()]
        .map((key) => /^(\/\/.+\/):(?:_authToken|_password|_auth)$/.exec(key)?.[1])
        .filter((prefix) => prefix && target.startsWith(prefix))
        .sort((a, b) => b.length - a.length);
    const prefix = prefixes[0];
    if (!prefix) return undefined;

    const value = (key) =>
        config.get(`${prefix}:${key}`)?.replace(/\$\{([^}]+)\}/g, (_, variable) => {
            if (!env[variable])
                throw new Error(`Missing environment variable ${variable} required by feed credentials`);
            return env[variable];
        });
    const token = value('_authToken');
    if (token) return `Bearer ${token}`;
    const basic = value('_auth');
    if (basic) return `Basic ${basic}`;
    const password = value('_password');
    if (password) {
        const username = value('username') ?? '';
        return `Basic ${Buffer.from(`${username}:${Buffer.from(password, 'base64').toString('utf8')}`).toString('base64')}`;
    }
    throw new Error('The matching .npmrc credential is empty; authenticate the private feed first');
}

async function fetchOnce(target, visibility, config, fetchImpl) {
    const initial = secureUrl(target);
    let url = initial;
    let method = visibility === 'public' ? 'GET' : 'HEAD';
    const signal = AbortSignal.timeout(20_000);
    for (let redirects = 0; redirects <= 5;) {
        const headers = {};
        if (visibility === 'public') {
            headers.accept = 'application/vnd.npm.install-v1+json';
        } else {
            // Never forward credentials to a different host, or outside their configured npm path scope.
            const auth = url.origin === initial.origin ? authHeader(url, config) : undefined;
            if (auth) headers.authorization = auth;
            if (method === 'GET') headers.range = 'bytes=0-0';
        }
        let response;
        try {
            response = await fetchImpl(url.href, { method, headers, signal, redirect: 'manual' });
        } catch {
            return { transientError: 'Network error or request timeout' };
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            if (visibility === 'public') throw new Error('Unexpected metadata redirect from the MS feed');
            if (!location || redirects === 5) throw new Error('Invalid or excessive tarball redirects');
            url = secureUrl(new URL(location, url).href);
            if (url.hostname === NPM_HOST) {
                throw new Error('Private feed tarball redirects to a public registry');
            }
            redirects++;
            continue;
        }
        if (response.status === 405 && method === 'HEAD') {
            await response.body?.cancel();
            method = 'GET';
            continue;
        }
        if (visibility === 'public' && response.ok) {
            try {
                return { status: response.status, metadata: await response.json() };
            } catch {
                throw new Error('Invalid or incomplete JSON metadata from the MS feed');
            }
        }
        const retryAfter = response.headers.get('retry-after');
        await response.body?.cancel();
        return { status: response.status, retryAfter };
    }
}

async function request(target, visibility, config, fetchImpl, sleep, onRetry) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await fetchOnce(target, visibility, config, fetchImpl);
        if (result.transientError || result.status === 429 || result.status >= 500) {
            if (attempt === 2)
                throw new Error(result.transientError ?? `Feed returned HTTP ${result.status} after retries`);
            const retrySeconds = Number(result.retryAfter);
            const delay = Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds * 1000 : 500 * 2 ** attempt;
            const retryDelay = Math.min(delay, 30_000);
            onRetry(attempt + 2, retryDelay, result.transientError ?? `HTTP ${result.status}`);
            await sleep(retryDelay);
            continue;
        }
        if ([401, 403].includes(result.status)) {
            throw new Error(`Feed returned HTTP ${result.status}: authentication/authorization failed`);
        }
        if (result.status === 404) return result;
        if (result.status < 200 || result.status >= 300) throw new Error(`Feed returned HTTP ${result.status}`);
        return result;
    }
}

export async function checkPackages(
    lock,
    visibility,
    { config = new Map(), fetchImpl = fetch, sleep = setTimeout } = {},
) {
    const plan = planChecks(lock, visibility);
    const errors = [...plan.errors];
    const progress = createProgress(plan.checks.length, plan.errors);
    let next = 0;
    let passed = 0;
    async function worker() {
        while (next < plan.checks.length) {
            const check = plan.checks[next++];
            const labels = [...check.labels].join(', ');
            const failures = [];
            try {
                const result = await request(
                    check.url,
                    visibility,
                    config,
                    fetchImpl,
                    sleep,
                    (attempt, delay, reason) => {
                        progress.log(`Retry ${attempt}/3 for ${labels} in ${delay}ms: ${reason}`);
                    },
                );
                if (result.status === 404) {
                    failures.push(
                        `${labels}: ${visibility === 'public' ? 'package missing from MS feed' : 'resolved tarball missing from private feed'} (HTTP 404)`,
                    );
                } else if (visibility === 'public') {
                    if (!isObject(result.metadata?.versions))
                        throw new Error('MS feed metadata has no versions object');
                    const latest = result.metadata['dist-tags']?.latest;
                    const latestAvailable =
                        typeof latest === 'string' && result.metadata.versions[latest]?.dist?.tarball
                            ? latest
                            : 'not reported';
                    for (const version of check.versions) {
                        const metadata = result.metadata.versions[version];
                        if (!isObject(metadata) || !metadata.dist?.tarball) {
                            failures.push(
                                `${check.name}@${version}: version unavailable in MS feed (possibly still in quarantine; feed latest: ${latestAvailable})`,
                            );
                        } else {
                            passed++;
                        }
                    }
                } else {
                    passed += check.labels.size;
                }
            } catch (error) {
                failures.push(`${labels}: ${error.message}`);
            }
            errors.push(...failures);
            progress.complete(labels, failures);
        }
    }
    try {
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, plan.checks.length) }, worker));
    } finally {
        progress.close();
    }
    return { entries: plan.entries, links: plan.links, requests: plan.checks.length, passed, errors: errors.sort() };
}

export function formatReport(result, visibility) {
    return [
        `# Package Feed Check: ${result.errors.length ? 'FAILED' : 'PASSED'}`,
        '',
        `Repository policy: **${visibility}**`,
        visibility === 'public'
            ? `Version availability: ${MS_FEED}`
            : 'Availability: each private resolved tarball URL',
        '',
        `Registry entries: ${result.entries}; local workspace links: ${result.links}; unique lookups: ${result.requests}; passed versions: ${result.passed}.`,
        '',
        ...(result.errors.length
            ? [
                  '## Errors',
                  '',
                  ...result.errors
                      .join('\n')
                      .split('\n')
                      .map((line) => `    ${line}`),
                  '',
              ]
            : []),
        'This check is read-only. It does not compare tarball integrity across registries.',
        '',
    ].join('\n');
}

async function main() {
    const { values } = parseArgs({
        options: {
            visibility: { type: 'string', default: 'public' },
            path: { type: 'string', default: 'package-lock.json' },
        },
    });
    const visibility = values.visibility;
    if (!['public', 'private'].includes(visibility) || !values.path.trim()) {
        throw new Error('Usage: npm run feed:check -- [--visibility public|private] [--path <package-lock.json>]');
    }
    const lockPath = resolve(values.path);
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const result = await checkPackages(lock, visibility, {
        config: visibility === 'private' ? readNpmrc(dirname(lockPath)) : new Map(),
    });
    const report = formatReport(result, visibility);
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    if (result.errors.length) {
        if (process.env.GITHUB_ACTIONS === 'true') {
            console.error('::error::Package feed check failed. See the job summary for package and feed errors.');
        }
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main().catch((error) => {
        console.error(`Package feed check failed: ${error.message}`);
        process.exitCode = 1;
    });
}
