/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function prepareFixture(workspace, phase, skillRoot) {
    assert.ok(['preflight', 'assessment'].includes(phase), `Unknown artifact scenario: ${phase}`);
    const { sourceFixture, discoveryFixture } = await import(
        pathToFileURL(join(skillRoot, 'tests/source-evidence-fixtures.mjs')).href
    );
    const { buildFreshnessManifest } = await import(pathToFileURL(join(skillRoot, 'scripts/freshness.mjs')).href);
    const project = {
        version: 1,
        name: 'orders-eval',
        sourceCode: 'parent',
        customMetadata: { preserve: 'user-owned-value' },
        phases: {
            discovery: {
                status: 'not-started',
                preflightStatus: 'not-started',
                ddlParsing: { method: 'model', decisionSource: 'explicit' },
                applicationAnalysis: {
                    projectName: 'Orders',
                    projectType: 'service',
                    language: 'TypeScript',
                    databaseType: 'SQL Server',
                    databaseAccess: 'SQL',
                    completedAt: '2026-10-01T00:00:00.000Z',
                },
            },
            assessment: { status: 'not-started', domains: [] },
            schemaConversion: { status: 'not-started', domains: [] },
            provisioning: { status: 'not-started' },
            codeMigration: { status: 'not-started' },
        },
    };
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
        join(workspace, 'orders.ts'),
        "export const readOrder = 'SELECT Id, TenantId, Pk FROM dbo.Orders WHERE Id = @id';\n",
    );
    const inventory = sourceFixture(workspace, project);
    for (const path of ['volumetrics/volumetrics.md', 'access-patterns/access-patterns.md']) {
        const file = join(workspace, '.cosmosdb-migration/phases/1-discovery', path);
        writeFileSync(file, readFileSync(file, 'utf8').replaceAll('observed', 'synthetic evaluation input'));
    }
    project.freshness.preflight = buildFreshnessManifest(workspace, project, 'preflight');
    if (phase === 'assessment') {
        discoveryFixture(workspace, inventory, project, {
            patterns: [
                {
                    id: 'R001',
                    kind: 'read',
                    tables: ['dbo.Orders'],
                    sourcePaths: ['orders.ts'],
                    evidence: 'code',
                    tps: 10,
                    operation: 'SELECT Id, TenantId, Pk FROM dbo.Orders WHERE Id = @id',
                },
            ],
            noObservedAccess: [],
        });
        project.phases.discovery.status = 'complete';
    } else {
        // Leave supplied inputs, but no generated inventory or ready-made preflight answer.
        for (const name of ['preflight-summary.md', 'preflight-manifest.json']) {
            rmSync(join(workspace, '.cosmosdb-migration/phases/1-discovery', name));
        }
        delete project.freshness;
    }
    writeFileSync(join(workspace, '.cosmosdb-migration/project.json'), `${JSON.stringify(project, null, 2)}\n`);
    return { project, inventory };
}
