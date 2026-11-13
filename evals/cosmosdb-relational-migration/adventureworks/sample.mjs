/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sampleRepository = 'https://github.com/Azure-Samples/AdventureWorks.Web.git';
export const sampleRevision = 'd548c0ddb3e3a464fa34c1fdc39c2333506b42cc';
export const samplePath = fileURLToPath(new URL('../../../.vally/fixtures/adventureworks-web/', import.meta.url));

function git(directory, ...args) {
    return execFileSync(
        'git',
        ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null', '-C', directory, ...args],
        { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
}

export function verifySample(directory, revision = sampleRevision) {
    assert.equal(git(directory, 'rev-parse', 'HEAD'), revision, 'Sample checkout must match the pinned commit');
    assert.equal(
        git(directory, 'status', '--porcelain', '--untracked-files=all'),
        '',
        'Sample checkout has local changes',
    );
}

export function fetchSample(directory = samplePath, repository = sampleRepository, revision = sampleRevision) {
    assert.match(revision, /^[a-f0-9]{40}$/, 'Pin the sample to a full commit SHA');
    if (existsSync(directory)) {
        verifySample(directory, revision);
        return directory;
    }
    mkdirSync(dirname(directory), { recursive: true });
    const temporary = mkdtempSync(join(dirname(directory), '.adventureworks-fetch-'));
    try {
        git(temporary, 'init', '--quiet');
        git(temporary, 'fetch', '--depth=1', '--no-tags', repository, revision);
        git(temporary, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');
        verifySample(temporary, revision);
        renameSync(temporary, directory);
        return directory;
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}
