/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { filterStimuli, loadEvalSpec } from '@microsoft/vally';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { acceptedTrial, handoffSpec, runHandoff } from '../../scripts/eval-handoff.mjs';
import { resolveEvalSelection } from '../../scripts/eval-options.mjs';
import { checkPhaseCompletions } from '../../skills/cosmosdb-relational-migration/scripts/check-phase-completion.mjs';
import {
    applicationSnapshot,
    checkAdventureWorks,
    checkAdventureWorksInventory,
    checkControllerCoverage,
    checkPlanningBoundary,
    checkPhaseBoundary,
} from './adventureworks/check-artifacts.mjs';
import {
    analyticalPhases,
    checkpointRoot,
    materializePrerequisites,
    phaseOrder,
    prerequisiteStages,
    readCheckpoint,
    sha256,
} from './adventureworks/checkpoints.mjs';
import { captureHandoffBaseline, checkHandoffBoundary } from './adventureworks/handoff.mjs';
import { judgeEvidenceGroups } from './adventureworks/judge-evidence.mjs';
import { checkPlanTasks } from './adventureworks/plan-contract.mjs';
import { fetchSample, verifySample } from './adventureworks/sample.mjs';
import { setupAdventureWorks, workloadContent } from './adventureworks/setup.mjs';

const ddl = fileURLToPath(new URL('./adventureworks/AdventureworksLT.sql', import.meta.url));

function temporary(t) {
    const root = mkdtempSync(join(tmpdir(), 'adventureworks-eval-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

function schemaInventory() {
    return JSON.parse(
        readFileSync(
            new URL(
                './adventureworks/checkpoints/preflight/phases/1-discovery/preflight-manifest.json',
                import.meta.url,
            ),
            'utf8',
        ),
    ).sourceInventory;
}

const taskPlan = `# Plan
## Ordered Changes
- [ ] CM-01 (pending): Implement the selected protocol.
  - Depends on: none.
  - Done when: The selected primitive and recovery behavior are implemented.
- [ ] CM-02 (pending): Verify behavior in the isolated test environment.
  - Depends on: CM-01.
  - Done when: Required fault and parity tests pass.
## Operational Handoff
- [ ] OP-01 (pending): Verify production readiness.
  - Depends on: CM-02.
  - Done when: Production configuration and writer inventory are verified.
`;

test('plan task grading rejects omitted prerequisites, cycles and premature execution claims', () => {
    assert.equal(checkPlanTasks(taskPlan).size, 3);
    for (const [name, changed] of [
        [
            'missing tasks',
            taskPlan.replace(
                /## Ordered Changes[\s\S]*?## Operational Handoff/,
                '## Ordered Changes\nImplementation later.\n## Operational Handoff',
            ),
        ],
        ['unknown dependency', taskPlan.replace('Depends on: CM-01.', 'Depends on: CM-99.')],
        ['self dependency', taskPlan.replace('Depends on: CM-01.', 'Depends on: CM-02.')],
        ['cycle', taskPlan.replace('Depends on: none.', 'Depends on: CM-02.')],
        ['production gating code', taskPlan.replace('Depends on: CM-01.', 'Depends on: OP-01.')],
        ['missing dependencies', taskPlan.replace('  - Depends on: none.\n', '')],
        ['missing condition', taskPlan.replace('  - Done when: Required fault and parity tests pass.\n', '')],
        ['duplicate task ID', taskPlan.replace('CM-02 (pending)', 'CM-01 (pending)')],
        ['claimed execution', taskPlan.replace('[ ] CM-01 (pending)', '[x] CM-01 (complete)')],
    ]) {
        assert.throws(() => checkPlanTasks(changed), undefined, name);
    }
    assert.equal(
        checkPlanTasks(taskPlan + '\n```md\n- [x] OP-999 (complete): Illustrative example only\n```\n').size,
        3,
    );
});

test('handoff baseline freezes fresh artifacts, project identity and predecessor freshness', (t) => {
    const root = temporary(t);
    const migration = join(root, '.cosmosdb-migration');
    mkdirSync(join(migration, 'phases/3-schema-conversion'), { recursive: true });
    writeFileSync(join(migration, 'phases/3-schema-conversion/model.json'), '{"fresh":"not a checked-in model"}');
    const project = {
        name: 'fresh',
        freshness: { conversion: 'original' },
        phases: { schemaConversion: { status: 'complete' }, codeMigration: { status: 'not-started' } },
    };
    const path = join(migration, 'project.json');
    writeFileSync(path, JSON.stringify(project));
    const baseline = captureHandoffBaseline(root);
    project.phases.codeMigration.status = 'complete';
    writeFileSync(path, JSON.stringify(project));
    writeFileSync(join(migration, 'code-migration-plan.md'), taskPlan);
    checkHandoffBoundary(root, baseline);
    assert.throws(() => checkHandoffBoundary(root), /host-captured/);
    project.freshness.conversion = 'rebased';
    writeFileSync(path, JSON.stringify(project));
    assert.throws(() => checkHandoffBoundary(root, baseline), /freshness/);
    project.freshness.conversion = 'original';
    writeFileSync(path, JSON.stringify(project));
    writeFileSync(join(migration, 'phases/3-schema-conversion/model.json'), '{"fixture":"substitution"}');
    assert.throws(() => checkHandoffBoundary(root, baseline), /Changed handoff input/);
});

test('handoff refuses skipped or failed grading even when the process succeeds', (t) => {
    const root = temporary(t);
    const path = join(root, 'results.jsonl');
    writeFileSync(path, JSON.stringify({ type: 'run-summary', passed: true }) + '\n');
    assert.throws(() => acceptedTrial(root), /exactly one trial/);
    writeFileSync(
        path,
        JSON.stringify({ type: 'trial-result', status: 'success', gradeResult: { passed: false } }) + '\n',
    );
    assert.throws(() => acceptedTrial(root), /required grader/);
});

test('handoff reuses phase specifications in separate bounded sessions without reference substitution', async (t) => {
    const root = temporary(t);
    const sample = fixtureSource(root);
    const original = await loadEvalSpec(join(import.meta.dirname, 'adventureworks/eval.yaml'));
    const converted = handoffSpec(original, 'schema-conversion');
    assert.equal(converted.stimuli[0].constraints.max_duration, '45m');
    assert.equal(converted.defaults.model, original.defaults.model);
    let calls = 0;
    const output = await runHandoff({
        sample,
        outputRoot: join(root, 'results'),
        async execute(_exe, args, options) {
            calls++;
            assert.equal(args[args.indexOf('--max-retries') + 1], '0');
            const spec = await loadEvalSpec(args[args.indexOf('--eval-spec') + 1]);
            assert.equal(spec.stimuli.length, 1);
            const stimulus = spec.stimuli[0];
            const app = join(args[args.indexOf('--workspace') + 1], 'main', stimulus.name, 'app');
            if (calls === 1) {
                assert.equal(stimulus.tags.phase, 'schema-conversion');
                await setupAdventureWorks(app, sample, ddl, 'provisioning');
                const summary = join(app, '.cosmosdb-migration/phases/3-schema-conversion/summary.md');
                writeFileSync(summary, readFileSync(summary, 'utf8') + '\nFresh handoff output.\n');
            } else {
                assert.equal(stimulus.tags.scenario, 'handoff-planning');
                assert.equal(spec.defaults.timeout, '20m');
                assert.deepEqual(stimulus.environment.commands, []);
                assert.deepEqual(stimulus.environment.files, [
                    { src: options.env.MIGRATION_EVAL_HANDOFF_BASELINE, dest: 'app' },
                ]);
                cpSync(options.env.MIGRATION_EVAL_HANDOFF_BASELINE, app, { recursive: true });
                const migration = join(app, '.cosmosdb-migration');
                assert.match(
                    readFileSync(join(migration, 'phases/3-schema-conversion/summary.md'), 'utf8'),
                    /Fresh handoff output/,
                );
                const projectPath = join(migration, 'project.json');
                const project = JSON.parse(readFileSync(projectPath, 'utf8'));
                project.phases.codeMigration = {
                    status: 'complete',
                    planPath: '.cosmosdb-migration/code-migration-plan.md',
                    completedAt: '2026-11-09T00:00:00.000Z',
                };
                const discovery = JSON.parse(
                    readFileSync(join(migration, 'phases/1-discovery/discovery-manifest.json'), 'utf8'),
                );
                const plan =
                    taskPlan +
                    [
                        'Overview',
                        'Affected Files',
                        'Access Pattern Migration',
                        'Configuration and Authentication',
                        'Validation',
                        'Rollback',
                    ]
                        .map((heading) => `\n## ${heading}\nSynthetic offline wiring evidence.\n`)
                        .join('') +
                    '\n## Applied Rules\nrules/model-unique-keys.md\n## Blocker Review\nNo candidate blockers.\n## Unresolved Blockers\nNone.\n';
                writeFileSync(join(migration, 'code-migration-plan.md'), plan);
                writeFileSync(
                    join(migration, 'code-migration-manifest.json'),
                    JSON.stringify({
                        version: 1,
                        mode: 'plan',
                        modelSha256: sha256(readFileSync(join(migration, 'phases/3-schema-conversion/model.json'))),
                        sdkReportSha256: sha256(JSON.stringify(discovery.sdkCompatibility, null, 2) + '\n'),
                        bestPractices: { rules: ['rules/model-unique-keys.md'], unresolvedConcerns: [] },
                        outputFiles: [],
                        blockingSteps: [],
                        validation: [],
                    }),
                );
                writeFileSync(projectPath, JSON.stringify(project));
            }
            const results = args[args.indexOf('--output-dir') + 1];
            mkdirSync(results, { recursive: true });
            writeFileSync(
                join(results, 'results.jsonl'),
                JSON.stringify({
                    type: 'trial-result',
                    status: 'success',
                    stimulus: stimulus.name,
                    itemId: String(calls),
                    model: 'offline',
                    gradeResult: { passed: true },
                }) + '\n',
            );
            return { status: 0 };
        },
    });
    assert.equal(calls, 2);
    const lineage = JSON.parse(readFileSync(join(output, 'handoff.json'), 'utf8'));
    assert.equal(lineage.status, 'passed');
    assert.equal(lineage.phases.length, 2);
    assert.match(lineage.sourceModelSha256, /^[a-f0-9]{64}$/);
    calls = 0;
    await assert.rejects(
        runHandoff({
            sample,
            outputRoot: join(root, 'failed'),
            execute() {
                calls++;
                return { status: 1 };
            },
        }),
        /later phases will not run/,
    );
    assert.equal(calls, 1);
});

test('synthetic workload fits source key domains and relationship populations', () => {
    const workload = JSON.parse(workloadContent);
    const schema = JSON.parse(readFileSync(new URL('./adventureworks/schema-contract.json', import.meta.url), 'utf8'));
    const rows = new Map(workload.tables.map((row) => [row.table, row]));
    assert.deepEqual(workload.tables.map(({ table }) => table).sort(), Object.keys(schema).sort());
    assert.match(workload.provenance, /Synthetic.*not production measurements/);
    assert.match(workload.rowSizeUnit, /1 KB = 1000 bytes/);
    assert.match(workload.rateInterpretation, /not continuous averages/);
    const keyCardinality = { BIT: 2, TINYINT: 256, SMALLINT: 2 ** 16, INT: 2 ** 32 };
    for (const [table, definition] of Object.entries(schema)) {
        const row = rows.get(table);
        assert.ok(Number.isSafeInteger(row.estimatedRows) && row.estimatedRows >= 0, table);
        assert.ok(Number.isFinite(row.estimatedAverageRowSizeKB) && row.estimatedAverageRowSizeKB > 0, table);
        for (const field of ['estimatedMonthlyGrowthPercent', 'estimatedReadTPS', 'estimatedWriteTPS']) {
            assert.ok(Number.isFinite(row[field]) && row[field] >= 0, `${table}.${field}`);
        }
        if (definition.primaryKey.length === 1) {
            const column = definition.columns.find(({ name }) => name === definition.primaryKey[0]);
            const maximum = keyCardinality[column.type];
            if (maximum !== undefined) {
                assert.ok(row.estimatedRows <= maximum, `${table}: estimated rows exceed the key domain`);
                assert.ok(
                    row.estimatedRows * (1 + row.estimatedMonthlyGrowthPercent / 100) ** 12 <= maximum,
                    `${table}: twelve-month projection exceeds the key domain`,
                );
            }
        }
        const keyReferences = definition.foreignKeys.filter((key) =>
            key.columns.every((column) => definition.primaryKey.includes(column)),
        );
        const referencedColumns = new Set(keyReferences.flatMap((key) => key.columns));
        if (definition.primaryKey.every((column) => referencedColumns.has(column))) {
            const possibleKeys = keyReferences.reduce(
                (count, key) => count * rows.get(key.referencedTable).estimatedRows,
                1,
            );
            assert.ok(
                row.estimatedRows <= possibleKeys,
                `${table}: link population exceeds available parent combinations`,
            );
        }
    }
});

test('snapshot volumetrics and root payload estimates match the workload profile', () => {
    const workload = JSON.parse(workloadContent);
    const preflight = readCheckpoint('preflight');
    const manifest = JSON.parse(
        readFileSync(join(checkpointRoot, 'preflight/phases/1-discovery/preflight-manifest.json'), 'utf8'),
    );
    assert.equal(manifest.workloadInputs[0].sha256, preflight.workloadSha256);
    const markdown = readFileSync(
        join(checkpointRoot, 'preflight/phases/1-discovery/volumetrics/volumetrics.md'),
        'utf8',
    );
    const rows = new Map(
        markdown
            .split('\n')
            .filter((line) => /^\| \d+ \|/.test(line))
            .map((line) => {
                const cells = line
                    .split('|')
                    .slice(1, -1)
                    .map((cell) => cell.trim());
                return [
                    `${cells[1]}.${cells[2]}`,
                    cells.slice(3, 8).map((cell) => {
                        const match = /^(\d+(?:\.\d+)?)%? \(estimated\)$/.exec(cell);
                        assert.ok(match, `Expected a labeled synthetic value: ${cell}`);
                        return Number(match[1]);
                    }),
                ];
            }),
    );
    assert.equal(rows.size, workload.tables.length);
    for (const row of workload.tables) {
        assert.deepEqual(
            rows.get(row.table),
            [
                row.estimatedRows,
                row.estimatedAverageRowSizeKB,
                row.estimatedMonthlyGrowthPercent,
                row.estimatedReadTPS,
                row.estimatedWriteTPS,
            ],
            row.table,
        );
    }
    const summary = readFileSync(
        join(checkpointRoot, 'schema-conversion/phases/3-schema-conversion/summary.md'),
        'utf8',
    );
    for (const domain of readCheckpoint('assessment').project.phases.assessment.domains) {
        const line = summary.split('\n').find((line) => line.startsWith(`| ${domain.name}:`));
        assert.ok(line, `Missing ${domain.name} payload estimate`);
        const cells = line
            .split('|')
            .slice(1, -1)
            .map((cell) => cell.trim());
        const inputs = workload.tables.filter(({ table }) => domain.tables.includes(table));
        for (const [position, months] of [
            [1, 0],
            [2, 12],
        ]) {
            const bytes = inputs.reduce(
                (sum, row) =>
                    sum +
                    row.estimatedRows *
                        row.estimatedAverageRowSizeKB *
                        1000 *
                        (1 + row.estimatedMonthlyGrowthPercent / 100) ** months,
                0,
            );
            assert.equal(
                cells[position],
                `about ${(bytes / 1024 ** 2).toFixed(2)} MiB`,
                `${domain.name}: ${months} months`,
            );
        }
    }
});

test('pinned checkout is fetched once, reused offline, and never resets modified files', (t) => {
    const root = temporary(t);
    const source = join(root, 'source');
    const cache = join(root, 'cache');
    mkdirSync(source);
    const git = (...args) =>
        execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '--quiet');
    writeFileSync(join(source, 'sample.txt'), 'original');
    git('add', 'sample.txt');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Fixture');
    const revision = git('rev-parse', 'HEAD');
    assert.equal(fetchSample(cache, source, revision), cache);
    rmSync(source, { recursive: true });
    assert.equal(fetchSample(cache, source, revision), cache, 'Cached use must not fetch the now-absent source');
    assert.throws(() => fetchSample(cache, source, '0'.repeat(40)), /pinned commit/);
    writeFileSync(join(cache, 'sample.txt'), 'user edit');
    assert.throws(() => verifySample(cache, revision), /local changes/);
    assert.throws(() => fetchSample(cache, source, revision), /local changes/);
    assert.equal(readFileSync(join(cache, 'sample.txt'), 'utf8'), 'user edit');
});

test('fixture setup copies source and optional DDL without leaking DDL into inference', async (t) => {
    const root = temporary(t);
    const source = join(root, 'source');
    mkdirSync(join(source, '.git'), { recursive: true });
    writeFileSync(join(source, 'model.cs'), 'synthetic source');
    writeFileSync(join(source, 'LICENSE.md'), 'synthetic license');
    const supplied = join(root, 'supplied');
    const inferred = join(root, 'inferred');
    await setupAdventureWorks(supplied, source, ddl);
    await setupAdventureWorks(inferred, source);
    assert.deepEqual(applicationSnapshot(supplied), applicationSnapshot(source));
    assert.deepEqual(applicationSnapshot(inferred), applicationSnapshot(source));
    assert.equal(existsSync(join(supplied, '.git')), false);
    assert.deepEqual(
        readFileSync(join(supplied, '.cosmosdb-migration/phases/1-discovery/schema-ddl/AdventureworksLT.sql')),
        readFileSync(ddl),
    );
    assert.equal(existsSync(join(inferred, '.cosmosdb-migration/phases/1-discovery/schema-ddl')), false);
    await assert.rejects(setupAdventureWorks(supplied, source, ddl), /overwrite/);
    writeFileSync(join(supplied, '.cosmosdb-migration/phases/1-discovery/volumetrics/workload.json'), '{}');
    assert.throws(() => checkAdventureWorks(supplied, 'supplied-ddl', source), /workload evidence changed/);
});

function fixtureSource(root) {
    const source = join(root, 'sample');
    mkdirSync(source);
    // These placeholders exercise materialization/path contracts, not live application interpretation.
    for (const stage of analyticalPhases) {
        for (const path of readCheckpoint(stage).consulted.filter((path) => !path.startsWith('.cosmosdb-migration/'))) {
            const file = join(source, path);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, `Synthetic offline source for ${path}\n`);
        }
    }
    return source;
}

for (const phase of phaseOrder) {
    test(`${phase}: only validated predecessors are staged; current outputs are absent`, async (t) => {
        const root = temporary(t);
        const sample = fixtureSource(root);
        const app = join(root, 'app');
        await setupAdventureWorks(app, sample, ddl, phase);
        const results = checkPhaseCompletions(app, [...prerequisiteStages(phase), phase]);
        for (const predecessor of prerequisiteStages(phase)) assert.equal(results[predecessor].complete, true);
        assert.equal(results[phase].complete, false);
        const projectPath = join(app, '.cosmosdb-migration/project.json');
        const project = JSON.parse(readFileSync(projectPath, 'utf8'));
        checkPhaseBoundary(app, phase, project);
        assert.throws(() => checkAdventureWorks(app, phase, sample));
        if (analyticalPhases.includes(phase)) {
            await materializePrerequisites(app, phaseOrder[phaseOrder.indexOf(phase) + 1]);
            checkAdventureWorks(app, phase, sample);
        }
    });
}

test('isolated grading rejects predecessor mutations and future-phase artifacts', async (t) => {
    const root = temporary(t);
    const sample = fixtureSource(root);
    const app = join(root, 'app');
    await setupAdventureWorks(app, sample, ddl, 'provisioning');
    const migration = join(app, '.cosmosdb-migration');
    const project = JSON.parse(readFileSync(join(migration, 'project.json'), 'utf8'));
    checkPhaseBoundary(app, 'provisioning', project);
    writeFileSync(join(migration, 'code-migration-plan.md'), 'Premature plan');
    assert.throws(() => checkPhaseBoundary(app, 'provisioning', project), /Out-of-phase artifact/);
    rmSync(join(migration, 'code-migration-plan.md'));
    project.phases.assessment.domains[0].isMapped = false;
    assert.throws(() => checkPhaseBoundary(app, 'provisioning', project), /predecessor phase state/);
    project.phases.assessment.domains[0].isMapped = true;
    writeFileSync(join(migration, 'phases/3-schema-conversion/summary.md'), 'Changed accepted design');
    assert.throws(() => checkPhaseBoundary(app, 'provisioning', project), /predecessor artifact/);
});

test('checkpoint drift fails before an agent can use it', async (t) => {
    const root = temporary(t);
    const fixtures = join(root, 'fixtures');
    cpSync(join(checkpointRoot, 'preflight'), join(fixtures, 'preflight'), { recursive: true });
    writeFileSync(join(fixtures, 'preflight/phases/1-discovery/preflight-summary.md'), 'Unreviewed edit');
    assert.throws(() => readCheckpoint('preflight', fixtures), /changed without review/);
    const sample = fixtureSource(root);
    const app = join(root, 'app');
    await setupAdventureWorks(app, sample, ddl);
    writeFileSync(join(app, '.cosmosdb-migration/phases/1-discovery/schema-ddl/AdventureworksLT.sql'), 'changed DDL');
    await assert.rejects(materializePrerequisites(app, 'discovery'), /DDL differs/);
});

test('integration is opt-in and each extended phase has a separate session and budget', async () => {
    const phases = await loadEvalSpec(fileURLToPath(new URL('./adventureworks/eval.yaml', import.meta.url)));
    const integration = await loadEvalSpec(
        fileURLToPath(new URL('./adventureworks/integration/eval.yaml', import.meta.url)),
    );
    const count = (spec, args) =>
        filterStimuli(spec.stimuli, spec.tags, resolveEvalSelection(args).filter).matched.length;
    assert.equal(count(phases, []), 7);
    assert.equal(count(integration, []), 0);
    assert.equal(count(integration, ['--tag', 'sample=adventureworks']), 0);
    assert.equal(count(integration, ['--tag', 'category!=extended']), 0);
    assert.equal(count(integration, ['--tag=category=integration']), 1);
    assert.equal(count(phases, ['--tag', 'category=integration']), 0);
    assert.equal(count(phases, ['--tag', 'phase=provisioning']), 1);
    for (const stimulus of phases.stimuli) {
        const judge = stimulus.graders.find(({ type }) => type === 'adventureworks-judge').config;
        assert.equal(judge.scoring, 'binary');
        assert.equal(judge.threshold, 1);
        assert.ok(judge.prompt?.length);
        const groups = judgeEvidenceGroups(stimulus, judge);
        assert.deepEqual(
            groups.flatMap(({ indices }) => indices).sort((a, b) => a - b),
            stimulus.rubric.map((_, index) => index),
        );
    }
    for (const phase of phaseOrder) {
        const stimulus = phases.stimuli.find((entry) => entry.tags.phase === phase);
        assert.equal(stimulus.turns, undefined, 'Independent phases must not share conversation history');
        assert.equal(
            stimulus.constraints?.max_duration ?? phases.defaults.timeout,
            phase === 'schema-conversion' ? '45m' : '20m',
        );
        const staged = (stimulus.environment?.files ?? []).filter(({ src }) => src.startsWith('checkpoints/'));
        assert.deepEqual(
            staged.map(({ src }) => src.slice('checkpoints/'.length)),
            prerequisiteStages(phase),
        );
    }
});

test('independent inventory checks accept quoted references and reject lost relational structure', () => {
    const inventory = schemaInventory();
    for (const table of inventory.tables) {
        for (const key of table.foreignKeys)
            key.referencedTable = key.referencedTable
                .split('.')
                .map((part) => `[${part}]`)
                .join('.');
    }
    checkAdventureWorksInventory(inventory);
    for (const mutate of [
        (value) => value.tables.pop(),
        (value) => value.tables.find(({ name }) => name === 'SalesLT.Product').columns.pop(),
        (value) => value.tables.find(({ name }) => name === 'SalesLT.CustomerAddress').primaryKey.reverse(),
        (value) => value.tables.find(({ name }) => name === 'SalesLT.ProductCategory').foreignKeys.splice(0),
        (value) => {
            value.tables.find(({ name }) => name === 'SalesLT.SalesOrderHeader').foreignKeys[0].columns = [
                'ShipToAddressID',
            ];
        },
    ]) {
        const changed = structuredClone(inventory);
        mutate(changed);
        assert.throws(() => checkAdventureWorksInventory(changed));
    }
});

test('source semantics accept equivalent type/facet and global/per-table index representations', () => {
    const inventory = schemaInventory();
    const product = inventory.tables.find(({ name }) => name === 'SalesLT.Product');
    Object.assign(
        product.columns.find(({ name }) => name === 'Name'),
        {
            type: ' [dbo].[Name] ',
            resolvedType: '[sys].[nvarchar] ( 50 )',
            nullable: 'NOT NULL',
        },
    );
    Object.assign(
        product.columns.find(({ name }) => name === 'Weight'),
        {
            type: ' numeric ',
            precision: '8',
            scale: '2',
            nullable: 'YES',
        },
    );
    Object.assign(
        product.columns.find(({ name }) => name === 'ThumbNailPhoto'),
        {
            type: 'varbinary',
            maxLength: 'MAX',
        },
    );
    const customer = inventory.tables.find(({ name }) => name === 'SalesLT.Customer');
    Object.assign(
        customer.columns.find(({ name }) => name === 'PasswordHash'),
        {
            type: 'VARCHAR',
            length: 128,
        },
    );
    for (const table of inventory.tables) {
        table.indexes = inventory.indexes
            .filter((index) => index.table === table.name)
            .map(({ keys, unique, ...index }) => ({
                ...index,
                keyColumns: keys.map((column) => ({ column: `[${column}]` })),
                isUnique: unique ? 'YES' : 'NO',
            }));
        for (const key of table.foreignKeys)
            key.onDelete = key.onDelete.replace('NO ACTION (implicit)', 'no_action (default)');
    }
    delete inventory.indexes;
    checkAdventureWorksInventory(inventory);
    for (const table of inventory.tables) {
        table.uniqueConstraints = table.indexes
            .filter(({ isUnique }) => isUnique === 'YES')
            .map(({ isUnique, ...index }) => index);
        table.indexes = table.indexes.filter(({ isUnique }) => isUnique === 'NO');
    }
    checkAdventureWorksInventory(inventory);
});

test('source semantics reject corrupt or missing column facts', async (t) => {
    const column = (inventory, table, name) =>
        inventory.tables.find((entry) => entry.name === table).columns.find((entry) => entry.name === name);
    for (const [name, mutate] of [
        [
            'MONEY changed to BIT',
            (inventory) => {
                column(inventory, 'SalesLT.Product', 'ListPrice').type = 'BIT';
            },
        ],
        [
            'length narrowed',
            (inventory) => {
                column(inventory, 'SalesLT.Customer', 'PasswordHash').type = 'VARCHAR(64)';
            },
        ],
        [
            'binary MAX bounded',
            (inventory) => {
                column(inventory, 'SalesLT.Product', 'ThumbNailPhoto').type = 'VARBINARY(8000)';
            },
        ],
        [
            'decimal precision changed',
            (inventory) => {
                column(inventory, 'SalesLT.Product', 'Weight').type = 'DECIMAL(9,2)';
            },
        ],
        [
            'decimal scale changed',
            (inventory) => {
                column(inventory, 'SalesLT.Product', 'Weight').type = 'NUMERIC(8,3)';
            },
        ],
        [
            'contradictory precision',
            (inventory) => {
                column(inventory, 'SalesLT.Product', 'Weight').precision = 6;
            },
        ],
        [
            'contradictory scale',
            (inventory) => {
                column(inventory, 'SalesLT.Product', 'Weight').scale = 4;
            },
        ],
        [
            'incorrect MONEY scale',
            (inventory) => {
                column(inventory, 'SalesLT.Product', 'ListPrice').scale = 2;
            },
        ],
        [
            'incorrect alias resolution',
            (inventory) => {
                column(inventory, 'SalesLT.Product', 'Name').resolvedType = 'NVARCHAR(10)';
            },
        ],
        [
            'required column made nullable',
            (inventory) => {
                column(inventory, 'SalesLT.Product', 'ListPrice').nullable = true;
            },
        ],
        [
            'optional column made required',
            (inventory) => {
                column(inventory, 'SalesLT.Product', 'ProductCategoryID').nullable = false;
            },
        ],
        [
            'missing nullability',
            (inventory) => {
                delete column(inventory, 'SalesLT.Product', 'Color').nullable;
            },
        ],
        [
            'contradictory nullability flags',
            (inventory) => {
                column(inventory, 'SalesLT.Product', 'Color').isNullable = false;
            },
        ],
        [
            'computed mapped type changed',
            (inventory) => {
                column(inventory, 'SalesLT.SalesOrderDetail', 'LineTotal').efType = 'DECIMAL(10,2)';
            },
        ],
    ]) {
        await t.test(name, () => {
            const inventory = schemaInventory();
            mutate(inventory);
            assert.throws(
                () => checkAdventureWorksInventory(inventory),
                /type|length|precision|scale|nullability|nullable/i,
            );
        });
    }
});

test('source semantics require supplied FK actions but preserve genuine inference uncertainty', () => {
    const inventory = schemaInventory();
    const detail = inventory.tables.find(({ name }) => name === 'SalesLT.SalesOrderDetail');
    const cascade = detail.foreignKeys.find(({ columns }) => columns.includes('SalesOrderID'));
    cascade.onDelete = 'NO ACTION';
    assert.throws(() => checkAdventureWorksInventory(inventory), /delete action/);
    assert.throws(() => checkAdventureWorksInventory(inventory, { source: 'inferred' }), /delete action/);
    cascade.onDelete = 'UNKNOWN';
    assert.throws(() => checkAdventureWorksInventory(inventory), /delete action/);
    checkAdventureWorksInventory(inventory, { source: 'inferred' });
    delete cascade.onDelete;
    cascade.deleteBehavior = 'Required EF relationship convention; live database action is unknown.';
    inventory.files.forEach((file) => {
        file.origin = 'inferred';
    });
    assert.throws(() => checkAdventureWorksInventory(inventory), /delete action/);
    checkAdventureWorksInventory(inventory, { source: 'inferred' });
    cascade.onDelete = 'CASCADE';
    cascade.deleteAction = 'SET NULL';
    assert.throws(() => checkAdventureWorksInventory(inventory), /contradictory fields/);
    delete cascade.deleteAction;
    cascade.onUpdate = 'CASCADE';
    assert.throws(() => checkAdventureWorksInventory(inventory), /update action/);
});

test('source semantics reject missing, combined, invented or filtered uniqueness', async (t) => {
    for (const [name, mutate] of [
        [
            'missing ProductNumber constraint',
            (inventory) => {
                inventory.indexes = inventory.indexes.filter((index) => index.name !== 'AK_Product_ProductNumber');
            },
        ],
        [
            'combined Name and ProductNumber constraint',
            (inventory) => {
                inventory.indexes.find((index) => index.name === 'AK_Product_Name').keys.push('ProductNumber');
                inventory.indexes = inventory.indexes.filter((index) => index.name !== 'AK_Product_ProductNumber');
            },
        ],
        [
            'invented email uniqueness',
            (inventory) => {
                inventory.indexes.find((index) => index.name === 'IX_Customer_EmailAddress').unique = true;
            },
        ],
        [
            'missing uniqueness flag',
            (inventory) => {
                delete inventory.indexes.find((index) => index.name === 'AK_Product_Name').unique;
            },
        ],
        [
            'invalid uniqueness flag',
            (inventory) => {
                inventory.indexes.find((index) => index.name === 'AK_Product_Name').unique = 'NULL';
            },
        ],
        [
            'filtered Product uniqueness',
            (inventory) => {
                inventory.indexes.find((index) => index.name === 'AK_Product_Name').filter = '[Name] IS NOT NULL';
            },
        ],
        [
            'index key order changed',
            (inventory) => {
                inventory.indexes.find((index) => index.keys.length > 1).keys.reverse();
            },
        ],
        [
            'duplicate index evidence',
            (inventory) => {
                inventory.indexes.push(structuredClone(inventory.indexes[0]));
            },
        ],
    ]) {
        await t.test(name, () => {
            const inventory = schemaInventory();
            mutate(inventory);
            assert.throws(() => checkAdventureWorksInventory(inventory), /index|uniqueness|boolean/i);
        });
    }
});

test('inference does not require convention-only nonunique indexes or physical computed metadata', () => {
    const inventory = schemaInventory();
    const conventions = new Set([
        'IX_CustomerAddress_AddressID',
        'IX_Product_ProductCategoryID',
        'IX_Product_ProductModelID',
        'IX_ProductCategory_ParentProductCategoryID',
        'IX_ProductModelProductDescription_ProductDescriptionID',
        'IX_SalesOrderHeader_BillToAddressID',
        'IX_SalesOrderHeader_ShipToAddressID',
    ]);
    inventory.indexes = inventory.indexes.filter(({ name }) => !conventions.has(name));
    checkAdventureWorksInventory(inventory, { source: 'inferred' });
    assert.throws(() => checkAdventureWorksInventory(inventory), /index evidence is missing/);
    inventory.indexes = inventory.indexes.filter(({ name }) => name !== 'AK_Product_ProductNumber');
    assert.throws(() => checkAdventureWorksInventory(inventory, { source: 'inferred' }), /ProductNumber.*missing/);
});

test('controller coverage requires code-evidenced reads and writes from each CRUD controller', () => {
    const patterns = ['Customers', 'Products', 'ProductCategories'].flatMap((controller) =>
        ['read', 'write'].map((kind) => ({
            kind,
            evidence: 'code',
            sourcePaths: [`Controllers/${controller}Controller.cs`],
        })),
    );
    checkControllerCoverage({ patterns });
    checkControllerCoverage({
        patterns: patterns.map((pattern) => ({
            ...pattern,
            sourcePaths: pattern.sourcePaths.map((path) => `./${path}#L24`),
        })),
    });
    assert.throws(() => checkControllerCoverage({ patterns: patterns.slice(1) }), /CustomersController/);
    assert.throws(
        () => checkControllerCoverage({ patterns: patterns.map((pattern) => ({ ...pattern, kind: 'read' })) }),
        /write evidence/,
    );
    assert.throws(
        () =>
            checkControllerCoverage({
                patterns: patterns.map((pattern) => ({ ...pattern, evidence: 'schema-inferred' })),
            }),
        /read evidence/,
    );
});

test('planning checks reject fabricated deployment and application-execution success', () => {
    const project = { phases: { provisioning: { status: 'in-progress' }, targetEnvironment: { verified: false } } };
    const plan = { mode: 'plan', outputFiles: [], validation: [] };
    checkPlanningBoundary(project, plan);
    assert.throws(() => checkPlanningBoundary(project, { ...plan, mode: 'migrate' }), /does not authorize/);
    assert.throws(
        () => checkPlanningBoundary(project, { ...plan, outputFiles: [{ path: 'Program.cs' }] }),
        /application outputs/,
    );
    assert.throws(() => checkPlanningBoundary(project, plan, { verification: {} }), /fabricate cloud/);
    assert.throws(
        () => checkPlanningBoundary(project, { ...plan, validation: [{ status: 'passed', checks: ['build'] }] }),
        /not built/,
    );
    assert.throws(
        () => checkPlanningBoundary({ phases: { provisioning: { status: 'complete' } } }, plan),
        /incomplete/,
    );
    assert.throws(
        () => checkPlanningBoundary({ phases: { targetEnvironment: { verified: true } } }, plan),
        /not a verified target/,
    );
});

test('real artifact checker rejects missing evidence and byte changes to application files', (t) => {
    const root = temporary(t);
    const source = join(root, 'source');
    const app = join(root, 'app');
    mkdirSync(source);
    writeFileSync(join(source, 'asset.bin'), Buffer.from([255]));
    cpSync(source, app, { recursive: true });
    assert.throws(() => checkAdventureWorks(app, 'supplied-ddl', source), /ENOENT/);
    writeFileSync(join(app, 'asset.bin'), Buffer.from([254]));
    assert.throws(() => checkAdventureWorks(app, 'supplied-ddl', source), /Application source changed/);
});

test(
    'filtered small-suite runs do not invoke Git to prepare AdventureWorks',
    { skip: process.platform === 'win32' },
    (t) => {
        const root = temporary(t);
        writeFileSync(join(root, 'git'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
        const result = spawnSync(process.execPath, ['scripts/eval.mjs', '--tag', 'category=guidance', '--help'], {
            cwd: fileURLToPath(new URL('../../', import.meta.url)),
            env: { ...process.env, PATH: `${root}:${process.env.PATH}`, VALLY_TELEMETRY_OPTOUT: '1' },
            encoding: 'utf8',
            timeout: 30_000,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Run stimuli against an agent/);
    },
);
