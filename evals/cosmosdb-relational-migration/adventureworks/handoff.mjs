/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { sha256 } from './checkpoints.mjs';

const migration = '.cosmosdb-migration/';

export function captureHandoffBaseline(workspace) {
    assert.ok(lstatSync(workspace).isDirectory(), 'Handoff input must be a regular directory');
    const files = {};
    for (const entry of readdirSync(workspace, { recursive: true, withFileTypes: true })) {
        assert.ok(!entry.isSymbolicLink(), 'Handoff input must not contain symlinks');
        if (!entry.isFile()) continue;
        const path = join(entry.parentPath, entry.name);
        files[relative(workspace, path).split(sep).join('/')] = sha256(readFileSync(path));
    }
    return {
        files,
        project: JSON.parse(readFileSync(join(workspace, migration, 'project.json'), 'utf8')),
    };
}

export function checkHandoffBoundary(workspace, baseline) {
    assert.ok(baseline, 'Handoff grading requires the host-captured conversion baseline');
    const actual = captureHandoffBaseline(workspace);
    const mutable = new Set([`${migration}project.json`, `${migration}memory.md`]);
    const outputs = new Set([`${migration}code-migration-plan.md`, `${migration}code-migration-manifest.json`]);
    for (const [path, hash] of Object.entries(baseline.files)) {
        if (!mutable.has(path)) assert.equal(actual.files[path], hash, `Changed handoff input: ${path}`);
    }
    for (const path of Object.keys(actual.files)) {
        assert.ok(
            path in baseline.files || mutable.has(path) || outputs.has(path),
            `Out-of-phase handoff artifact: ${path}`,
        );
    }
    for (const key of ['version', 'name', 'sourceCode', 'customMetadata', 'freshness']) {
        assert.deepEqual(actual.project[key], baseline.project[key], `Changed handoff project ${key}`);
    }
    for (const [phase, state] of Object.entries(baseline.project.phases)) {
        if (phase !== 'codeMigration')
            assert.deepEqual(actual.project.phases[phase], state, `Changed handoff phase: ${phase}`);
    }
}
