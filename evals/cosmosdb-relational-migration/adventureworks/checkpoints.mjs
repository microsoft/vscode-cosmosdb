/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sampleRevision } from './sample.mjs';

export const checkpointRoot = fileURLToPath(new URL('./checkpoints/', import.meta.url));
export const skillRoot = fileURLToPath(new URL('../../../skills/cosmosdb-relational-migration/', import.meta.url));
export const phaseOrder = [
    'preflight',
    'discovery',
    'assessment',
    'schema-conversion',
    'provisioning',
    'code-migration',
];
export const analyticalPhases = phaseOrder.slice(0, 4);
export const sha256 = (content) => createHash('sha256').update(content).digest('hex');

export function prerequisiteStages(phase) {
    assert.ok(phaseOrder.includes(phase), `Unknown isolated phase: ${phase}`);
    return analyticalPhases.slice(0, Math.min(phaseOrder.indexOf(phase), analyticalPhases.length));
}

export function readCheckpoint(stage, root = checkpointRoot) {
    assert.ok(analyticalPhases.includes(stage), `Unknown checkpoint: ${stage}`);
    const directory = join(root, stage);
    const checkpoint = JSON.parse(readFileSync(join(directory, 'checkpoint.json'), 'utf8'));
    assert.equal(checkpoint.version, 1, 'Unknown checkpoint format');
    assert.equal(checkpoint.phase, stage, 'Checkpoint phase mismatch');
    assert.equal(checkpoint.sourceRevision, sampleRevision, 'Checkpoint targets a different application revision');
    for (const [path, hash] of Object.entries(checkpoint.files)) {
        assert.ok(/^phases\/[123]-/.test(path) && !path.split('/').includes('..'), `Unsafe fixture path: ${path}`);
        const file = join(directory, path);
        assert.ok(lstatSync(file).isFile(), `Expected regular fixture file: ${path}`);
        assert.equal(sha256(readFileSync(file)), hash, `Checkpoint fixture changed without review: ${stage}/${path}`);
    }
    return checkpoint;
}

export async function materializePrerequisites(workspace, phase, roots = {}) {
    const fixtureRoot = roots.checkpointRoot ?? checkpointRoot;
    const scripts = join(roots.skillRoot ?? skillRoot, 'scripts');
    const stages = prerequisiteStages(phase);
    if (!stages.length) return;
    const migration = join(workspace, '.cosmosdb-migration');
    const checkpoints = stages.map((stage) => readCheckpoint(stage, fixtureRoot));
    for (const checkpoint of checkpoints) {
        assert.equal(
            sha256(readFileSync(join(migration, 'phases/1-discovery/schema-ddl/AdventureworksLT.sql'))),
            checkpoint.schemaSha256,
            'Checkpoint DDL differs from the versioned schema',
        );
        assert.equal(
            sha256(readFileSync(join(migration, 'phases/1-discovery/volumetrics/workload.json'))),
            checkpoint.workloadSha256,
            'Checkpoint workload differs from the versioned assumptions',
        );
        for (const path of Object.keys(checkpoint.files)) {
            const destination = join(migration, path);
            mkdirSync(dirname(destination), { recursive: true });
            cpSync(join(fixtureRoot, checkpoint.phase, path), destination);
        }
    }
    const project = structuredClone(checkpoints.at(-1).project);
    const projectPath = join(migration, 'project.json');
    const write = () => writeFileSync(projectPath, JSON.stringify(project, null, 2) + '\n');
    write();
    const { buildFreshnessManifest } = await import(pathToFileURL(join(scripts, 'freshness.mjs')).href);
    const { checkPhaseCompletions } = await import(pathToFileURL(join(scripts, 'check-phase-completion.mjs')).href);
    project.freshness = {};
    for (const checkpoint of checkpoints) {
        project.freshness[checkpoint.phase] = buildFreshnessManifest(
            resolve(workspace),
            project,
            checkpoint.phase,
            checkpoint.consulted,
        );
        write();
    }
    const results = checkPhaseCompletions(resolve(workspace), stages);
    for (const stage of stages) {
        assert.equal(results[stage].complete, true, `Invalid ${stage} fixture: ${JSON.stringify(results[stage])}`);
    }
}
