import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDdlParsingChoice, resolveDdlParsingFallback, validateMigrationProject } from '../scripts/validate-migration-project.mjs';

function compatibleProject() {
    return {
        version: 1,
        name: 'migration-app',
        sourceCode: 'parent',
        sessionId: 'session-id',
        consentGiven: true,
        migrationInstructions: 'Preserve repository boundaries.',
        migrationMode: 'plan',
        runCounts: { discovery: 1, assessment: 1, schemaConversion: 1, provisioning: 0 },
        phases: {
            discovery: {
                status: 'complete',
                discoveryInstructions: 'Include archived orders.',
                schemaInventory: { path: 'database', includedFiles: ['schema.sql'], excludedFiles: [] },
                applicationAnalysis: {
                    projectName: 'migration-app',
                    projectType: 'Web API',
                    language: 'TypeScript',
                    frameworks: ['Express'],
                    databaseType: 'PostgreSQL',
                    databaseAccess: 'Prisma',
                    completedAt: '2026-09-03T00:00:00.000Z',
                },
            },
            assessment: {
                status: 'complete',
                assessmentInstructions: 'Keep sales separate.',
                domains: [
                    {
                        name: 'Sales',
                        tables: ['sales.orders'],
                        crossDomainDependencies: [],
                        estimatedTokens: 1000,
                        isMapped: true,
                    },
                ],
                parsedAccessPatterns: [
                    {
                        name: 'GetOrder',
                        type: 'read',
                        tables: ['sales.orders'],
                        frequency: 'high',
                        codeReferences: ['src/orders.ts:10'],
                    },
                ],
                completedAt: '2026-09-03T00:00:00.000Z',
            },
            schemaConversion: {
                status: 'complete',
                schemaConversionInstructions: 'Use tenantId first.',
                domains: ['Sales'],
                completedAt: '2026-09-03T00:00:00.000Z',
            },
            targetEnvironment: { type: 'emulator', endpoint: 'https://localhost:8081', verified: true },
            provisioning: {
                status: 'complete',
                databaseName: 'migration-db',
                containersCreated: ['Orders'],
                sampleDataInserted: true,
                completedAt: '2026-09-03T00:00:00.000Z',
            },
        },
    };
}

test('accepts the complete established project shape', () => {
    assert.deepEqual(validateMigrationProject(compatibleProject()), []);
});

test('validates optional target capacity without changing the model decision', () => {
    const project = compatibleProject();
    for (const capacityMode of ['provisioned', 'serverless']) {
        project.phases.targetEnvironment = { type: 'azure', capacityMode };
        assert.deepEqual(validateMigrationProject(project), []);
    }
    project.phases.targetEnvironment = { type: 'azure', capacityMode: 'provisioned', maxThroughput: 2000 };
    assert.deepEqual(validateMigrationProject(project), []);
    for (const target of [
        { capacityMode: 'invalid' }, { capacityMode: null },
        { capacityMode: 'serverless', maxThroughput: 2000 }, { maxThroughput: 2000 },
        ...[null, 0, 400, 1500, '2000'].map(maxThroughput => ({ capacityMode: 'provisioned', maxThroughput })),
    ]) {
        project.phases.targetEnvironment = { type: 'azure', ...target };
        assert(validateMigrationProject(project).some(error => error.path.startsWith('$.phases.targetEnvironment')));
    }
});

test('validates optional agent activity independently of phase status', () => {
    const project = compatibleProject();
    const execution = {
        version: 1, runId: 'run-123', phase: 'preflight', step: 'volumetrics', activity: 'running',
        startedAt: '2026-10-04T10:00:00.000Z', updatedAt: '2026-10-04T10:00:00.000Z', detail: '',
    };
    for (const activity of ['running', 'waiting-for-decision', 'blocked', 'complete', 'failed', 'cancelled']) {
        project.execution = { ...execution, activity };
        assert.deepEqual(validateMigrationProject(project), []);
    }
    for (const change of [
        { version: 2 }, { runId: '' }, { runId: 'invalid identifier' }, { phase: '__proto__' },
        { phase: 'assessment', step: 'volumetrics' }, { step: undefined }, { activity: 'launching' },
        { startedAt: 'yesterday' }, { updatedAt: '2026-10-03T10:00:00.000Z' }, { detail: 'x'.repeat(501) },
        { allowProvisioning: true }, { 'allow-provisioning': true },
    ]) {
        project.execution = { ...execution, ...change };
        assert(validateMigrationProject(project).some(error => error.path.startsWith('$.execution')));
    }
    project.execution = { ...execution, phase: 'assessment', step: null };
    assert.deepEqual(validateMigrationProject(project), []);
    assert.equal(project.phases.discovery.status, 'complete');
});

test('validates migration-relative file lists and rejects ambiguous or unsafe path formats', () => {
    const project = compatibleProject();
    const valid = { files: ['../schema.sql', 'phases/1-discovery/schema-ddl/copied.sql'], excludedFiles: ['../schema.sql'] };
    project.phases.discovery.schemaInventory = valid;
    assert.deepEqual(validateMigrationProject(project), []);
    project.phases.discovery.schemaInventory = { files: [] };
    assert.deepEqual(validateMigrationProject(project), []);
    project.phases.discovery.schemaInventory = { excludedFiles: ['phases/1-discovery/schema-ddl/ignored.sql'] };
    assert.deepEqual(validateMigrationProject(project), []);
    for (const selection of [
        { ...valid, path: '.' }, { ...valid, includedFiles: ['schema.sql'] },
        { files: 'schema.sql' }, { files: [''] }, { files: [null] }, { files: ['../../outside.sql'] },
        { files: ['/tmp/schema.sql'] }, { files: ['C:/schema.sql'] }, { files: ['..\\schema.sql'] },
        { files: ['../db/../schema.sql'] }, { files: ['.'] }, { files: ['..'] },
        { files: ['../schema.sql'], excludedFiles: ['../../outside.sql'] },
        { excludedFiles: ['../../outside.sql'] }, { excludedFiles: ['/tmp/schema.sql'] },
        { excludedFiles: ['..\\schema.sql'] }, { excludedFiles: [''] },
    ]) {
        project.phases.discovery.schemaInventory = selection;
        assert(validateMigrationProject(project).some(error => error.path.includes('schemaInventory')));
    }
});

test('asks interactively and uses SQLGlot by default only when unattended', () => {
    const project = compatibleProject();
    assert.deepEqual(resolveDdlParsingChoice(project), { needsConfirmation: true });
    assert.deepEqual(resolveDdlParsingChoice(project, { mode: 'autonomous' }), { method: 'sqlglot', decisionSource: 'unattended-default' });
    project.phases.discovery.ddlParsing = { method: 'model', decisionSource: 'explicit' };
    assert.deepEqual(resolveDdlParsingChoice(project, { mode: 'autonomous' }), project.phases.discovery.ddlParsing);
    assert.deepEqual(resolveDdlParsingChoice(project, { requestedMethod: 'sqlglot' }), { method: 'sqlglot', decisionSource: 'explicit' });
    assert.deepEqual(validateMigrationProject(JSON.parse(JSON.stringify(project))), []);
});

test('preserves user decisions but confirms an unattended default on interactive use', () => {
    const project = compatibleProject();
    project.phases.discovery.ddlParsing = { method: 'sqlglot', decisionSource: 'unattended-default' };
    assert.deepEqual(resolveDdlParsingChoice(project), { needsConfirmation: true });
    project.phases.discovery.ddlParsing.decisionSource = 'interactive';
    assert.deepEqual(resolveDdlParsingChoice(project), project.phases.discovery.ddlParsing);
    project.phases.discovery.ddlParsing.method = 'invalid';
    assert(validateMigrationProject(project).some(error => error.path.endsWith('ddlParsing.method')));
});

test('falls back for unsupported dialects while keeping explicit SQLGlot availability strict', () => {
    const unattended = { method: 'sqlglot', decisionSource: 'unattended-default' };
    const unavailable = resolveDdlParsingFallback(unattended, { reason: 'unavailable' });
    assert.equal(unavailable.abort, false);
    assert.match(unavailable.warning, /continuing.*model-only/iu);
    assert.deepEqual(unavailable.choice, {
        method: 'model',
        decisionSource: 'unattended-default',
        fallbackFrom: 'sqlglot',
        fallbackReason: 'unavailable',
    });

    const unsupported = resolveDdlParsingFallback(
        { method: 'sqlglot', decisionSource: 'explicit' },
        { reason: 'unsupported-dialect', dialect: 'DB2' },
    );
    assert.equal(unsupported.abort, false);
    assert.equal(unsupported.researchDialect, true);
    assert.match(unsupported.warning, /DB2/u);
    assert.equal(unsupported.choice.fallbackReason, 'unsupported-dialect');

    const strict = resolveDdlParsingFallback(
        { method: 'sqlglot', decisionSource: 'interactive' },
        { reason: 'unavailable' },
    );
    assert.equal(strict.abort, true);
    assert.equal(strict.choice.method, 'sqlglot');
});

test('validates and resumes recorded automatic model fallbacks', () => {
    const project = compatibleProject();
    project.phases.discovery.ddlParsing = {
        method: 'model',
        decisionSource: 'unattended-default',
        fallbackFrom: 'sqlglot',
        fallbackReason: 'unavailable',
    };
    assert.deepEqual(validateMigrationProject(project), []);
    assert.deepEqual(resolveDdlParsingChoice(project), project.phases.discovery.ddlParsing);
    delete project.phases.discovery.ddlParsing.fallbackReason;
    assert(validateMigrationProject(project).some(error => error.path.endsWith('ddlParsing')));
});

test('accepts backward-compatible Skill extension fields', () => {
    const project = compatibleProject();
    project.phases.discovery.preflightStatus = 'complete';
    project.phases.discovery.preflightCompletedAt = '2026-09-03T00:00:00.000Z';
    project.phases.schemaConversion.thoroughAnalysis = true;
    project.phases.provisioning.artifactPaths = ['.cosmosdb-migration/phases/4-provisioning/main.bicep'];
    project.phases.codeMigration = {
        status: 'complete',
        planPath: '.cosmosdb-migration/code-migration-plan.md',
        outputPaths: ['src/data/cosmosClient.ts'],
        completedAt: '2026-09-03T00:00:00.000Z',
    };
    project.futureProducerField = { preserved: true };
    assert.deepEqual(validateMigrationProject(project), []);
});

test('rejects assessment metadata that would break consumer hydration', () => {
    const project = compatibleProject();
    project.phases.assessment.domains[0].estimatedTokens = 'many';
    delete project.phases.assessment.domains[0].isMapped;
    project.phases.assessment.parsedAccessPatterns[0].tables = 'sales.orders';
    const errors = validateMigrationProject(project);
    assert(errors.some((error) => error.path.endsWith('.estimatedTokens')));
    assert(errors.some((error) => error.path.endsWith('.isMapped')));
    assert(errors.some((error) => error.path.endsWith('.tables')));
});

test('rejects negative and fractional domain token estimates', () => {
    const project = compatibleProject();
    project.phases.assessment.domains[0].estimatedTokens = -1;
    assert(validateMigrationProject(project).some((error) => error.path.endsWith('.estimatedTokens')));
    project.phases.assessment.domains[0].estimatedTokens = 1.5;
    assert(validateMigrationProject(project).some((error) => error.path.endsWith('.estimatedTokens')));
});

test('rejects invalid version 1 enums and missing required base fields while ignoring legacy migration mode', () => {
    const project = compatibleProject();
    project.sourceCode = 'workspace';
    project.migrationMode = 'autonomous';
    project.phases.discovery.status = 'done';
    project.phases.targetEnvironment.type = 'local';
    const errors = validateMigrationProject(project);
    assert(errors.some((error) => error.path === '$.sourceCode'));
    assert(!errors.some((error) => error.path === '$.migrationMode'));
    assert(errors.some((error) => error.path === '$.phases.discovery.status'));
    assert(errors.some((error) => error.path === '$.phases.targetEnvironment.type'));
});
