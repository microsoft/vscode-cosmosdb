/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareFixture } from './fixtures.mjs';

function snapshot(root) {
    const files = new Map();
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
        const path = join(entry.parentPath, entry.name);
        assert.ok(!entry.isSymbolicLink(), `Unexpected symbolic link: ${path}`);
        if (entry.isFile()) {
            files.set(relative(root, path).split(sep).join('/'), readFileSync(path, 'utf8'));
        }
    }
    return files;
}

export async function checkArtifacts(workspace, phase, skillRoot) {
    const { checkPhaseCompletion } = await import(
        pathToFileURL(join(skillRoot, 'scripts/check-phase-completion.mjs')).href
    );
    const baseline = mkdtempSync(join(tmpdir(), 'migration-eval-baseline-'));
    try {
        await prepareFixture(baseline, phase, skillRoot);
        const before = snapshot(baseline);
        const after = snapshot(workspace);
        const projectPath = '.cosmosdb-migration/project.json';
        const project = JSON.parse(after.get(projectPath));
        const initial = JSON.parse(before.get(projectPath));
        assert.deepEqual(project.customMetadata, initial.customMetadata, 'Preserve unknown project properties');
        const applicationFiles = (files) =>
            [...files].filter(([path]) => !path.startsWith('.cosmosdb-migration/')).sort();
        assert.deepEqual(applicationFiles(after), applicationFiles(before), 'Application files changed');
        if (phase === 'provisioning') {
            const { buildProvisioningArtifacts } = await import(
                pathToFileURL(join(skillRoot, 'scripts/generate-provisioning-artifacts.mjs')).href
            );
            const provisioning = '.cosmosdb-migration/phases/4-provisioning';
            const mutable = new Set([
                projectPath,
                '.cosmosdb-migration/memory.md',
                ...['main.bicep', 'main.bicepparam', 'seed-data.csh', 'summary.md', 'manifest.json'].map(
                    (name) => `${provisioning}/${name}`,
                ),
            ]);
            for (const [path, content] of before) {
                if (!mutable.has(path))
                    assert.equal(after.get(path), content, `Supplied or predecessor artifact changed: ${path}`);
            }
            for (const path of after.keys()) {
                assert.ok(before.has(path) || mutable.has(path), `Out-of-phase artifact: ${path}`);
            }
            for (const [key, value] of Object.entries(initial)) {
                if (!['phases', 'freshness'].includes(key)) {
                    assert.deepEqual(project[key], value, `Changed project identity or metadata: ${key}`);
                }
            }
            for (const [key, value] of Object.entries(initial.phases)) {
                if (!['targetEnvironment', 'provisioning'].includes(key)) {
                    assert.deepEqual(project.phases[key], value, `Changed accepted phase state: ${key}`);
                }
            }
            for (const phaseName of ['preflight', 'discovery', 'assessment', 'schema-conversion']) {
                assert.deepEqual(
                    project.freshness?.[phaseName],
                    initial.freshness[phaseName],
                    `Changed upstream freshness: ${phaseName}`,
                );
                const result = checkPhaseCompletion(workspace, phaseName);
                assert.equal(result.complete, true, JSON.stringify(result, null, 2));
            }
            const target = project.phases.targetEnvironment;
            assert.equal(target?.databaseName, 'orders-next-target', 'Approved target database was not persisted');
            for (const [key, value] of Object.entries(initial.phases.targetEnvironment)) {
                if (!['databaseName', 'verified', 'verifiedAt'].includes(key)) {
                    assert.deepEqual(target[key], value, `Changed saved account coordinate: ${key}`);
                }
            }
            assert.notEqual(target.verified, true, 'Replacement target is not verified');
            if (target.verifiedAt !== undefined)
                assert.equal(
                    target.verifiedAt,
                    initial.phases.targetEnvironment.verifiedAt,
                    'Fabricated target verification time',
                );
            assert.equal(
                project.phases.provisioning.status,
                'in-progress',
                'Target switch must invalidate provisioning completion',
            );
            if (project.phases.provisioning.completedAt !== undefined)
                assert.equal(
                    project.phases.provisioning.completedAt,
                    initial.phases.provisioning.completedAt,
                    'Fabricated provisioning completion time',
                );
            if (project.freshness?.provisioning !== undefined) {
                assert.deepEqual(
                    project.freshness.provisioning,
                    initial.freshness.provisioning,
                    'Do not record fresh provisioning verification',
                );
            }
            const manifestPath = `${provisioning}/manifest.json`;
            const verification = after.has(manifestPath) ? JSON.parse(after.get(manifestPath)).verification : undefined;
            if (verification !== undefined) {
                assert.deepEqual(
                    verification,
                    JSON.parse(before.get(manifestPath)).verification,
                    'Historical readback must not be rewritten as new verification',
                );
            }
            const model = JSON.parse(before.get('.cosmosdb-migration/phases/3-schema-conversion/model.json'));
            const sampleData = JSON.parse(before.get(`${provisioning}/sample-data.json`));
            for (const [name, content] of Object.entries(buildProvisioningArtifacts(model, sampleData, project))) {
                assert.equal(
                    after.get(`${provisioning}/${name}`),
                    content,
                    `Target-dependent artifact was not regenerated: ${name}`,
                );
            }
            assert.ok(after.get(`${provisioning}/summary.md`)?.trim(), 'Missing provisioning summary');
            assert.notEqual(
                after.get(`${provisioning}/summary.md`),
                before.get(`${provisioning}/summary.md`),
                'Record the target-switch decision in the summary',
            );
            assert.equal(
                checkPhaseCompletion(workspace, 'provisioning').complete,
                false,
                'Artifact regeneration does not verify deployment',
            );
            return;
        }
        const discovery = '.cosmosdb-migration/phases/1-discovery';
        const immutable =
            phase === 'assessment'
                ? [...before.keys()].filter((path) => path.startsWith(`${discovery}/`))
                : [`${discovery}/schema-ddl/Schema.sql`];
        for (const path of immutable) {
            assert.equal(after.get(path), before.get(path), `Supplied or predecessor artifact changed: ${path}`);
        }
        assert.deepEqual(
            project.phases.schemaConversion,
            initial.phases.schemaConversion,
            'Advanced schema conversion',
        );
        assert.deepEqual(project.phases.provisioning, initial.phases.provisioning, 'Advanced provisioning');
        assert.deepEqual(project.phases.codeMigration, initial.phases.codeMigration, 'Advanced code migration');
        const phaseDirectory = phase === 'preflight' ? '1-discovery' : '2-assessment';
        for (const path of after.keys()) {
            assert.ok(
                before.has(path) ||
                    path === '.cosmosdb-migration/memory.md' ||
                    path.startsWith(`.cosmosdb-migration/phases/${phaseDirectory}/`),
                `Out-of-phase artifact: ${path}`,
            );
        }
        const result = checkPhaseCompletion(workspace, phase);
        assert.equal(result.complete, true, JSON.stringify(result, null, 2));
        const manifest = JSON.parse(after.get(`${discovery}/preflight-manifest.json`));
        assert.equal(Object.hasOwn(manifest, 'sdkCompatibility'), false, 'SDK compatibility is discovery-owned');
        assert.deepEqual(
            manifest.sourceInventory.tables.map(({ name }) => name),
            ['dbo.Orders'],
        );
        const [table] = manifest.sourceInventory.tables;
        assert.deepEqual(table.columns.map(({ name }) => name).sort(), ['Id', 'Pk', 'TenantId']);
        assert.deepEqual(table.primaryKey, ['Id']);
        if (phase === 'preflight') {
            assert.equal(project.phases.discovery.status, initial.phases.discovery.status, 'Advanced discovery');
            assert.deepEqual(project.phases.assessment, initial.phases.assessment, 'Advanced assessment');
        } else {
            assert.deepEqual(project.phases.discovery, initial.phases.discovery, 'Changed accepted discovery state');
            assert.deepEqual(project.phases.assessment.domains.flatMap(({ tables }) => tables).sort(), ['dbo.Orders']);
            assert.ok(project.phases.assessment.domains.every(({ isMapped }) => isMapped === true));
        }
    } finally {
        rmSync(baseline, { recursive: true, force: true });
    }
}

export function registerGraders(registry) {
    registry.register({
        metadata: {
            name: 'migration-artifacts',
            description: 'Validate migration artifacts using trusted helpers outside the agent workspace',
            behavior: { requiresWorkspace: true },
            determinism: 'complex-static',
            reference: 'reference-based',
            temporalScope: 'trajectory-level',
            costProfile: 'free',
        },
        async grade({ trajectory, config }) {
            assert.ok(trajectory?.workDir, 'Artifact grading requires a trial workspace');
            assert.ok(
                ['preflight', 'assessment', 'provisioning'].includes(config?.phase),
                'Unknown artifact grading phase',
            );
            try {
                await checkArtifacts(
                    join(trajectory.workDir, 'app'),
                    config.phase,
                    fileURLToPath(new URL('../../skills/cosmosdb-relational-migration/', import.meta.url)),
                );
                return {
                    name: 'migration-artifacts',
                    kind: 'code',
                    passed: true,
                    score: 1,
                    evidence: `${config.phase} artifact contract validates; supplied inputs and phase boundaries are preserved.`,
                };
            } catch (error) {
                return {
                    name: 'migration-artifacts',
                    kind: 'code',
                    passed: false,
                    score: 0,
                    evidence: error instanceof Error ? error.message : String(error),
                };
            }
        },
    });
}
