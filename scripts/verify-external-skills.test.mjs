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

const workflow = readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
const step = workflow.split('        id: skills\n')[1].split('\n      - name:')[0];
const script = extractRun(step);

function extractRun(step) {
    return step
        .split('        run: |\n')[1]
        .split('\n')
        .map((line) => line.slice(10))
        .join('\n');
}

for (const scenario of ['match', 'drift', 'failure']) {
    test(`external skill verification preserves the checkout and cleans up after ${scenario}`, (t) => {
        const root = mkdtempSync(path.join(tmpdir(), 'verify-external-skills-'));
        t.after(() => rmSync(root, { recursive: true, force: true }));
        const checkout = path.join(root, 'checkout');
        const runnerTemp = path.join(root, 'runner');
        mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
        mkdirSync(path.join(checkout, 'skills', 'external'), { recursive: true });
        mkdirSync(path.join(checkout, 'skills', 'local'), { recursive: true });
        mkdirSync(runnerTemp);
        writeFileSync(path.join(checkout, 'package.json'), '{}');
        writeFileSync(path.join(checkout, 'skills', 'external', 'SKILL.md'), 'committed\r\n');
        writeFileSync(path.join(checkout, 'skills', 'local', 'SKILL.md'), 'local-only\n');
        writeFileSync(
            path.join(checkout, 'scripts', 'fetch-skill.mjs'),
            `
import { writeFileSync } from 'node:fs';
if (process.env.FETCH_SCENARIO !== 'match') {
    writeFileSync(new URL('../skills/external/SKILL.md', import.meta.url), 'downloaded\\n');
}

if (process.env.FETCH_SCENARIO === 'failure') {
    console.error('HTTP 503 during download');
    process.exit(1);
}
`,
        );

        const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
            cwd: checkout,
            env: { ...process.env, RUNNER_TEMP: runnerTemp, FETCH_SCENARIO: scenario },
            encoding: 'utf8',
            timeout: 10_000,
        });

        assert.equal(result.status, 0, result.stderr);
        if (scenario === 'match') {
            assert.match(result.stdout, /External skills are up to date/);
            assert.doesNotMatch(result.stdout, /::warning::/);
        } else if (scenario === 'drift') {
            assert.match(result.stdout, /::warning::Committed skills\/ does not match/);
            assert.match(result.stdout, /downloaded/);
        } else {
            assert.match(result.stdout, /::warning::Unable to verify external skills/);
            assert.match(result.stderr, /HTTP 503/);
            assert.doesNotMatch(result.stdout, /External skills are up to date|does not match/);
        }
        assert.equal(readFileSync(path.join(checkout, 'skills', 'external', 'SKILL.md'), 'utf8'), 'committed\r\n');
        assert.equal(readFileSync(path.join(checkout, 'skills', 'local', 'SKILL.md'), 'utf8'), 'local-only\n');
        assert.deepEqual(readdirSync(checkout).sort(), ['package.json', 'scripts', 'skills']);
        assert.deepEqual(readdirSync(runnerTemp), []);
    });
}

for (const { testsResult, otherResult } of [
    { testsResult: 'success', otherResult: 'success' },
    { testsResult: 'failure', otherResult: 'success' },
    { testsResult: 'failure', otherResult: 'skipped' },
]) {
    test(`build summary includes skill tests ${testsResult} when other checks are ${otherResult}`, (t) => {
        const root = mkdtempSync(path.join(tmpdir(), 'skill-build-summary-'));
        t.after(() => rmSync(root, { recursive: true, force: true }));
        const summaryPath = path.join(root, 'summary.md');
        const callsPath = path.join(root, 'gh-calls');
        writeFileSync(
            path.join(root, 'gh'),
            `#!/bin/sh
echo "$*" >> "$GH_CALLS"
case "$*" in
    *issues/123/comments*) echo 456 ;;
esac
`,
            { mode: 0o755 },
        );
        const summaryScript = extractRun(workflow.split('      - name: 📊 Generate Job Summary\n')[1]);
        const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', summaryScript], {
            env: {
                ...process.env,
                PATH: `${root}${path.delimiter}${process.env.PATH}`,
                GH_CALLS: callsPath,
                GITHUB_STEP_SUMMARY: summaryPath,
                GITHUB_RUN_ID: '123',
                SERVER_URL: 'https://github.com',
                REPO: 'example/repo',
                EVENT_NAME: 'pull_request',
                PR_NUMBER: '123',
                VALIDATE_RESULT: otherResult,
                L10N_RESULT: otherResult,
                SKILLS_RESULT: 'success',
                SKILLS_TEST_RESULT: testsResult,
                LINT_RESULT: otherResult,
                PRETTIER_RESULT: otherResult,
                COMPILE_RESULT: otherResult,
                PACKAGE_RESULT: otherResult,
            },
            encoding: 'utf8',
            timeout: 10_000,
        });

        assert.equal(result.status, 0, result.stderr);
        const summary = readFileSync(summaryPath, 'utf8');
        assert.match(summary, testsResult === 'failure' ? /# ❌ Build/ : /# ✅ Build/);
        assert.match(
            summary,
            testsResult === 'failure'
                ? /\*\*External Skills:\*\* verification ✅ success; tests ❌ failure/
                : /\*\*External Skills:\*\* verification ✅ success; tests ✅ success/,
        );
        assert.match(readFileSync(callsPath, 'utf8'), /--method PATCH repos\/example\/repo\/issues\/comments\/456/);
    });
}
