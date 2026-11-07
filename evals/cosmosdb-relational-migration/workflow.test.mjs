/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

test('CI runs models only for skill changes or manual dispatch', { skip: process.platform === 'win32' }, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'migration-vally-workflow-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const workflow = readFileSync(new URL('../../.github/workflows/migration-evals.yml', import.meta.url), 'utf8');
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
