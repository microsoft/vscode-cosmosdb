/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createGraderRegistry, loadEvalSpec } from '@microsoft/vally';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildFreshnessManifest } from '../../skills/cosmosdb-migration/scripts/freshness.mjs';
import { registerGraders } from './check-artifacts.mjs';
import { assertDocumentBoundary, checkDocument } from './document/check.mjs';
import { prepareDocument } from './document/fixtures.mjs';
import { temporaryWorkspace } from './workspace.mjs';

const skillRoot = fileURLToPath(new URL('../../skills/cosmosdb-migration/', import.meta.url));
const specs = fileURLToPath(new URL('./document/', import.meta.url));
const projectPath = '.cosmosdb-migration/project.json';
const discovery = '.cosmosdb-migration/phases/1-discovery';
const preflight = `${discovery}/preflight-manifest.json`;
const sourceDiscovery = `${discovery}/discovery-manifest.json`;

function workspace(t) {
    const root = temporaryWorkspace();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

function update(workspace, path, change) {
    const value = JSON.parse(readFileSync(join(workspace, path), 'utf8'));
    change(value);
    writeFileSync(join(workspace, path), JSON.stringify(value));
}

function mutateManifest(workspace, path, phase, change) {
    update(workspace, path, change);
    // Keep the altered artifact internally fresh: failure must come from its meaning, not an obsolete output hash.
    update(workspace, projectPath, (project) => {
        project.freshness[phase] = buildFreshnessManifest(workspace, project, phase);
    });
}

test('each document stimulus stages only its prerequisites and removes the setup answer material', async (t) => {
    const spec = await loadEvalSpec(join(specs, 'eval.yaml'));
    const checkpoints = [
        preflight,
        sourceDiscovery,
        '.cosmosdb-migration/phases/2-assessment/assessment-manifest.json',
        '.cosmosdb-migration/phases/3-schema-conversion/model.json',
    ];
    const acceptedCount = {
        'document-preflight': 0,
        'document-discovery': 1,
        'document-assessment': 2,
        'document-planning': 4,
    };
    for (const stimulus of spec.stimuli) {
        const root = workspace(t);
        symlinkSync(skillRoot, join(root, 'cosmosdb-migration'), 'junction');
        const files = [...spec.environment.files, ...(stimulus.environment.files ?? [])];
        for (const file of files) {
            const destination = join(root, file.dest);
            mkdirSync(dirname(destination), { recursive: true });
            copyFileSync(join(specs, file.src), destination);
        }
        const [node, ...args] = stimulus.environment.commands[0].split(' ');
        assert.equal(node, 'node');
        execFileSync(process.execPath, args, { cwd: root });
        assert.ok(
            files.every(({ dest }) => !existsSync(join(root, dest))),
            'Never leave generator scripts in the workspace',
        );
        for (const [n, path] of checkpoints.entries()) {
            assert.equal(
                existsSync(join(root, 'app', path)),
                n < acceptedCount[stimulus.name],
                `${stimulus.name}: ${path}`,
            );
        }
        assert.deepEqual(readdirSync(join(root, 'app/evidence')).sort(), [
            'collection.json',
            'sample.json',
            'validator.json',
            'workload.md',
        ]);
    }
});

test('document preflight accepts a fresh bounded inventory and rejects fresh one-fact corruptions', async (t) => {
    const changes = [
        [
            'whole-dataset completeness',
            (manifest) => {
                manifest.sourceInventory.datasets[0].coverage.complete = true;
            },
            /complete field coverage/u,
        ],
        [
            'one missing literal path',
            (manifest) => {
                const dataset = manifest.sourceInventory.datasets[0];
                dataset.fields = dataset.fields.filter((field) => field.id !== '$["detail.label"]');
            },
            /Missing source path/u,
        ],
        [
            'ambiguous generated field ID',
            (manifest) => {
                manifest.sourceInventory.datasets[0].fields.find((field) => field.id === '$.batches[*].values[*]').id =
                    'values';
            },
            /Fresh field ID/u,
        ],
        [
            'invented unique secondary index',
            (manifest) => {
                manifest.sourceInventory.datasets[0].indexes[0].unique = true;
            },
            /Wrong uniqueness for tenantId_1/u,
        ],
        [
            'reversed secondary index despite correct summary',
            (manifest) => {
                manifest.sourceInventory.datasets[0].indexes[0].direction = 'descending';
            },
            /Wrong direction for tenantId_1/u,
        ],
        [
            'correct direction and uniqueness attached to the wrong key',
            (manifest) => {
                manifest.sourceInventory.datasets[0].indexes[0].fields = ['$._id'];
            },
            /Wrong indexed fields for tenantId_1/u,
        ],
        [
            'correct prose cannot substitute for missing index evidence',
            (manifest) => {
                manifest.sourceInventory.datasets[0].indexes = [];
            },
            /Missing native secondary index/u,
        ],
        [
            'sample as proof of identity',
            (manifest) => {
                manifest.sourceInventory.datasets[0].identities[0].evidence = ['evidence/sample.json'];
            },
            /Identity requires collection metadata/u,
        ],
        [
            'overstated identity scope',
            (manifest) => {
                manifest.sourceInventory.datasets[0].identities[0].scope = 'database-wide';
            },
            /collection-scoped/u,
        ],
        [
            'tenant-scoped identity mentioning the correct collection',
            (manifest) => {
                manifest.sourceInventory.datasets[0].identities[0].scope = 'per tenant within the events collection';
            },
            /collection-scoped/u,
        ],
        [
            'nonnull claim for optional note',
            (manifest) => {
                manifest.sourceInventory.datasets[0].fields.find((field) => field.id === '$.note').nullable = false;
            },
            /note/u,
        ],
        [
            'unsupported int64 alongside the observed literal-key string',
            (manifest) => {
                const fields = manifest.sourceInventory.datasets[0].fields;
                fields.find((field) => field.id === '$["detail.label"]').nativeTypes.push('int64');
            },
            /Unobserved int64/u,
        ],
        [
            'nested array elements are not guaranteed non-null',
            (manifest) => {
                const fields = manifest.sourceInventory.datasets[0].fields;
                fields.find((field) => field.id === '$.batches[*].values[*]').nullable = false;
            },
            /cannot guarantee non-null/u,
        ],
        [
            'unobserved type on an intermediate sample-only path',
            (manifest) => {
                const fields = manifest.sourceInventory.datasets[0].fields;
                fields.find((field) => field.id === '$.detail').nativeTypes.push('array');
            },
            /Unobserved array/u,
        ],
    ];
    for (const [name, change, expected] of changes) {
        await t.test(name, async (t) => {
            const root = workspace(t);
            await prepareDocument(root, 'document-discovery', skillRoot);
            if (name === 'whole-dataset completeness') {
                // A valid alternative records declared coverage and the bounded observation in the sample provenance.
                mutateManifest(root, preflight, 'preflight', (manifest) => {
                    Object.assign(manifest.sourceInventory.datasets[0].coverage, { basis: 'declared', sampling: null });
                });
            }
            await checkDocument(root, 'document-preflight');
            mutateManifest(root, preflight, 'preflight', change);
            await assert.rejects(checkDocument(root, 'document-preflight'), expected);
        });
    }
});

test('sample-only paths can record unknown population variants without losing the observed type', async (t) => {
    const root = workspace(t);
    await prepareDocument(root, 'document-discovery', skillRoot);
    mutateManifest(root, preflight, 'preflight', ({ sourceInventory }) => {
        Object.assign(
            sourceInventory.datasets[0].fields.find((field) => field.id === '$.detail.label'),
            {
                nativeTypes: ['BSON string', 'unknown'],
                presence: 'unknown',
                nullable: null,
            },
        );
    });
    await checkDocument(root, 'document-preflight');
});

test('native index keys and the supplied identity declaration are also valid evidence', async (t) => {
    const app = workspace(t);
    await prepareDocument(app, 'document-discovery', skillRoot);
    const metadata = JSON.parse(readFileSync(join(app, 'evidence/collection.json'), 'utf8'));
    mutateManifest(app, preflight, 'preflight', ({ sourceInventory }) => {
        const [dataset] = sourceInventory.datasets;
        dataset.identities[0].scope = metadata.identityScope;
        dataset.indexes = metadata.indexes;
    });
    await checkDocument(app, 'document-preflight');
    mutateManifest(app, preflight, 'preflight', ({ sourceInventory }) => {
        sourceInventory.datasets[0].indexes.find(({ name }) => name === 'tenantId_1').key.tenantId = -1;
    });
    await assert.rejects(checkDocument(app, 'document-preflight'), /Wrong ordered key or direction for tenantId_1/u);
});

test('ordered index entries preserve field names, field IDs and directions', async (t) => {
    const app = workspace(t);
    await prepareDocument(app, 'document-discovery', skillRoot);
    const index = {
        name: 'tenantId_1',
        unique: false,
        key: [{ field: 'tenantId', fieldId: '$.tenantId', direction: 1 }],
    };
    const grade = async (key) => {
        mutateManifest(app, preflight, 'preflight', ({ sourceInventory }) => {
            sourceInventory.datasets[0].indexes = [{ ...index, key }];
        });
        await checkDocument(app, 'document-preflight');
    };
    const [entry] = index.key;
    await grade(index.key);
    await assert.rejects(grade([{ ...entry, direction: -1 }]), /Wrong ordered key or direction/);
    await assert.rejects(grade([{ ...entry, fieldId: '$._id' }]), /Wrong field ID/);
    await assert.rejects(grade([{ field: '_id', direction: 1 }]), /Wrong ordered key or direction/);
    await assert.rejects(grade([entry, entry]), /Wrong ordered key or direction/);
});

test('the artifact plugin allows phase outputs but rejects workspace additions and renames outside app/', async (t) => {
    const root = workspace(t);
    const app = join(root, 'app');
    const baselineGitDir = workspace(t);
    const git = (...args) =>
        execFileSync('git', [`--git-dir=${baselineGitDir}`, `--work-tree=${root}`, ...args], {
            cwd: root,
            encoding: 'utf8',
        }).trim();
    await prepareDocument(app, 'document-preflight', skillRoot);
    const memory = join(app, '.cosmosdb-migration/memory.md');
    writeFileSync(memory, 'Existing migration notes.\n');
    git('init', '--quiet');
    git('add', '-A');
    const baselineRef = git('write-tree');
    await prepareDocument(app, 'document-discovery', skillRoot);
    const registry = createGraderRegistry();
    registerGraders(registry);
    const grade = (diffEvidence) =>
        registry.get('source-migration-artifacts').grade({
            trajectory: { workDir: root, ...diffEvidence },
            config: { scenario: 'document-preflight' },
        });
    const baseline = { baselineGitDir, baselineRef };
    const valid = await grade(baseline);
    assert.ok(valid.passed, valid.evidence);
    const noDiff = await grade({});
    assert.equal(noDiff.status, 'error', noDiff.evidence);
    assert.equal(noDiff.passed, false);
    const sibling = join(root, 'generated-schema.sql');
    writeFileSync(sibling, '-- Unexpected SQL intermediate\n');
    const added = await grade(baseline);
    assert.equal(added.passed, false);
    assert.match(added.evidence, /outside app\//u);
    rmSync(sibling);
    renameSync(memory, join(root, 'migration notes.md'));
    const renamed = await grade(baseline);
    assert.equal(renamed.passed, false);
    assert.match(renamed.evidence, /outside app\//u);
});

test('discovery preserves the actual declaration and labels the inferred read without SDK evidence', async (t) => {
    for (const [name, change, expected] of [
        [
            'unsubstantiated declaration',
            (m) => {
                m.patterns[0].declaration = 'Fetch a single record by ID';
            },
            /Retain the supplied/u,
        ],
        [
            'extra claim appended to the true declaration',
            (m) => {
                m.patterns[0].declaration += ' The engineer also requires ID lookup.';
            },
            /verbatim/u,
        ],
        [
            'declaration without the engineer handoff',
            (m) => {
                m.patterns[0].sourcePaths = ['evidence/collection.json'];
            },
            /workload handoff/u,
        ],
        [
            'candidate with only the workload handoff',
            (m) => {
                m.patterns[1].sourcePaths = ['evidence/workload.md'];
            },
            /supporting native evidence/u,
        ],
        [
            'candidate cites a real native file without its claimed filter field',
            (m) => {
                m.patterns[1].operation = 'Find an event by counter';
                m.patterns[1].filterFields = ['$.counter'];
                m.patterns[1].sourcePaths = ['evidence/collection.json'];
            },
            /No cited native evidence/u,
        ],
        [
            'restated tenant listing mentioning ID',
            (m) => {
                m.patterns[1].operation = 'List one tenant’s events including the event ID.';
                m.patterns[1].filterFields = ['$.tenantId'];
            },
            /Duplicate tenant listing/u,
        ],
        [
            'schema index treated as observed',
            (m) => {
                m.patterns[1].evidence = 'observed';
            },
            /No observed traffic/u,
        ],
        [
            'fabricated SDK report',
            (m) => {
                m.sdkCompatibility = {};
            },
            /No SDK/u,
        ],
    ]) {
        await t.test(name, async (t) => {
            const root = workspace(t);
            await prepareDocument(root, 'document-assessment', skillRoot);
            await checkDocument(root, 'document-discovery');
            mutateManifest(root, sourceDiscovery, 'discovery', change);
            await assert.rejects(checkDocument(root, 'document-discovery'), expected);
        });
    }
});

test('a per-tenant count is a distinct inferred read supported by the nonunique tenant index', async (t) => {
    const root = workspace(t);
    await prepareDocument(root, 'document-assessment', skillRoot);
    const report = join(root, discovery, 'discovery-report.md');
    writeFileSync(
        report,
        readFileSync(report, 'utf8').replace(
            'a possible single-event lookup by _id, inferred only from its index',
            'a possible per-tenant event count, inferred only from the nonunique tenantId index',
        ),
    );
    mutateManifest(root, sourceDiscovery, 'discovery', ({ patterns }) => {
        Object.assign(patterns[1], {
            operation: 'How many events belong to a given tenant?',
            filterFields: ['$.tenantId'],
            resultKind: 'count',
            sourcePaths: ['evidence/collection.json#tenantId_1'],
        });
    });
    await checkDocument(root, 'document-discovery');
});

test('discovery may point to its own report and manifest, not change other phase metadata', async (t) => {
    const root = workspace(t);
    await prepareDocument(root, 'document-assessment', skillRoot);
    update(root, projectPath, (project) => {
        Object.assign(project.phases.discovery, {
            reportPath: 'phases/1-discovery/discovery-report.md',
            manifestPath: 'phases/1-discovery/discovery-manifest.json',
        });
        project.runCounts.discovery = 1;
    });
    await checkDocument(root, 'document-discovery');
    update(root, projectPath, (project) => {
        project.phases.discovery.manifestPath = 'phases/2-assessment/assessment-manifest.json';
    });
    await assert.rejects(checkDocument(root, 'document-discovery'), /Wrong discovery manifestPath/u);
    update(root, projectPath, (project) => {
        delete project.phases.discovery.manifestPath;
        project.phases.discovery.preflightCompletedAt = '2026-01-01T00:00:00Z';
    });
    await assert.rejects(checkDocument(root, 'document-discovery'), /unrelated checkpoint metadata/u);
});

test('execution phase names are not aliases for project run counters', async (t) => {
    for (const [scenario, invalid, diagnostic] of [
        ['document-preflight', 'preflight', /preflight has no run counter/u],
        ['document-conversion', 'schema-conversion', /only runCounts\.schemaConversion may change/u],
    ]) {
        const root = workspace(t);
        await prepareDocument(root, scenario, skillRoot);
        if (scenario === 'document-conversion') {
            update(root, projectPath, (project) => {
                project.runCounts.schemaConversion = 1;
            });
        }
        await assertDocumentBoundary(root, scenario);
        update(root, projectPath, (project) => {
            project.runCounts[invalid] = 1;
        });
        await assert.rejects(assertDocumentBoundary(root, scenario), diagnostic);
    }
});

test('document assessment accepts unmapped ownership and rejects a spurious application mapping', async (t) => {
    const root = workspace(t);
    await prepareDocument(root, 'document-conversion', skillRoot);
    await checkDocument(root, 'document-assessment');
    update(root, projectPath, (project) => {
        project.phases.assessment.domains[0].isMapped = true;
    });
    await assert.rejects(checkDocument(root, 'document-assessment'), /No application mapping/u);
});

test('source bytes, unhashed predecessor prose and downstream phases are checked independently of completion', async (t) => {
    for (const [name, scenario, stage, path, expected] of [
        ['native sample', 'document-preflight', 'document-discovery', 'evidence/sample.json', /Changed supplied/u],
        [
            'upstream prose',
            'document-assessment',
            'document-conversion',
            `${discovery}/discovery-report.md`,
            /Changed supplied/u,
        ],
        ['phase boundary', 'document-preflight', 'document-discovery', sourceDiscovery, /Out-of-phase/u],
    ]) {
        await t.test(name, async (t) => {
            const root = workspace(t);
            await prepareDocument(root, stage, skillRoot);
            await checkDocument(root, scenario);
            writeFileSync(join(root, path), '\n', { flag: 'a' });
            await assert.rejects(checkDocument(root, scenario), expected);
        });
    }
});

test('planning starts after accepted conversion; an unauthorized plan fails even with current conversion', async (t) => {
    const root = workspace(t);
    await prepareDocument(root, 'document-planning', skillRoot);
    await checkDocument(root, 'document-planning');
    writeFileSync(join(root, '.cosmosdb-migration/code-migration-plan.md'), '# Application plan\n');
    await assert.rejects(checkDocument(root, 'document-planning'), /Out-of-phase/u);
});
