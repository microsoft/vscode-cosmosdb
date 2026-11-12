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
            rowSizeUnit: 'Decimal KB: 1 KB = 1000 bytes.',
            rateInterpretation:
                'Hypothetical short busy-window table rates, not continuous averages or observed controller frequencies. Do not sum overlapping table accesses or derive net row growth from writes.',
            growthInterpretation:
                'Illustrative net monthly growth compounded over 12 months with unchanged average sizes; not a production forecast or retention policy.',
            planningScope:
                'A development migration; preserve source semantics and record future verification obligations.',
            tables: [
                { table: 'dbo.BuildVersion', rows: 1, sizeKB: 0.128, growth: 0, readTPS: 0.001, writeTPS: 0 },
                { table: 'dbo.ErrorLog', rows: 2000, sizeKB: 0.75, growth: 10, readTPS: 0.05, writeTPS: 0.2 },
                { table: 'SalesLT.Address', rows: 1500, sizeKB: 0.5, growth: 2, readTPS: 0.5, writeTPS: 0.02 },
                { table: 'SalesLT.Customer', rows: 1000, sizeKB: 1, growth: 2, readTPS: 5, writeTPS: 0.1 },
                {
                    table: 'SalesLT.CustomerAddress',
                    rows: 2000,
                    sizeKB: 0.128,
                    growth: 2,
                    readTPS: 0.2,
                    writeTPS: 0.02,
                },
                { table: 'SalesLT.Product', rows: 1000, sizeKB: 2, growth: 1, readTPS: 20, writeTPS: 0.2 },
                { table: 'SalesLT.ProductCategory', rows: 50, sizeKB: 0.128, growth: 0, readTPS: 25, writeTPS: 0.01 },
                { table: 'SalesLT.ProductDescription', rows: 1500, sizeKB: 0.5, growth: 1, readTPS: 1, writeTPS: 0.01 },
                { table: 'SalesLT.ProductModel', rows: 250, sizeKB: 1, growth: 1, readTPS: 25, writeTPS: 0.02 },
                {
                    table: 'SalesLT.ProductModelProductDescription',
                    rows: 2000,
                    sizeKB: 0.064,
                    growth: 1,
                    readTPS: 1,
                    writeTPS: 0.01,
                },
                { table: 'SalesLT.SalesOrderDetail', rows: 40000, sizeKB: 0.128, growth: 5, readTPS: 4, writeTPS: 0.8 },
                { table: 'SalesLT.SalesOrderHeader', rows: 10000, sizeKB: 1, growth: 5, readTPS: 2, writeTPS: 0.2 },
            ].map(({ table, rows, sizeKB, growth, readTPS, writeTPS }) => ({
                table,
                estimatedRows: rows,
                estimatedAverageRowSizeKB: sizeKB,
                estimatedMonthlyGrowthPercent: growth,
                estimatedReadTPS: readTPS,
                estimatedWriteTPS: writeTPS,
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
        { checkpointRoot: resolve('.checkpoints'), skillRoot: resolve('cosmosdb-migration') },
    );
}
