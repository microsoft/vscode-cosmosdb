#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function readCodaPin(manifest) {
    const config = manifest.externalSpecifications?.coda;
    if (
        !config ||
        typeof config.repo !== 'string' ||
        !/^https:\/\/[^/@]+\/[^?#]+$/.test(config.repo) ||
        !/^[a-f0-9]{40}$/.test(config.commit ?? '') ||
        !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(config.trackingRef ?? '') ||
        typeof config.featurePath !== 'string' ||
        !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(config.featurePath)
    ) {
        throw new Error(
            'Invalid externalSpecifications.coda pin: expected HTTPS repository, full SHA, tracking ref and relative feature path.',
        );
    }
    return config;
}

function git(directory, args) {
    const result = spawnSync('git', ['--no-pager', '-C', directory, ...args], {
        encoding: 'utf8',
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        windowsHide: true,
    });
    if (result.error || result.status !== 0) {
        throw new Error(`CODA Git operation failed (${args[0]}): ${result.error?.message ?? result.stderr.trim()}`);
    }
    return result.stdout.trim();
}

export function featureFiles(directory) {
    const result = [];
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error('CODA feature paths must not contain symbolic links.');
        }
        if (entry.isDirectory()) {
            result.push(...featureFiles(file));
        } else if (entry.isFile() && entry.name.endsWith('.feature')) {
            result.push(file);
        }
    }
    return result;
}

function verifyCheckout(directory, pin) {
    if (lstatSync(directory).isSymbolicLink()) {
        throw new Error('CODA cache must not be a symbolic link.');
    }
    if (git(directory, ['rev-parse', 'HEAD']) !== pin.commit) {
        throw new Error('CODA cache HEAD does not match the pinned commit.');
    }
    if (git(directory, ['config', '--get', 'remote.origin.url']) !== pin.repo) {
        throw new Error('CODA cache origin does not match the pinned repository.');
    }
    if (git(directory, ['status', '--porcelain', '--untracked-files=all', '--ignored=matching']) !== '') {
        throw new Error(
            'CODA cache has local changes. Preserve them elsewhere before removing this named cache entry.',
        );
    }
    const parts = pin.featurePath.split('/');
    let featureRoot = directory;
    for (const part of parts) {
        featureRoot = path.join(featureRoot, part);
        if (lstatSync(featureRoot).isSymbolicLink()) {
            throw new Error('CODA feature directory must not be a symbolic link.');
        }
    }
    const files = featureFiles(featureRoot);
    if (files.length === 0) {
        throw new Error('The pinned CODA revision contains no feature files.');
    }
    return featureRoot;
}

export function fetchCoda(pin, cacheRoot = path.join(root, '.coda')) {
    mkdirSync(cacheRoot, { recursive: true });
    if (lstatSync(cacheRoot).isSymbolicLink()) {
        throw new Error('CODA cache root must not be a symbolic link.');
    }
    const identity = createHash('sha256').update(pin.repo).digest('hex').slice(0, 12);
    const destination = path.join(cacheRoot, `${identity}-${pin.commit}`);
    if (existsSync(destination)) {
        return verifyCheckout(destination, pin);
    }
    const staging = mkdtempSync(path.join(cacheRoot, 'fetch-'));
    try {
        git(staging, ['init', '--quiet']);
        git(staging, ['config', 'core.autocrlf', 'false']);
        git(staging, ['remote', 'add', 'origin', pin.repo]);
        // Fetch the object, not mutable main. No submodules, hooks or upstream executables are run.
        git(staging, [
            '-c',
            'credential.interactive=never',
            'fetch',
            '--quiet',
            '--depth=1',
            '--no-tags',
            'origin',
            pin.commit,
        ]);
        git(staging, ['-c', 'core.hooksPath=', 'checkout', '--quiet', '--detach', pin.commit]);
        verifyCheckout(staging, pin);
        renameSync(staging, destination);
    } finally {
        if (existsSync(staging)) {
            rmSync(staging, { recursive: true, force: true });
        }
    }
    return verifyCheckout(destination, pin);
}

export function parseArguments(args) {
    const [command, ...options] = args;
    if (!['fetch', 'test'].includes(command)) {
        throw new Error('Usage: node scripts/coda.mjs fetch|test [--detectors DX-001,DX-011,DX-020]');
    }
    let detectors;
    if (options.length > 0) {
        if (command !== 'test' || options.length !== 2 || options[0] !== '--detectors') {
            throw new Error('Only test supports --detectors followed by a comma-separated detector list.');
        }
        detectors = options[1].split(',');
        if (
            detectors.length === 0 ||
            detectors.some((id) => !/^DX-\d{3}$/.test(id)) ||
            new Set(detectors).size !== detectors.length
        ) {
            throw new Error('Invalid or duplicate detector selection.');
        }
    }
    return { command, detectors };
}

export function main(args = process.argv.slice(2)) {
    const { command, detectors } = parseArguments(args);
    if (process.env.GITHUB_ACTIONS === 'true' && process.env.CODA_TRUSTED_PRIVATE_RUNNER !== '1') {
        throw new Error(
            'Private CODA sources/reports must not enter public Actions logs. Use a trusted private runner with CODA_TRUSTED_PRIVATE_RUNNER=1.',
        );
    }
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const pin = readCodaPin(manifest);
    const features = fetchCoda(pin);
    console.log(`CODA commit: ${pin.commit}; feature files: ${featureFiles(features).length}`);
    if (command === 'fetch') {
        console.log('Pinned checkout verified. No tests or upstream code executed.');
        return 0;
    }
    const report = path.join(root, '.coda', 'conformance.json');
    rmSync(report, { force: true });
    const result = spawnSync(
        process.execPath,
        [
            path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
            'run',
            '--config',
            path.join(root, 'vitest.coda.config.ts'),
        ],
        {
            cwd: root,
            stdio: 'inherit',
            env: {
                ...process.env,
                CODA_FEATURE_ROOT: features,
                CODA_COMMIT: pin.commit,
                CODA_DETECTORS: detectors?.join(',') ?? '',
                CODA_REPORT: report,
            },
            windowsHide: true,
        },
    );
    if (result.error) {
        throw result.error;
    }
    return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
