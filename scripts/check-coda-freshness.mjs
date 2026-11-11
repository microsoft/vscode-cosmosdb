/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCodaPin } from './coda.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function checkCodaFreshness(pin, { token = process.env.CODA_READ_TOKEN, temporaryRoot = tmpdir() } = {}) {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    if (token) {
        // Scope authentication to this repository; never store the token in a URL, argument or Git config file.
        const index = Number(env.GIT_CONFIG_COUNT ?? 0);
        env.GIT_CONFIG_COUNT = String(index + 1);
        env[`GIT_CONFIG_KEY_${index}`] = `http.${pin.repo}.extraheader`;
        env[`GIT_CONFIG_VALUE_${index}`] = `Authorization: Basic ${Buffer.from(`:${token}`).toString('base64')}`;
    }
    function git(directory, args, allowMissingAncestor = false) {
        const result = spawnSync(
            'git',
            [
                '--no-pager',
                '--git-dir',
                directory,
                '-c',
                'credential.interactive=never',
                '-c',
                'core.hooksPath=',
                ...args,
            ],
            {
                encoding: 'utf8',
                env,
                windowsHide: true,
                timeout: 180_000,
                maxBuffer: 8 * 1024 * 1024,
            },
        );
        if (allowMissingAncestor && !result.error && result.status === 1) {
            return undefined;
        }
        if (result.error || result.status !== 0) {
            throw new Error(
                `CODA freshness Git operation failed (${args[0]}): ${result.error?.message ?? result.stderr.trim()}`,
            );
        }
        return result.stdout.trim();
    }
    const directory = mkdtempSync(path.join(temporaryRoot, 'coda-freshness-'));
    try {
        git(directory, ['init', '--quiet', '--bare']);
        const remote = git(directory, ['ls-remote', '--exit-code', pin.repo, pin.trackingRef]);
        const lines = remote.split(/\r?\n/);
        if (lines.length !== 1) {
            throw new Error('CODA tracking ref must resolve to exactly one branch HEAD.');
        }
        const [head, ref] = lines[0].split(/\s+/);
        if (!/^[a-f0-9]{40}$/.test(head) || ref !== pin.trackingRef) {
            throw new Error('CODA returned an invalid tracking ref or HEAD.');
        }
        if (head === pin.commit) {
            return { pin: pin.commit, head, ref, ahead: 0, behind: 0, relationship: 'equal' };
        }
        // Fetch immutable objects after resolving HEAD, without a working checkout or a shallow-history count.
        git(directory, ['fetch', '--quiet', '--no-tags', '--filter=tree:0', pin.repo, pin.commit, head]);
        const counts = git(directory, ['rev-list', '--left-right', '--count', `${pin.commit}...${head}`]).split(/\s+/);
        const [behind, ahead] = counts.map(Number);
        if (
            counts.length !== 2 ||
            !Number.isSafeInteger(ahead) ||
            !Number.isSafeInteger(behind) ||
            ahead < 0 ||
            behind < 0
        ) {
            throw new Error('CODA returned invalid ahead/behind counts.');
        }
        const ancestor = git(directory, ['merge-base', pin.commit, head], true);
        const relationship = !ancestor ? 'unrelated' : behind === 0 ? 'ahead' : ahead === 0 ? 'behind' : 'diverged';
        return { pin: pin.commit, head, ref, ahead, behind, relationship };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

export function formatFreshness(result) {
    return [
        `# CODA Freshness: ${result.relationship === 'equal' ? 'PASSED' : 'FAILED'}`,
        '',
        `Tracking ref: \`${result.ref}\``,
        `Pinned commit: \`${result.pin}\``,
        `Upstream HEAD: \`${result.head}\``,
        '',
        `Upstream HEAD is **${result.ahead} commits ahead** and **${result.behind} commits behind** the pin (${result.relationship}).`,
        '',
        'Read-only advisory: no pin, working checkout or cached conformance source was changed.',
        '',
    ].join('\n');
}

export function main(args = process.argv.slice(2), configuredPin, env = process.env) {
    if (args.length > 0) {
        throw new Error('Usage: npm run coda:check');
    }
    const pin = configuredPin ?? readCodaPin(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')));
    const result = checkCodaFreshness(pin, { token: env.CODA_READ_TOKEN ?? '' });
    const report = formatFreshness(result);
    console.log(report);
    if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(env.GITHUB_STEP_SUMMARY, report);
    }
    if (result.relationship !== 'equal' && env.GITHUB_ACTIONS === 'true') {
        console.error(
            '::error::CODA branch HEAD differs from the pin. See the ahead/behind counts in the job summary.',
        );
    }
    return result.relationship === 'equal' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main();
    } catch (error) {
        const message = `CODA freshness is unverifiable: ${error instanceof Error ? error.message : String(error)}`;
        console.error(message);
        if (process.env.GITHUB_STEP_SUMMARY) {
            appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# CODA Freshness: FAILED\n\n${message}\n`);
        }
        process.exitCode = 1;
    }
}
