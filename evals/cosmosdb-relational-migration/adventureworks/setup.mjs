/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializePrerequisites, phaseOrder } from './checkpoints.mjs';

export const plannedTarget = Object.freeze({
    type: 'provision',
    accountName: 'vally-adventureworks',
    databaseName: 'adventureworks-eval',
    location: 'eastus',
    verified: false,
});

export const workloadContent =
    JSON.stringify(
        {
            provenance: 'Synthetic evaluation assumptions, not production measurements or cardinality guarantees.',
            sourceDatabase: 'SQL Server',
            sourceCollation: 'SQL_Latin1_General_CP1_CI_AS',
            planningScope:
                'A development migration; preserve source semantics and record future verification obligations.',
            tables: [
                'dbo.BuildVersion',
                'dbo.ErrorLog',
                'SalesLT.Address',
                'SalesLT.Customer',
                'SalesLT.CustomerAddress',
                'SalesLT.Product',
                'SalesLT.ProductCategory',
                'SalesLT.ProductDescription',
                'SalesLT.ProductModel',
                'SalesLT.ProductModelProductDescription',
                'SalesLT.SalesOrderDetail',
                'SalesLT.SalesOrderHeader',
            ].map((table) => ({
                table,
                estimatedRows: 1000,
                estimatedAverageRowSizeKB: 2,
                estimatedMonthlyGrowthPercent: 5,
                estimatedReadTPS: 1,
                estimatedWriteTPS: 0.1,
                note: 'Obtain actual access paths from application evidence; absent access is not exclusion.',
            })),
        },
        null,
        2,
    ) + '\n';

export async function setupAdventureWorks(workspace, sample, schema, phase, roots) {
    assert.ok(sample, 'The evaluation runner must prepare MIGRATION_EVAL_ADVENTUREWORKS_SOURCE first');
    assert.ok(!existsSync(workspace), 'Refusing to overwrite an existing application workspace');
    cpSync(sample, workspace, { recursive: true, filter: (path) => basename(path) !== '.git' });
    const root = join(workspace, '.cosmosdb-migration');
    const discovery = join(root, 'phases/1-discovery');
    mkdirSync(join(discovery, 'volumetrics'), { recursive: true });
    if (schema) {
        mkdirSync(join(discovery, 'schema-ddl'), { recursive: true });
        cpSync(schema, join(discovery, 'schema-ddl/AdventureworksLT.sql'));
    }
    writeFileSync(join(discovery, 'volumetrics/workload.json'), workloadContent);
    writeFileSync(
        join(root, 'project.json'),
        JSON.stringify(
            {
                version: 1,
                name: 'AdventureWorksEvaluation',
                sourceCode: 'parent',
                customMetadata: { preserve: 'adventureworks-evaluation' },
                phases: {
                    discovery: {
                        status: 'not-started',
                        preflightStatus: 'not-started',
                        ddlParsing: { method: 'model', decisionSource: 'explicit' },
                    },
                    targetEnvironment: plannedTarget,
                },
            },
            null,
            2,
        ) + '\n',
    );
    if (phase) await materializePrerequisites(workspace, phase, roots);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const phase = phaseOrder.includes(process.argv[2]) ? process.argv[2] : undefined;
    assert.ok(phase || ['supplied', 'inferred'].includes(process.argv[2]), 'Expected a phase, supplied or inferred');
    await setupAdventureWorks(
        resolve('app'),
        process.env.MIGRATION_EVAL_ADVENTUREWORKS_SOURCE,
        process.argv[2] === 'inferred' ? undefined : resolve('AdventureworksLT.sql'),
        phase,
        { checkpointRoot: resolve('.checkpoints'), skillRoot: resolve('cosmosdb-relational-migration') },
    );
}
