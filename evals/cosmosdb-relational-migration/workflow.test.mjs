/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/migration-evals.yml', import.meta.url), 'utf8');

test('CI runs models only for skill changes or manual dispatch', { skip: process.platform === 'win32' }, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'migration-vally-workflow-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const script = workflow.match(/        run: \|\n([\s\S]*?)\n\n  validate:/)[1].replace(/^          /gm, '');
    const git = (...args) =>
        execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '--quiet');
    git(
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '--quiet',
        '--allow-empty',
        '-m',
        'Initial fixture',
    );
    function detect(event, before = '') {
        const output = join(root, 'github-output');
        writeFileSync(output, '');
        execFileSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
            cwd: root,
            env: { ...process.env, EVENT_NAME: event, BEFORE_SHA: before, RUNNER_TEMP: root, GITHUB_OUTPUT: output },
        });
        return readFileSync(output, 'utf8').trim();
    }
    for (const [path, expected] of [
        ['src/unrelated.ts', 'offline=false\nlive=false'],
        ['evals/example/eval.yaml', 'offline=true\nlive=false'],
        ['scripts/eval-options.mjs', 'offline=true\nlive=false'],
        ['package.json', 'offline=true\nlive=false'],
        ['skills/cosmosdb-relational-migration/references/example.md', 'offline=true\nlive=true'],
        ['skills/cosmosdb-best-practices/rules/example.md', 'offline=true\nlive=true'],
    ]) {
        const before = git('rev-parse', 'HEAD');
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), 'synthetic change');
        git('add', path);
        git(
            '-c',
            'user.name=Test',
            '-c',
            'user.email=test@example.invalid',
            'commit',
            '--quiet',
            '-m',
            'Fixture change',
        );
        assert.equal(detect('pull_request'), expected, path);
        assert.equal(detect('push', before), expected, path);
    }
    assert.equal(detect('workflow_dispatch'), 'offline=true\nlive=true');
});

test('live suites run independently and retain separate reports without masking failures', () => {
    const live = workflow.match(/^  live:\n([\s\S]*?)^  gate:/m)[1];
    assert.match(live, /needs: \[changes, validate\]/);
    assert.match(live, /strategy:\n\s+fail-fast: false\n\s+matrix:/);
    assert.doesNotMatch(live, /continue-on-error:/);

    const selection = live.match(/suite: >-\s+\$\{\{ fromJSON\(format\('([^']+)',([\s\S]*?)\)\) }}/);
    assert.ok(selection, 'Optional suites must be independently selected');
    for (const [index, suite] of ['integration', 'handoff'].entries()) {
        assert.ok(
            selection[2].includes(`github.event_name == 'workflow_dispatch' && inputs.${suite} && ',"${suite}"' || ''`),
        );
        assert.ok(selection[1].includes(`{${index}}`));
    }
    for (const integration of [false, true]) {
        for (const handoff of [false, true]) {
            const suites = JSON.parse(
                selection[1]
                    .replace('{0}', integration ? ',"integration"' : '')
                    .replace('{1}', handoff ? ',"handoff"' : ''),
            );
            assert.deepEqual(suites, [
                'small',
                'adventureworks',
                ...(integration ? ['integration'] : []),
                ...(handoff ? ['handoff'] : []),
            ]);
        }
    }
    const requestedSuites = ['small', 'adventureworks', 'integration', 'handoff'];

    const evaluationSteps = [
        ...live.matchAll(
            /^      - name: Evaluate[^\n]*\n        if: matrix.suite == '([^']+)'[\s\S]*?^        run: (.+)$/gm,
        ),
    ];
    assert.equal(evaluationSteps.length, requestedSuites.length);
    for (const suite of requestedSuites) {
        assert.equal(
            evaluationSteps.filter(([, selectedSuite]) => selectedSuite === suite).length,
            1,
            `${suite} must run exactly one evaluation step regardless of the other suites' outcomes`,
        );
    }
    const commands = Object.fromEntries(evaluationSteps.map(([, suite, command]) => [suite, command]));
    assert.match(commands.small, /--tag category!=extended$/);
    assert.match(commands.adventureworks, /--tag category=extended --max-retries 0$/);
    assert.match(commands.integration, /--tag category=integration --max-retries 0$/);
    assert.equal(commands.handoff, 'npm run eval:handoff');
    assert.match(live, /- name: Publish reports\n\s+if: always\(\)/);
    assert.match(live, /SUITE: \$\{\{ matrix\.suite }}/);
    assert.match(live, /uses: actions\/upload-artifact@[^\n]+\n\s+if: always\(\)/);
    assert.match(live, /name: migration-vally-results-\$\{\{ matrix\.suite }}-\$\{\{ github\.run_attempt }}/);
});

test(
    'the aggregate gate rejects unsuccessful live matrices but permits intentional skips',
    {
        skip: process.platform === 'win32',
    },
    (t) => {
        const root = mkdtempSync(join(tmpdir(), 'migration-vally-gate-'));
        t.after(() => rmSync(root, { recursive: true, force: true }));
        const gate = workflow.match(/^  gate:\n([\s\S]*)/m)[1];
        assert.match(gate, /needs: \[changes, validate, live\]/);
        assert.match(gate, /if: always\(\)/);
        assert.match(gate, /LIVE_RESULT: \$\{\{ needs\.live\.result }}/);
        const script = gate.match(/        run: \|\n([\s\S]*)/)[1].replace(/^          /gm, '');

        function check(overrides, expectedStatus) {
            const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
                cwd: root,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    CHANGES_RESULT: 'success',
                    OFFLINE: 'true',
                    LIVE: 'true',
                    VALIDATION_RESULT: 'success',
                    LIVE_RESULT: 'success',
                    TRUSTED: 'true',
                    GITHUB_STEP_SUMMARY: join(root, 'summary'),
                    ...overrides,
                },
            });
            assert.ifError(result.error);
            assert.equal(
                result.status,
                expectedStatus,
                `${JSON.stringify(overrides)}: ${result.stdout}${result.stderr}`,
            );
        }

        check({}, 0);
        for (const result of ['failure', 'cancelled', 'skipped']) {
            check({ LIVE_RESULT: result }, 1);
        }
        check({ LIVE: 'false', LIVE_RESULT: 'skipped' }, 0);
        check({ TRUSTED: 'false', LIVE_RESULT: 'skipped' }, 0);
        check({ LIVE: 'false', LIVE_RESULT: 'success' }, 1);
    },
);
