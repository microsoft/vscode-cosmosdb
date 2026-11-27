/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { applyEnvironment, loadEvalSpec, mergeResolvedEnvironments } from '@microsoft/vally';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkPhaseCompletion } from '../../skills/cosmosdb-migration/scripts/check-phase-completion.mjs';
import { buildFreshnessManifest } from '../../skills/cosmosdb-migration/scripts/freshness.mjs';
import { temporaryWorkspace } from './workspace.mjs';

test('staged TTL review artifacts fail independently and accept the two intended corrections', async (t) => {
    const stage = temporaryWorkspace();
    t.after(() => rmSync(stage, { recursive: true, force: true }));
    const specDir = join(import.meta.dirname, 'ttl');
    const spec = await loadEvalSpec(join(specDir, 'eval.yaml'));
    await applyEnvironment(mergeResolvedEnvironments(spec.environment, spec.stimuli[0].environment), stage, specDir);
    assert.deepEqual(readdirSync(stage).sort(), ['app', 'cosmosdb-best-practices', 'cosmosdb-migration']);
    assert.ok(!existsSync(join(stage, 'cosmosdb-migration/tests')), 'Do not expose the regression answer to the agent');

    const root = join(stage, 'app');
    const phases = join(root, '.cosmosdb-migration/phases');
    const samplePath = join(phases, '4-provisioning/sample-data.json');
    const manifestPath = join(phases, '3-schema-conversion/manifest.json');
    const validate = (script, args, expectedStatus) => {
        const validator = join(stage, 'cosmosdb-migration/scripts', script);
        const result = spawnSync(process.execPath, [validator, ...args], { encoding: 'utf8' });
        assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
        return JSON.parse(result.stdout).errors;
    };
    const conversion = (status) => validate('validate-conversion-evidence.mjs', [root], status);
    const samples = (status) =>
        validate(
            'validate-sample-data.mjs',
            ['--workspace', root, '--model', join(phases, '3-schema-conversion/model.json'), samplePath],
            status,
        );
    const checkpoint = () => checkPhaseCompletion(root, 'schema-conversion');
    const staged = checkpoint();
    assert.equal(staged.complete, false);
    assert.equal(staged.freshness, 'current', 'A stale hash must not give away the intended semantic failure');
    assert.deepEqual(
        staged.artifacts.filter((entry) => entry.state !== 'present' && !entry.conditional).map((entry) => entry.path),
        ['.cosmosdb-migration/phases/3-schema-conversion/manifest.json'],
    );
    const conversionErrors = conversion(1);
    const sampleErrors = samples(1);
    assert.equal(conversionErrors.length, 1);
    assert.match(conversionErrors[0].message, /every affected target/);
    assert.equal(sampleErrors.length, 1);
    assert.match(sampleErrors[0].message, /override must be declared/);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const examples = manifest.behaviorDecisions[0].examples;
    examples.push({ ...examples[0], container: 'OrdersByTenant', entity: 'OrderMembership' });
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const projectPath = join(root, '.cosmosdb-migration/project.json');
    const project = JSON.parse(readFileSync(projectPath, 'utf8'));
    project.freshness['schema-conversion'] = buildFreshnessManifest(root, project, 'schema-conversion');
    writeFileSync(projectPath, JSON.stringify(project));
    assert.deepEqual(conversion(0), []);
    const repaired = checkpoint();
    assert.ok(repaired.complete && repaired.freshness === 'current', JSON.stringify(repaired));
    assert.match(samples(1)[0].message, /override must be declared/);
    const sampleData = JSON.parse(readFileSync(samplePath, 'utf8'));
    delete sampleData.sampleData[0].items[0].ttl;
    writeFileSync(samplePath, JSON.stringify(sampleData));
    assert.deepEqual(samples(0), []);
    const source = JSON.parse(readFileSync(join(root, 'source.json'), 'utf8'));
    for (const { items } of sampleData.sampleData) {
        assert.ok(items.length >= 3 && items.length <= 5, 'Stage the provisioning quota for each standalone type');
        assert.equal(new Set(items.map((item) => item.id)).size, items.length);
        assert.ok(
            items.every((item) => item.sourceId !== source._id.$oid),
            'Seed data must not reuse source identities',
        );
    }
});
