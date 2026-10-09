/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Page-object helpers for driving the Migration Assistant webview from e2e
 * specs. Selectors prefer the stable `data-testid` attributes added to the
 * React component (see `src/webviews/cosmosdb/Migration/MigrationAssistant.tsx`)
 * and fall back to visible phase-header text for the collapsible accordion.
 */

import { CosmosClient } from '@azure/cosmos';
import { expect, type Frame, type Locator } from '@playwright/test';
import { parse } from '@prantlf/jsonlint';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import { E2E_EMULATOR_ENDPOINT, E2E_EMULATOR_KEY } from '../setup/emulator';

/** Tunes the migration AI mock (delay/failure) for the current test. */
export function setMockControl(control: { delayMs?: number; failRoutes?: string[] }): void {
    const dir = process.env.COSMOSDB_E2E_MIGRATION_CAPTURE_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'control.json'), JSON.stringify(control));
}

/** Clears any mock control so the next test runs at full speed. */
export function clearMockControl(): void {
    const dir = process.env.COSMOSDB_E2E_MIGRATION_CAPTURE_DIR;
    if (!dir) return;
    try {
        rmSync(path.join(dir, 'control.json'), { force: true });
    } catch {
        /* ignore */
    }
}

/** Reads the workspace `.gitignore` (empty string when absent). */
export function readGitignore(): string {
    const ws = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    if (!ws) return '';
    try {
        return readFileSync(path.join(ws, '.gitignore'), 'utf-8');
    } catch {
        return '';
    }
}

/** True when the worker workspace currently has a seeded `.git` directory. */
export function gitDirExists(): boolean {
    const ws = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    return !!ws && existsSync(path.join(ws, '.git'));
}

/** Absolute path to a Phase 4 provisioning artifact in the worker workspace. */
type ProvisioningArtifactName = 'sample-data.json' | 'seed-data.csh' | 'provisioning-verification.json';

function provisioningArtifact(name: ProvisioningArtifactName): string | undefined {
    const ws = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    if (!ws) return undefined;
    return path.join(ws, '.cosmosdb-migration', 'phases', '4-provisioning', name);
}

/** True when a given Phase 4 provisioning artifact exists on disk. */
export function provisioningArtifactExists(name: ProvisioningArtifactName): boolean {
    const p = provisioningArtifact(name);
    return !!p && existsSync(p);
}

/**
 * Reads a migration artifact relative to the worker workspace's
 * `.cosmosdb-migration` root (e.g. `phases/1-discovery/discovery-report.md`).
 * Returns `undefined` when the env or file is absent.
 */
export function readMigrationArtifact(relativePath: string): string | undefined {
    const ws = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    if (!ws) return undefined;
    try {
        return readFileSync(path.join(ws, '.cosmosdb-migration', relativePath), 'utf-8');
    } catch {
        return undefined;
    }
}

/** Reads + JSON-parses a migration artifact (undefined when absent/invalid). */
export function readMigrationJson<T = unknown>(relativePath: string): T | undefined {
    const raw = readMigrationArtifact(relativePath);
    if (raw === undefined) return undefined;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return undefined;
    }
}

function migrationWorkspace(): string {
    const workspace = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    if (!workspace) throw new Error('COSMOSDB_E2E_WORKSPACE_DIR is not set');
    return workspace;
}

function updateMigrationProject(
    update: (project: Record<string, unknown> & { phases: Record<string, unknown> }) => void,
): void {
    const projectPath = path.join(migrationWorkspace(), '.cosmosdb-migration/project.json');
    const project = JSON.parse(readFileSync(projectPath, 'utf-8')) as Record<string, unknown> & {
        phases: Record<string, unknown>;
    };
    update(project);
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');
}

function writeMigrationArtifact(relativePath: string, content: string): void {
    const artifactPath = path.join(migrationWorkspace(), '.cosmosdb-migration', relativePath);
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, content, 'utf-8');
}

function completeMockSkillPreflight(promptText: string): void {
    const step = promptText.match(/^Run only the (.+) preflight step\.$/mu)?.[1];
    if (step === 'schema-acquisition') {
        const suppliedDdl = readMigrationArtifact('phases/1-discovery/schema-ddl/schema.sql');
        if (!suppliedDdl) throw new Error('Supplied DDL must remain available during schema acquisition.');
    } else if (step === 'application-details') {
        writeMigrationArtifact(
            'phases/1-discovery/preflight-manifest.json',
            `${JSON.stringify(
                {
                    version: 1,
                    blockingIssues: [],
                },
                null,
                2,
            )}\n`,
        );
        updateMigrationProject((project) => {
            const discovery = project.phases.discovery as Record<string, unknown>;
            (discovery.applicationAnalysis as Record<string, unknown>).completedAt = new Date().toISOString();
        });
    } else if (step === 'volumetrics') {
        writeMigrationArtifact(
            'phases/1-discovery/volumetrics/volumetrics.md',
            '# Volumetrics\n\n| # | Schema | Table | Est. Row Count |\n|---:|---|---|---:|\n| 1 | dbo | Orders | 100 |\n',
        );
    } else if (step === 'access-patterns') {
        writeMigrationArtifact(
            'phases/1-discovery/access-patterns/access-patterns.md',
            '# Access Patterns\n\n## Read Patterns\n\n| # | Pattern Name | Tables / Entities | Filter / Lookup Fields |\n|---:|---|---|---|\n| R1 | Orders by customer | dbo.Orders | CustomerID |\n\n## Write Patterns\n\n| # | Pattern Name | Tables / Entities | Single / Batch |\n|---:|---|---|---|\n',
        );
    } else {
        throw new Error(`Unsupported mocked preflight step: ${step ?? '<missing>'}`);
    }

    const root = path.join(migrationWorkspace(), '.cosmosdb-migration/phases/1-discovery');
    const requiredFiles = [
        'preflight-manifest.json',
        'volumetrics/volumetrics.md',
        'access-patterns/access-patterns.md',
    ];
    if (requiredFiles.every((file) => existsSync(path.join(root, file)))) {
        writeMigrationArtifact('phases/1-discovery/preflight-summary.md', '# Preflight Summary\n\nReady.\n');
        updateMigrationProject((project) => {
            const discovery = project.phases.discovery as Record<string, unknown>;
            discovery.preflightStatus = 'complete';
            discovery.preflightCompletedAt = new Date().toISOString();
        });
    }
}

function completeMockSkillDiscovery(): void {
    writeMigrationArtifact(
        'phases/1-discovery/discovery-report.md',
        '# Discovery Report\n\n## Schema Overview\nOrders and OrderDetails.\n\n## Access Patterns\nOrders by customer.\n',
    );
    writeMigrationArtifact(
        'phases/1-discovery/discovery-manifest.json',
        `${JSON.stringify(
            {
                version: 1,
                matrixVersion: 1,
                overallStatus: 'supported',
                codeMigrationAllowed: true,
                results: [{ language: 'C#', status: 'supported' }],
            },
            null,
            2,
        )}\n`,
    );
    updateMigrationProject((project) => {
        project.phases.discovery = {
            ...(project.phases.discovery as Record<string, unknown>),
            status: 'complete',
            completedAt: new Date().toISOString(),
        };
    });
}

export type MockRegenerationPhase = 'discovery' | 'assessment' | 'schema-conversion';

export function addMockRegenerationSentinel(phase: MockRegenerationPhase): void {
    const artifactByPhase: Record<MockRegenerationPhase, string> = {
        discovery: 'phases/1-discovery/discovery-report.md',
        assessment: 'phases/2-assessment/assessment-summary.md',
        'schema-conversion': 'phases/3-schema-conversion/summary.md',
    };
    const artifactPath = artifactByPhase[phase];
    const current = readMigrationArtifact(artifactPath);
    if (!current) throw new Error(`${phase} output must exist before adding the regeneration sentinel.`);
    writeMigrationArtifact(artifactPath, `${current}\nREGENERATION-SENTINEL\n`);
}

function completeMockSkillAssessment(): void {
    writeMigrationArtifact(
        'phases/2-assessment/assessment-summary.md',
        '# Domain Assessment Summary\n\n## SalesDomain\nOrders and OrderDetails form one aggregate.\n',
    );
    writeMigrationArtifact(
        'phases/2-assessment/domains/SalesDomain.md',
        '# Domain: SalesDomain\n\nAggregate root: Orders.\n',
    );
    updateMigrationProject((project) => {
        project.phases.assessment = {
            status: 'complete',
            domains: [
                {
                    name: 'SalesDomain',
                    tables: ['Orders', 'OrderDetails'],
                    crossDomainDependencies: [],
                    estimatedTokens: 1000,
                    isMapped: true,
                },
            ],
            parsedAccessPatterns: [],
            completedAt: new Date().toISOString(),
        };
    });
}

function completeMockSkillSchemaConversion(): void {
    const model = {
        version: 1,
        domain: 'SalesDomain',
        sourceType: 'SQL Server',
        containers: [
            {
                name: 'orders',
                partitionKeys: [{ path: '/customerId' }],
                entities: [
                    {
                        name: 'Order',
                        docType: 'order',
                        sourceTable: 'Orders',
                        idTemplate: 'order-{OrderID}',
                        attributes: [
                            {
                                target: 'id',
                                source: { table: 'Orders', column: 'OrderID', type: 'int' },
                                type: 'string',
                                isId: true,
                            },
                            {
                                target: 'orderId',
                                source: { table: 'Orders', column: 'OrderID', type: 'int' },
                                type: 'number',
                            },
                            {
                                target: 'customerId',
                                source: { table: 'Orders', column: 'CustomerID', type: 'varchar' },
                                type: 'string',
                                isPartitionKey: true,
                            },
                        ],
                    },
                ],
                indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [] },
            },
        ],
    };
    const domainRoot = 'phases/3-schema-conversion/domains/SalesDomain';
    writeMigrationArtifact(`${domainRoot}/candidate.json`, `${JSON.stringify(model, null, 2)}\n`);
    writeMigrationArtifact(
        `${domainRoot}/summary.md`,
        `# SalesDomain Schema Conversion

## Overview
Orders map to one container.
## Tables to Container Mapping
Orders maps to orders.
## Container Summary
The orders container stores order documents.
## Partition Key Decisions
Use /customerId.
## Embedding Strategy
No embedded entities.
## Access Pattern Mappings
Route customer reads by partition key.
## Cross-Partition Queries
None.
## Indexing Policies
Index all application fields.
## Optimization Recommendations
Use point reads.
## Throughput & Storage Recommendations
Inputs: [volumetrics] [access patterns]
## Example Documents
\`\`\`json
${JSON.stringify({ id: 'order-1', docType: 'order', orderId: 1, customerId: 'c1' }, null, 2)}
\`\`\`
`,
    );
    const rootModel = { ...model, domain: 'all', databaseName: 'E2E Migration', capacityMode: 'serverless' };
    writeMigrationArtifact('phases/3-schema-conversion/candidate.json', `${JSON.stringify(rootModel, null, 2)}\n`);
    writeMigrationArtifact(
        'phases/3-schema-conversion/summary.md',
        `# Migration Database

## Database Overview
E2E Migration contains one container.
## Container Inventory
orders.
## Container Mappings
Orders maps to orders.
## Cross-Domain Relationships
None.
## Conflict Resolutions
No conflicts.
## Deployment Notes
Serverless is eligible.
## Per-Domain References
[SalesDomain](./domains/SalesDomain/summary.md)
`,
    );

    const validator = path.resolve('skills/cosmosdb-relational-migration/scripts/validate-cosmos-model.mjs');
    for (const [candidate, output] of [
        [`${domainRoot}/candidate.json`, `${domainRoot}/cosmos-model.json`],
        ['phases/3-schema-conversion/candidate.json', 'phases/3-schema-conversion/model.json'],
    ]) {
        const result = spawnSync(
            process.execPath,
            [
                validator,
                path.join(migrationWorkspace(), '.cosmosdb-migration', candidate),
                '--output',
                path.join(migrationWorkspace(), '.cosmosdb-migration', output),
            ],
            { encoding: 'utf-8' },
        );
        if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    }
    updateMigrationProject((project) => {
        project.phases.schemaConversion = {
            status: 'complete',
            domains: ['SalesDomain'],
            completedAt: new Date().toISOString(),
        };
    });
}

function prepareMockSkillProvisioningTarget(): void {
    updateMigrationProject((project) => {
        project.phases.targetEnvironment = {
            type: 'emulator',
            endpoint: 'https://localhost:8082',
            verified: true,
            verifiedAt: new Date().toISOString(),
        };
    });
}

function completeMockSkillProvisioning(): void {
    const workspace = migrationWorkspace();
    const root = path.join(workspace, '.cosmosdb-migration');
    const modelPath = path.join(root, 'phases/3-schema-conversion/model.json');
    const projectPath = path.join(root, 'project.json');
    const outputPath = path.join(root, 'phases/4-provisioning');
    const model = JSON.parse(readFileSync(modelPath, 'utf-8')) as {
        databaseName: string;
        capacityMode: 'serverless' | 'provisioned';
        containers: {
            name: string;
            partitionKeys: { path: string }[];
            indexingPolicy: unknown;
            maxThroughput?: number;
        }[];
    };
    const sampleData = {
        sampleData: [
            {
                containerName: 'orders',
                items: [{ id: 'order-1', docType: 'order', orderId: 1, customerId: 'c1' }],
            },
        ],
    };
    writeMigrationArtifact('phases/4-provisioning/sample-data.json', `${JSON.stringify(sampleData, null, 2)}\n`);

    const generator = path.resolve('skills/cosmosdb-relational-migration/scripts/generate-provisioning-artifacts.mjs');
    const generation = spawnSync(
        process.execPath,
        [
            generator,
            '--model',
            modelPath,
            '--sample-data',
            path.join(outputPath, 'sample-data.json'),
            '--project',
            projectPath,
            '--output',
            outputPath,
            '--force',
        ],
        { encoding: 'utf-8' },
    );
    if (generation.status !== 0) throw new Error(generation.stderr || generation.stdout);

    const existingVerification = readMigrationJson<{ verifiedAt?: string }>(
        'phases/4-provisioning/provisioning-verification.json',
    );
    const previousVerifiedAt = Date.parse(existingVerification?.verifiedAt ?? '2026-01-01T00:00:00.000Z');
    const verifiedAt = new Date(previousVerifiedAt + 1000).toISOString();
    const verification = {
        version: 1,
        verifiedAt,
        modelSha256: createHash('sha256').update(readFileSync(modelPath)).digest('hex'),
        target: { type: 'emulator', endpoint: E2E_EMULATOR_ENDPOINT },
        databaseName: model.databaseName,
        containers: model.containers.map((container) => ({
            name: container.name,
            partitionKeys: container.partitionKeys.map((partitionKey) => partitionKey.path),
            indexingPolicy: container.indexingPolicy,
            capacityMode: model.capacityMode,
            ...(container.maxThroughput === undefined ? {} : { maxThroughput: container.maxThroughput }),
        })),
        sampleItems: [
            {
                containerName: 'orders',
                id: 'order-1',
                partitionKeyValues: ['c1'],
                found: true,
                document: structuredClone(sampleData.sampleData[0].items[0]),
            },
        ],
        failures: [],
    };
    writeMigrationArtifact(
        'phases/4-provisioning/provisioning-verification.json',
        `${JSON.stringify(verification, null, 2)}\n`,
    );
    updateMigrationProject((project) => {
        project.phases.provisioning = {
            status: 'complete',
            databaseName: model.databaseName,
            containersCreated: model.containers.map((container) => container.name),
            sampleDataInserted: true,
            completedAt: verifiedAt,
        };
    });
}

export type MockSkillPhase =
    | 'preflight'
    | 'discovery'
    | 'assessment'
    | 'schema-conversion'
    | 'provisioning'
    | 'code-migration';

const MOCK_SKILL_DECISIONS: Record<MockSkillPhase, string[]> = {
    preflight: ['discovery-evidence'],
    discovery: ['discovery-evidence'],
    assessment: ['domain-cross-domain-design'],
    'schema-conversion': [
        'container-identity-design',
        'partition-key-selection',
        'embedding-references',
        'query-mapping',
        'index-policy-design',
    ],
    provisioning: ['capacity-provisioning'],
    'code-migration': ['application-code-migration'],
};

function readMockSkillPhase(promptText: string): MockSkillPhase {
    const phase = promptText
        .match(
            /^(?:Run|Regenerate) the (.+) (?:phase of|results for) a relational database migration to Azure Cosmos DB\.$/mu,
        )?.[1]
        ?.replaceAll(' ', '-');
    if (!phase || !Object.hasOwn(MOCK_SKILL_DECISIONS, phase)) {
        throw new Error('Mocked Skill prompt is missing phase.');
    }
    return phase as MockSkillPhase;
}

export function setMockSkillRunActivity(
    promptText: string,
    activity: 'running' | 'waiting-for-decision' | 'blocked' | 'complete' | 'failed' | 'cancelled',
    detail = '',
): void {
    const runId = promptText.match(/^Run ID: ([A-Za-z0-9_-]+)$/mu)?.[1];
    const phase = readMockSkillPhase(promptText);
    if (!runId) throw new Error('Mocked Skill prompt is missing activity tracking inputs.');
    const step =
        promptText.match(/^Run only the (.+) (?:preflight|provisioning) step\.$/mu)?.[1] ??
        (phase === 'code-migration'
            ? promptText.includes('Migrate the application code using the validated migration plan.')
                ? 'migrate'
                : 'plan'
            : null);
    updateMigrationProject((project) => {
        const previous = project.execution as { runId: string; startedAt: string } | undefined;
        const now = new Date().toISOString();
        project.execution = {
            version: 1,
            runId,
            phase,
            step,
            activity,
            detail,
            updatedAt: now,
            startedAt: previous?.runId === runId ? previous.startedAt : now,
        };
    });
}

export function runMockSkillAgent(promptText: string): { phase: MockSkillPhase; decisions: string[] } {
    setMockSkillRunActivity(promptText, 'running');
    try {
        const result = completeMockSkillAgent(promptText);
        setMockSkillRunActivity(promptText, 'complete');
        return result;
    } catch (error) {
        setMockSkillRunActivity(promptText, 'failed', error instanceof Error ? error.message : String(error));
        throw error;
    }
}

function completeMockSkillAgent(promptText: string): { phase: MockSkillPhase; decisions: string[] } {
    const phase = readMockSkillPhase(promptText);
    const decisions = MOCK_SKILL_DECISIONS[phase];
    switch (phase) {
        case 'preflight':
            completeMockSkillPreflight(promptText);
            break;
        case 'discovery':
            completeMockSkillDiscovery();
            break;
        case 'assessment':
            completeMockSkillAssessment();
            break;
        case 'schema-conversion':
            completeMockSkillSchemaConversion();
            break;
        case 'provisioning':
            if (promptText.includes('Run only the resources-and-data provisioning step.')) {
                completeMockSkillProvisioning();
            } else {
                prepareMockSkillProvisioningTarget();
            }
            break;
        case 'code-migration':
            writeCodeMigrationPlan(
                promptText.includes('Migrate the application code using the validated migration plan.')
                    ? 'migrate'
                    : 'plan',
            );
            break;
    }
    return { phase, decisions };
}

export function writeCodeMigrationPlanDraft(): void {
    const ws = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    if (!ws) throw new Error('COSMOSDB_E2E_WORKSPACE_DIR is not set');
    const dir = path.join(ws, '.cosmosdb-migration');
    mkdirSync(path.join(dir, 'code-migration'), { recursive: true });
    writeFileSync(path.join(dir, 'code-migration-plan.md'), '# Code Migration Plan\n', 'utf-8');
}

/**
 * Simulates Copilot Chat producing the code migration plan by writing
 * `code-migration-plan.md`, `code-migration-manifest.json`, and the completed checkpoint into the worker workspace.
 * The extension's file watcher picks them up and advances the next action to migrate.
 */
export function writeCodeMigrationPlan(mode: 'plan' | 'migrate' = 'plan'): void {
    const ws = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    if (!ws) throw new Error('COSMOSDB_E2E_WORKSPACE_DIR is not set');
    const dir = path.join(ws, '.cosmosdb-migration');
    const modelContent = readFileSync(path.join(dir, 'phases/3-schema-conversion/model.json'), 'utf-8');
    const sdkReportPath = path.join(dir, 'phases/1-discovery/discovery-manifest.json');
    if (!existsSync(sdkReportPath)) {
        const sdkReport = {
            version: 1,
            matrixVersion: 1,
            overallStatus: 'supported',
            codeMigrationAllowed: true,
            results: [{ language: 'C#', status: 'supported' }],
        };
        writeFileSync(sdkReportPath, `${JSON.stringify(sdkReport, null, 2)}\n`, 'utf-8');
    }
    const sdkReportContent = readFileSync(sdkReportPath, 'utf-8');
    const outputPath = 'src/mockCosmosRepository.js';
    const outputFile = path.join(ws, outputPath);
    let outputFiles: { path: string; sha256: string }[] = [];
    let validation: {
        command: string;
        checks: ('build' | 'behavior')[];
        coverage: string;
        status: 'passed';
        exitCode: 0;
    }[] = [];
    if (mode === 'migrate') {
        const previousContent = existsSync(outputFile) ? readFileSync(outputFile, 'utf-8') : '';
        const previousGeneration = Number(previousContent.match(/generation (\d+)/u)?.[1] ?? 0);
        mkdirSync(path.dirname(outputFile), { recursive: true });
        writeFileSync(
            outputFile,
            `// generation ${previousGeneration + 1}\nexport function orderPartitionKey(order) { return String(order.customerId); }\n`,
            'utf-8',
        );
        const command = `node --check ${outputPath}`;
        const result = spawnSync(process.execPath, ['--check', outputFile], { encoding: 'utf-8' });
        if (result.status !== 0) throw new Error(result.stderr || result.stdout);
        const behaviorScript = [
            "import assert from 'node:assert/strict';",
            "import fs from 'node:fs';",
            "const source = fs.readFileSync(process.argv[1]).toString('base64');",
            "const { orderPartitionKey } = await import('data:text/javascript;base64,' + source);",
            "assert.equal(orderPartitionKey({ customerId: 'c1' }), 'c1');",
            "assert.equal(orderPartitionKey({ customerId: 42 }), '42');",
        ].join('\n');
        const behaviorResult = spawnSync(process.execPath, ['--input-type=module', '-e', behaviorScript, outputFile], {
            encoding: 'utf-8',
        });
        if (behaviorResult.status !== 0) throw new Error(behaviorResult.stderr || behaviorResult.stdout);
        outputFiles = [
            { path: outputPath, sha256: createHash('sha256').update(readFileSync(outputFile)).digest('hex') },
        ];
        validation = [
            {
                command,
                checks: ['build'],
                coverage: 'Syntax-checks the generated JavaScript fixture.',
                status: 'passed',
                exitCode: 0,
            },
            {
                command: `node --input-type=module -e ${JSON.stringify(behaviorScript)} ${outputPath}`,
                checks: ['behavior'],
                coverage:
                    'Executes the fixture partition-key function for string and numeric customer IDs; no SDK or live resource coverage.',
                status: 'passed',
                exitCode: 0,
            },
        ];
    }
    const manifest = {
        version: 1,
        mode,
        modelSha256: createHash('sha256').update(modelContent).digest('hex'),
        sdkReportSha256: createHash('sha256').update(sdkReportContent).digest('hex'),
        bestPractices: {
            rules: ['rules/sdk-singleton-client.md'],
            unresolvedConcerns: [],
        },
        outputFiles,
        blockingSteps: [],
        validation,
    };
    const plan = `# Code Migration Plan

## Overview
Plan the Cosmos DB data-access migration.
## Affected Files
Application data-access files.
## Ordered Changes
1. Configure the Cosmos DB client.
## Access Pattern Migration
Replace relational reads with partition-routed operations.
## Configuration and Authentication
Use environment configuration and managed identity.
## Validation
${
    mode === 'migrate'
        ? validation
              .map(
                  (result) =>
                      `${result.checks.join(', ')}: ${result.coverage} Command: ${result.command}; exit code: ${result.exitCode}.`,
              )
              .join('\n')
        : 'Plan a syntax check and partition-routing assertions for the fake-agent fixture; these checks have not run.'
}
This fixture does not validate Cosmos DB integration or production application behavior.
## Rollback
Revert migrated application files.
## Applied Rules
rules/sdk-singleton-client.md
## Blocker Review
No candidate blockers.
## Unresolved Blockers
None.
`;
    mkdirSync(path.join(dir, 'code-migration'), { recursive: true });
    writeFileSync(path.join(dir, 'code-migration-plan.md'), plan, 'utf-8');
    writeFileSync(path.join(dir, 'code-migration-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

    const projectPath = path.join(dir, 'project.json');
    const project = JSON.parse(readFileSync(projectPath, 'utf-8')) as Record<string, unknown> & {
        phases: Record<string, unknown>;
    };
    project.phases.codeMigration = {
        status: 'complete',
        planPath: '.cosmosdb-migration/code-migration-plan.md',
        outputPaths: outputFiles.map((output) => output.path),
        completedAt: new Date().toISOString(),
    };
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');
}

export function readApplicationFile(relativePath: string): string | undefined {
    try {
        return readFileSync(path.join(migrationWorkspace(), relativePath), 'utf-8');
    } catch {
        return undefined;
    }
}

export function checkMockSkillPhaseCompletion(phase: MockSkillPhase): { complete: boolean; errors: string[] } {
    const checker = path.resolve('skills/cosmosdb-relational-migration/scripts/check-phase-completion.mjs');
    const result = spawnSync(process.execPath, [checker, '--workspace', migrationWorkspace(), '--phase', phase], {
        encoding: 'utf-8',
    });
    const completion = JSON.parse(result.stdout) as { complete: boolean; errors: string[] };
    if (result.status !== 0 && completion.complete) throw new Error(result.stderr || result.stdout);
    return completion;
}

/** Reads + parses the generated `sample-data.json` (undefined when absent). */
export function readSampleData(): { sampleData: { containerName: string; items: unknown[] }[] } | undefined {
    const p = provisioningArtifact('sample-data.json');
    if (!p || !existsSync(p)) return undefined;
    try {
        return JSON.parse(readFileSync(p, 'utf-8')) as { sampleData: { containerName: string; items: unknown[] }[] };
    } catch {
        return undefined;
    }
}

/** Reads every document from an emulator container (id-sorted, no system fields). */
export async function readEmulatorItems(databaseId: string, containerId: string): Promise<Record<string, unknown>[]> {
    // Scoped self-signed-cert trust, mirroring `test/e2e/setup/emulator.ts`. The
    // agent is local to this client so the relaxation never leaks process-wide.
    const client = new CosmosClient({
        endpoint: E2E_EMULATOR_ENDPOINT,
        key: E2E_EMULATOR_KEY,
        connectionPolicy: { enableEndpointDiscovery: false },
        agent: new https.Agent({ rejectUnauthorized: false }),
    });
    const container = client.database(databaseId).container(containerId);
    const { resources } = await container.items.readAll<Record<string, unknown>>().fetchAll();
    return resources
        .map((doc) => {
            const stripped: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(doc)) {
                if (!k.startsWith('_')) stripped[k] = v;
            }
            return stripped;
        })
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Reads the migration AI-mock prompt capture log written during the run. */
interface CapturedMigrationPrompt {
    route: string | null;
    promptText: string;
    chat?: { newSession: boolean; modelSelector: { vendor: string; id: string } };
}

export function setMigrationSettings(updates: { showTokenEstimate?: boolean; useProgrammaticFlow?: boolean }): void {
    const settingsPath = path.join(migrationWorkspace(), '.vscode/settings.json');
    const settings = parse(readFileSync(settingsPath, 'utf8'), {
        ignoreComments: true,
        ignoreTrailingCommas: true,
    });
    for (const [key, value] of Object.entries(updates)) {
        settings[`cosmosDB.experimental.migration.${key}`] = value;
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

export function readCapturedPrompts(): CapturedMigrationPrompt[] {
    const dir = process.env.COSMOSDB_E2E_MIGRATION_CAPTURE_DIR;
    if (!dir) return [];
    try {
        return readFileSync(path.join(dir, 'capture.jsonl'), 'utf-8')
            .split('\n')
            .filter((l) => l.trim().length > 0)
            .map((l) => JSON.parse(l) as CapturedMigrationPrompt);
    } catch {
        return [];
    }
}

/** Visible (English-default) phase header labels. */
export const PHASE_HEADERS = {
    phase1: 'Phase 1: Source Discovery',
    phase2: 'Phase 2: Domain Assessment',
    phase3: 'Phase 3: Schema Conversion',
    phase4: 'Phase 4: Target Provisioning',
} as const;

export class MigrationPage {
    constructor(private readonly frame: Frame) {}

    get root(): Locator {
        return this.frame.locator('#root');
    }

    get consentCheckbox(): Locator {
        // Fluent UI's Checkbox renders the real <input type="checkbox"> with the
        // accessible name taken from its label. Target it by role rather than by
        // data-testid (which Fluent places on the root wrapper, not the input).
        return this.frame.getByRole('checkbox', { name: /acknowledge that this feature uses AI/i });
    }

    get modelDropdown(): Locator {
        return this.frame.getByTestId('migration-model-dropdown');
    }

    runDiscoveryButton(): Locator {
        return this.frame.getByTestId('migration-run-discovery');
    }

    runAssessmentButton(): Locator {
        return this.frame.getByTestId('migration-run-assessment');
    }

    runConversionButton(): Locator {
        return this.frame.getByTestId('migration-run-conversion');
    }

    // ── Configuration / Phase 1 controls ─────────────────────────────
    get autoDetectButton(): Locator {
        return this.frame.getByTestId('migration-auto-detect');
    }

    get generateSchemaButton(): Locator {
        return this.frame.getByRole('button', { name: 'Generate schema files from workspace code using AI' });
    }

    get updateVolumetricsButton(): Locator {
        return this.frame.getByRole('button', { name: 'Update volumetrics template using AI' });
    }

    get updateAccessPatternsButton(): Locator {
        return this.frame.getByRole('button', { name: 'Update access-patterns template using AI' });
    }

    get projectNameInput(): Locator {
        return this.frame.getByTestId('migration-project-name');
    }

    /** An Application Details input by field key. */
    analysisField(field: 'project-name' | 'project-type' | 'language' | 'frameworks' | 'database' | 'access'): Locator {
        return this.frame.getByTestId(`migration-${field}`);
    }

    get viewDiscoveryButton(): Locator {
        return this.frame.getByTestId('migration-view-discovery');
    }

    get gitignoreExclude(): Locator {
        return this.frame.getByRole('checkbox', { name: /Exclude migration configuration from version control/i });
    }

    get gitInitButton(): Locator {
        return this.frame.getByTestId('migration-git-init');
    }

    get aiDisabledWarning(): Locator {
        return this.frame.getByTestId('migration-ai-disabled-warning');
    }

    instructions(phase: 'discovery' | 'assessment' | 'conversion'): Locator {
        return this.frame.getByTestId(`migration-${phase}-instructions`);
    }

    // ── Progress / cancel / error states ─────────────────────────────
    get progressBar(): Locator {
        return this.frame.getByRole('progressbar');
    }

    get cancelButton(): Locator {
        return this.frame.getByRole('button', { name: 'Cancel', exact: true });
    }

    get errorAlert(): Locator {
        return this.frame.getByRole('alert');
    }

    phaseHeader(label: string): Locator {
        return this.frame.getByText(label, { exact: true });
    }

    phaseCompleteBadge(phase: 'phase1' | 'phase2' | 'phase3' | 'phase4'): Locator {
        return this.frame.getByTestId(`migration-${phase}-status-complete`);
    }

    // ── Phase 2 artifacts ────────────────────────────────────────────
    get phase2DomainTable(): Locator {
        return this.frame.getByTestId('migration-phase2-domains');
    }

    /** Per-domain summary links rendered in the Phase 2 table. */
    phase2DomainLinks(): Locator {
        return this.frame.getByTestId('migration-phase2-domain-link');
    }

    get phase2SummaryButton(): Locator {
        return this.frame.getByTestId('migration-phase2-summary');
    }

    // ── Phase 3 artifacts ────────────────────────────────────────────
    get phase3DomainTable(): Locator {
        return this.frame.getByTestId('migration-phase3-domains');
    }

    /** Per-domain summary links rendered in the Phase 3 table. */
    phase3DomainLinks(): Locator {
        return this.frame.getByTestId('migration-phase3-domain-link');
    }

    /** Per-domain JSON model links rendered in the Phase 3 table. */
    phase3ModelLinks(): Locator {
        return this.frame.getByTestId('migration-phase3-model-link');
    }

    get phase3SummaryButton(): Locator {
        return this.frame.getByTestId('migration-phase3-summary');
    }

    get phase3ModelButton(): Locator {
        return this.frame.getByTestId('migration-phase3-model');
    }

    // ── Phase 4: Target environment / provisioning ───────────────────
    get emulatorRadio(): Locator {
        return this.frame.getByRole('radio', { name: /Local Cosmos DB Emulator/i });
    }

    get testConnectionButton(): Locator {
        return this.frame.getByTestId('migration-test-connection');
    }

    get connectionVerified(): Locator {
        return this.frame.getByTestId('migration-connection-verified');
    }

    get populateSampleDataButton(): Locator {
        return this.frame.getByTestId('migration-populate-sample-data');
    }

    get provisioningSummary(): Locator {
        return this.frame.getByTestId('migration-provisioning-summary');
    }

    // ── Final step: Plan / Start Migration ───────────────────────────
    /** Primary action of the footer SplitButton ("Plan Migration" / "Start Migration"). */
    get migrationActionButton(): Locator {
        return this.frame.getByTestId('migration-action-button');
    }

    /** "View Plan" link, rendered only once a code migration plan exists. */
    get viewPlanLink(): Locator {
        return this.frame.getByTestId('migration-view-plan');
    }

    /**
     * A VS Code editor/preview tab by accessible name. Tabs live in the
     * workbench (outside the webview iframe), reachable via `frame.page()`.
     */
    openedTab(name: string | RegExp): Locator {
        return this.frame.page().getByRole('tab', { name });
    }

    /**
     * Re-activates the Migration Assistant editor tab. Opening an artifact tab
     * makes the webview the inactive tab, so the panel must be refocused before
     * interacting with its controls again.
     */
    async focus(): Promise<void> {
        await this.openedTab(/Cosmos DB Migration Assistant/).click();
        await expect(this.modelDropdown).toBeVisible();
    }

    /**
     * Expands a collapsed accordion phase by clicking its header. The Phase 1
     * panel is open by default; Phases 2–4 must be expanded before their
     * controls become interactable.
     */
    async expandPhase(label: string): Promise<void> {
        await this.phaseHeader(label).click();
    }

    /** Runs a phase end-to-end and waits for its completion badge. */
    async runDiscovery(timeoutMs = 60_000): Promise<void> {
        await expect(this.runDiscoveryButton()).toBeEnabled();
        await this.runDiscoveryButton().click();
        await expect(this.phaseCompleteBadge('phase1')).toBeVisible({ timeout: timeoutMs });
    }

    async runAssessment(timeoutMs = 60_000): Promise<void> {
        await this.expandPhase(PHASE_HEADERS.phase2);
        await expect(this.runAssessmentButton()).toBeEnabled();
        await this.runAssessmentButton().click();
        await expect(this.phaseCompleteBadge('phase2')).toBeVisible({ timeout: timeoutMs });
    }

    async runConversion(timeoutMs = 90_000): Promise<void> {
        await this.expandPhase(PHASE_HEADERS.phase3);
        await expect(this.runConversionButton()).toBeEnabled();
        await this.runConversionButton().click();
        await expect(this.phaseCompleteBadge('phase3')).toBeVisible({ timeout: timeoutMs });
    }
}
