/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { summarizePlaywrightReport } from './summarize-playwright-report.mjs';

function spec(title, status, projectName = 'default', attempts = 1) {
    return {
        title,
        file: 'specs/example.spec.ts',
        line: 42,
        tests: [{ status, projectName, results: Array.from({ length: attempts }, () => ({})) }],
    };
}

test('omits warnings for clean passes, failures, skipped tests, and expected failures', () => {
    const report = {
        suites: [
            {
                title: 'example.spec.ts',
                specs: [
                    spec('passes', 'expected'),
                    spec('fails after all retries', 'unexpected', 'default', 3),
                    spec('skipped', 'skipped'),
                    spec('expected failure', 'expected'),
                ],
            },
        ],
    };
    assert.equal(summarizePlaywrightReport(report), '');
    assert.equal(summarizePlaywrightReport({ suites: [] }), '');
});

test('finds flaky tests in nested suites and distinguishes projects and attempt counts', () => {
    const report = {
        suites: [
            {
                title: 'example.spec.ts',
                specs: [spec('still fails', 'unexpected', 'default', 3)],
                suites: [
                    {
                        title: 'nested suite',
                        specs: [
                            {
                                ...spec('recovers', 'flaky', 'default', 2),
                                tests: [
                                    ...spec('recovers', 'flaky', 'default', 2).tests,
                                    ...spec('recovers', 'flaky', 'localization-ja', 3).tests,
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    };
    const summary = summarizePlaywrightReport(report);
    assert.match(summary, /Flaky tests \(2\)/);
    assert.match(summary, /example\.spec\.ts › nested suite › recovers/);
    assert.match(summary, /specs\/example\.spec\.ts:42/);
    assert.match(summary, /default, 2 attempts/);
    assert.match(summary, /localization-ja, 3 attempts/);
    assert.doesNotMatch(summary, /still fails/);
});

test('escapes report text so test names and projects cannot inject HTML', () => {
    const summary = summarizePlaywrightReport({
        suites: [{ title: '<suite>', specs: [spec('a & b </code>', 'flaky', '<project>', 2)] }],
    });
    assert.match(summary, /&lt;suite&gt;/);
    assert.match(summary, /a &amp; b &lt;\/code&gt;/);
    assert.match(summary, /&lt;project&gt;/);
});

test('CLI emits a warning without failing recovered runs and rejects unavailable or malformed reports', (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'playwright-summary-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const reportPath = path.join(dir, 'results.json');
    const script = fileURLToPath(new URL('./summarize-playwright-report.mjs', import.meta.url));
    const run = () => spawnSync(process.execPath, [script, reportPath], { encoding: 'utf8' });

    assert.notEqual(run().status, 0);
    writeFileSync(reportPath, 'invalid JSON');
    assert.notEqual(run().status, 0);

    writeFileSync(
        reportPath,
        JSON.stringify({ suites: [{ title: 'suite', specs: [spec('recovers', 'flaky', 'default', 2)] }] }),
    );
    const flaky = run();
    assert.equal(flaky.status, 0, flaky.stderr);
    assert.match(flaky.stdout, /Flaky tests \(1\)/);
    assert.match(flaky.stderr, /::warning::/);

    writeFileSync(reportPath, JSON.stringify({ suites: [] }));
    const clean = run();
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(clean.stdout, '');
    assert.equal(clean.stderr, '');
});
