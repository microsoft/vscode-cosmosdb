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
const script = step
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n');

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
