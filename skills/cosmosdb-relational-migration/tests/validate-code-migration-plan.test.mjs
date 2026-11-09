import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildCompatibilityReport } from '../scripts/check-sdk-compatibility.mjs';
import { readSdkCompatibility } from '../scripts/phase-summary.mjs';
import {
    contentSha256,
    fileSha256,
    validateCodeMigrationPlan,
    validateCodeMigrationRecord,
} from '../scripts/validate-code-migration-plan.mjs';

const MODEL_CONTENT = '{"canonical":true}\n';
const SDK_REPORT = buildCompatibilityReport(['TypeScript']);
const SDK_REPORT_CONTENT = `${JSON.stringify(SDK_REPORT, null, 2)}\n`;
const APPLIED_RULE = 'rules/sdk-singleton-client.md';

function passedCheck(command = 'npm run verify', overrides = {}) {
    return {
        command, status: 'passed', exitCode: 0, checks: ['build', 'behavior'],
        coverage: 'Compiles the data-access layer and tests order identity, partition routing, and serialization.',
        ...overrides,
    };
}

function project(mode, outputPaths = []) {
    return {
        version: 1,
        name: 'migration-app',
        sourceCode: 'parent',
        migrationMode: mode,
        phases: {
            discovery: { status: 'complete', applicationAnalysis: { language: 'TypeScript' } },
            codeMigration: {
                status: 'complete',
                planPath: '.cosmosdb-migration/code-migration-plan.md',
                outputPaths,
                completedAt: '2026-09-07T00:00:00.000Z',
            },
        },
    };
}

function manifest(mode, overrides = {}) {
    return {
        version: 1,
        mode,
        modelSha256: contentSha256(MODEL_CONTENT),
        sdkReportSha256: contentSha256(SDK_REPORT_CONTENT),
        bestPractices: {
            rules: [APPLIED_RULE],
            unresolvedConcerns: [],
        },
        outputFiles: [],
        blockingSteps: [],
        validation: [],
        ...overrides,
    };
}

function options(workspace, migrationProject, sdkReport = SDK_REPORT, sdkReportContent = SDK_REPORT_CONTENT) {
    return { workspace, project: migrationProject, modelContent: MODEL_CONTENT, sdkReport, sdkReportContent };
}

function markdown(manifest) {
    return `# Code Migration Plan

## Overview
Migrate the relational data-access layer.

## Affected Files
Repository and configuration files.

## Ordered Changes
1. Configure the client.

## Access Pattern Migration
Map source reads to point reads.

## Configuration and Authentication
Use environment configuration and managed identity.

## Validation
Run applicable repository checks.

## Rollback
Revert the changed files.

## Applied Rules
${manifest.bestPractices.rules.join('\n')}

## Blocker Review
${
    manifest.blockingSteps.length
    ? `${manifest.blockingSteps.join('\n')}
Evidence: The SDK compatibility report blocks direct migration.
Solutions considered: Upgrade the framework; introduce a supported-language service boundary.
Recommendation: Introduce a supported-language service boundary.
Recommendation rationale: The compatibility report rules out the current SDK, while a service boundary preserves the existing application until a framework upgrade is feasible.
Reason for deferral: The architecture owner must approve the new boundary.
Clearance condition: Record architecture approval.`
    : 'No candidate blockers.'
}

## Unresolved Blockers
${manifest.blockingSteps.length ? manifest.blockingSteps.join('\n') : 'None.'}
`;
}

test('accepts a complete plan-mode review artifact', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-plan-'));
    try {
        const planManifest = manifest('plan', { blockingSteps: ['SDK-001: Choose SDK boundary.'] });
        assert.deepEqual(validateCodeMigrationPlan(markdown(planManifest), planManifest, options(workspace, project('start'))), []);
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('hashes only the pretty-printed SDK compatibility object including its newline', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-sdk-hash-'));
    try {
        const discoveryPath = path.join(workspace, 'discovery-manifest.json');
        const discoveryContent = `${JSON.stringify({
            version: 1,
            blockingIssues: [],
            sdkCompatibility: SDK_REPORT,
        }, null, 2)}\n`;
        fs.writeFileSync(discoveryPath, discoveryContent);
        const { sdkReport, sdkReportContent } = readSdkCompatibility(discoveryPath);
        assert.equal(sdkReportContent, `${JSON.stringify(sdkReport, null, 2)}\n`);
        const validationOptions = options(workspace, project('plan'), sdkReport, sdkReportContent);
        const correct = manifest('plan', { sdkReportSha256: contentSha256(sdkReportContent) });
        assert.deepEqual(validateCodeMigrationPlan(markdown(correct), correct, validationOptions), []);

        for (const incorrectContent of [discoveryContent, JSON.stringify(sdkReport, null, 2)]) {
            const incorrect = manifest('plan', { sdkReportSha256: contentSha256(incorrectContent) });
            const errors = validateCodeMigrationPlan(markdown(incorrect), incorrect, validationOptions);
            assert.deepEqual(errors.map(error => error.path), ['$.manifest.sdkReportSha256']);
        }
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('accepts advisory best-practice concerns without bypassing execution checks', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-advisory-'));
    try {
        const relativePath = 'src/orders.ts';
        const outputPath = path.join(workspace, relativePath);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, 'export const migrated = true;\n');
        const migrateManifest = manifest('migrate', {
            bestPractices: { rules: [APPLIED_RULE], unresolvedConcerns: ['Tune indexing with production measurements.'] },
            outputFiles: [{ path: relativePath, sha256: fileSha256(outputPath) }],
            validation: [passedCheck()],
        });
        const validationOptions = options(workspace, project('start', [relativePath]));
        assert.deepEqual(validateCodeMigrationPlan(markdown(migrateManifest), migrateManifest, validationOptions), []);
        assert.deepEqual(migrateManifest.bestPractices.unresolvedConcerns, ['Tune indexing with production measurements.']);
        migrateManifest.validation[0].exitCode = 1;
        assert(validateCodeMigrationPlan(markdown(migrateManifest), migrateManifest, validationOptions)
            .some(error => error.path === '$.manifest.validation[0].exitCode'));
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('accepts migrate mode with current output evidence regardless of persisted migration mode', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-start-'));
    const relativePath = 'src/orders.ts';
    const outputPath = path.join(workspace, relativePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'export const migrated = true;\n');
    try {
        const migrateManifest = manifest('migrate', {
            outputFiles: [{ path: relativePath, sha256: fileSha256(outputPath) }],
            validation: [passedCheck()],
        });
        assert.deepEqual(
            validateCodeMigrationPlan(markdown(migrateManifest), migrateManifest, options(workspace, project('plan', [relativePath]))),
            [],
        );
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('does not equate a successful arbitrary command with build and behavior coverage', () => {
    for (const validation of [
        [],
        [{ command: 'echo ok', status: 'passed', exitCode: 0 }],
        [passedCheck('echo ok', { checks: ['other'], coverage: 'Checks terminal availability only.' })],
        [passedCheck('npm run build', { checks: ['build'] })],
        [passedCheck('npm test', { checks: ['behavior'] })],
    ]) {
        const record = manifest('migrate', { validation });
        for (const validate of [validateCodeMigrationPlan, validateCodeMigrationRecord]) {
            const errors = validate(markdown(record), record, options(process.cwd(), project('start')));
            assert(errors.some(error => error.path === '$.manifest.validation'));
        }
    }
});

test('accepts combined or separate declared checks without classifying command names', () => {
    for (const validation of [
        [passedCheck('./custom-verify')],
        [passedCheck('echo ok')],
        [passedCheck('./compile', { checks: ['build'] }), passedCheck('./exercise-orders', { checks: ['behavior'] })],
        [
            { checks: ['build'], coverage: 'Interpreted application has no compile target.', status: 'not-applicable', reason: 'No build stage in the repository.' },
            passedCheck('./exercise-orders', { checks: ['behavior'] }),
        ],
        [{ checks: ['build', 'behavior'], coverage: 'Documentation-only iteration with no code or configuration changes.', status: 'not-applicable', reason: 'Only corrected prose; no executable changes.' }],
    ]) {
        const record = manifest('migrate', { validation });
        assert.deepEqual(validateCodeMigrationPlan(markdown(record), record, options(process.cwd(), project('start'))), []);
        assert.deepEqual(validateCodeMigrationRecord(markdown(record), record, { workspace: process.cwd(), project: project('start') }), []);
    }
});

test('rejects incomplete coverage declarations and unexecuted or failed checks', () => {
    for (const result of [
        passedCheck('', {}), passedCheck('./verify', { coverage: ' ' }),
        passedCheck('./verify', { checks: ['build', 'unknown'] }),
        passedCheck('./verify', { checks: ['build', 'build'] }),
        passedCheck('./verify', { status: 'failed', exitCode: 1 }),
        passedCheck('./verify', { status: 'not-run' }),
        { checks: ['build', 'behavior'], coverage: 'Application checks', status: 'not-applicable', reason: '' },
        { checks: ['build', 'behavior'], coverage: 'Application checks', status: 'not-applicable', reason: 'No applicable check', command: 'none' },
    ]) {
        const record = manifest('migrate', { validation: [result] });
        const errors = validateCodeMigrationPlan(markdown(record), record, options(process.cwd(), project('start')));
        assert(errors.some(error => error.path.startsWith('$.manifest.validation')));
    }
});

test('rejects unsupported SDKs, blockers, and failed validation in migrate mode', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-start-invalid-'));
    try {
        const migrateManifest = manifest('migrate', {
            blockingSteps: ['SDK-001: No supported SDK.'],
            validation: [passedCheck('npm run verify', { exitCode: 1 })],
        });
        const unsupportedReport = buildCompatibilityReport(['Perl']);
        const unsupportedContent = `${JSON.stringify(unsupportedReport, null, 2)}\n`;
        migrateManifest.sdkReportSha256 = contentSha256(unsupportedContent);
        const migrationProject = project('start');
        migrationProject.phases.discovery.applicationAnalysis.language = 'Perl';
        const errors = validateCodeMigrationPlan(
            markdown(migrateManifest),
            migrateManifest,
            options(workspace, migrationProject, unsupportedReport, unsupportedContent),
        );
        assert(errors.some((error) => error.path === '$.sdkReport.codeMigrationAllowed'));
        assert(errors.some((error) => error.path === '$.manifest.blockingSteps'));
        assert(errors.some((error) => error.path === '$.manifest.validation'));
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('rejects forged SDK reports with matching hashes at invocation time but preserves history', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-sdk-evidence-'));
    const relativePath = 'repository.ts';
    fs.writeFileSync(path.join(workspace, relativePath), 'test output\n');
    try {
        const migrationProject = project('start', [relativePath]);
        migrationProject.phases.discovery.applicationAnalysis.language = 'TypeScript, Perl';
        for (const mutate of [
            report => { report.codeMigrationAllowed = true; },
            report => { report.results = []; report.overallStatus = 'supported'; report.codeMigrationAllowed = true; },
            report => { report.results = report.results.filter(result => result.language !== 'Perl'); report.overallStatus = 'supported'; report.codeMigrationAllowed = true; },
            report => { const result = report.results.find(entry => entry.language === 'Perl'); Object.assign(result, { status: 'supported', sdkFamily: 'nodejs', sdkDisplayName: 'Node.js', package: '@azure/cosmos' }); report.overallStatus = 'supported'; report.codeMigrationAllowed = true; },
        ]) {
            const report = buildCompatibilityReport(['TypeScript', 'Perl']);
            mutate(report);
            const reportContent = `${JSON.stringify(report, null, 2)}\n`;
            const context = options(workspace, migrationProject, report, reportContent);
            const planManifest = manifest('migrate', {
                sdkReportSha256: contentSha256(reportContent),
                outputFiles: [{ path: relativePath }],
                validation: [passedCheck()],
            });
            const plan = markdown(planManifest);
            const errors = validateCodeMigrationPlan(plan, planManifest, context);
            assert(errors.some(error => error.path.startsWith('$.sdkReport')));
            assert(!errors.some(error => error.path === '$.manifest.sdkReportSha256'));
            assert.deepEqual(validateCodeMigrationRecord(plan, planManifest, context), []);
        }
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('permits unsupported-language planning and supported, interoperable or preview migration', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-sdk-valid-'));
    try {
        for (const language of ['Perl', 'TypeScript', 'Kotlin', 'Rust']) {
            const migrationProject = project('plan');
            migrationProject.phases.discovery.applicationAnalysis.language = language;
            const report = buildCompatibilityReport([language]);
            const reportContent = `${JSON.stringify(report, null, 2)}\n`;
            const planManifest = manifest(language === 'Perl' ? 'plan' : 'migrate', {
                sdkReportSha256: contentSha256(reportContent),
                blockingSteps: language === 'Perl' ? ['SDK-001: Choose a supported-language boundary.'] : [],
                validation: language === 'Perl' ? [] : [passedCheck()],
            });
            assert.deepEqual(validateCodeMigrationPlan(markdown(planManifest), planManifest, options(workspace, migrationProject, report, reportContent)), []);
        }
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('preserves historical completion after outputs and inputs change or disappear', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-history-'));
    const relativePath = 'src/orders.ts';
    const outputPath = path.join(workspace, relativePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'original\n');
    const migrationProject = project('start', [relativePath]);
    const planManifest = manifest('migrate', {
        outputFiles: [{ path: relativePath, sha256: fileSha256(outputPath) }],
        validation: [passedCheck()],
    });
    const plan = markdown(planManifest);
    try {
        assert.deepEqual(validateCodeMigrationPlan(plan, planManifest, options(workspace, migrationProject)), []);
        fs.writeFileSync(outputPath, 'next iteration\n');
        assert(validateCodeMigrationPlan(plan, planManifest, options(workspace, migrationProject)).length > 0);
        assert.deepEqual(validateCodeMigrationRecord(plan, planManifest, { workspace, project: migrationProject }), []);
        fs.rmSync(outputPath);
        assert.deepEqual(validateCodeMigrationRecord(plan, planManifest, { workspace, project: migrationProject }), []);
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('accepts optional output hashes without relaxing iteration validation', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-optional-hash-'));
    const relativePath = 'orders.ts';
    const migrationProject = project('start', [relativePath]);
    const planManifest = manifest('migrate', {
        outputFiles: [{ path: relativePath }],
        validation: [passedCheck()],
    });
    const plan = markdown(planManifest);
    try {
        assert(validateCodeMigrationPlan(plan, planManifest, options(workspace, migrationProject)).length > 0);
        fs.writeFileSync(path.join(workspace, relativePath), 'migrated\n');
        assert.deepEqual(validateCodeMigrationPlan(plan, planManifest, options(workspace, migrationProject)), []);
        assert.deepEqual(validateCodeMigrationRecord(plan, planManifest, { workspace, project: migrationProject }), []);
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('historical records still reject failed checks, blockers and unsafe output paths', () => {
    const workspace = process.cwd();
    const planManifest = manifest('migrate', {
        outputFiles: [{ path: '../outside.ts' }],
        blockingSteps: ['SDK-001: Resolve SDK support.'],
        validation: [passedCheck('npm run verify', { exitCode: 1 })],
    });
    const errors = validateCodeMigrationRecord(markdown(planManifest), planManifest, { workspace, project: project('start', ['../outside.ts']) });
    assert(errors.some(error => error.message.includes('inside the workspace')));
    assert(errors.some(error => error.path === '$.manifest.blockingSteps'));
    assert(errors.some(error => error.path === '$.manifest.validation'));
});

test('rejects output path traversal and stale hashes', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-path-invalid-'));
    const relativePath = 'src/orders.ts';
    const outputPath = path.join(workspace, relativePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'changed\n');
    try {
        const migrateManifest = manifest('migrate', {
            outputFiles: [
                { path: '../outside.ts', sha256: '0'.repeat(64) },
                { path: relativePath, sha256: '0'.repeat(64) },
            ],
            validation: [passedCheck()],
        });
        const errors = validateCodeMigrationPlan(
            markdown(migrateManifest),
            migrateManifest,
            options(workspace, project('start', ['../outside.ts', relativePath])),
        );
        assert(errors.some((error) => error.message.includes('inside the workspace')));
        assert(errors.some((error) => error.message.includes('current file bytes')));
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('requires every human-review section', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-sections-'));
    try {
        const errors = validateCodeMigrationPlan('# Code Migration Plan\n', manifest('plan'), {
            ...options(workspace, project('plan')),
        });
        assert(errors.some((error) => error.path === '$.sections.rollback'));
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('reports a non-object project as invalid instead of throwing', () => {
    const errors = validateCodeMigrationPlan('# Code Migration Plan\n', manifest('plan'), {
        workspace: process.cwd(),
        project: undefined,
        modelContent: MODEL_CONTENT,
        sdkReport: SDK_REPORT,
        sdkReportContent: SDK_REPORT_CONTENT,
    });
    assert(errors.some((error) => error.path === '$.project'));
});

test('reports a legacy plan without Blocker Review as invalid instead of throwing', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-legacy-sections-'));
    try {
        const planManifest = manifest('plan', { blockingSteps: ['SDK-001: Select a supported SDK boundary.'] });
        const legacyPlan = markdown(planManifest).replace(/## Blocker Review\n[\s\S]*?\n\n(?=## Unresolved Blockers)/u, '');
        const errors = validateCodeMigrationPlan(legacyPlan, planManifest, options(workspace, project('plan')));
        assert(errors.some((error) => error.path === '$.sections.blockerReview'));
        assert(errors.some((error) => error.path === '$.manifest.blockingSteps[0]'));
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('requires every deferred blocker in the review and unresolved sections', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-blocker-review-'));
    try {
        const planManifest = manifest('plan', { blockingSteps: ['SDK-001: Select a supported SDK boundary.'] });
        const plan = markdown(planManifest).replace(
            '## Blocker Review\nSDK-001: Select a supported SDK boundary.',
            '## Blocker Review\nReviewed SDK compatibility.',
        );
        const errors = validateCodeMigrationPlan(plan, planManifest, options(workspace, project('plan')));
        assert(errors.some((error) => error.path === '$.manifest.blockingSteps[0]'));
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('requires a rationale for blocker recommendations', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-blocker-rationale-'));
    try {
        const planManifest = manifest('plan', { blockingSteps: ['SDK-001: Select a supported SDK boundary.'] });
        const plan = markdown(planManifest).replace(
            /^Recommendation rationale:.*$/mu,
            'The service boundary is recommended.',
        );
        const errors = validateCodeMigrationPlan(plan, planManifest, options(workspace, project('plan')));
        assert(
            errors.some(
                (error) => error.path === '$.sections.blockerReview' && error.message.includes('Recommendation rationale:'),
            ),
        );
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('rejects stale model and SDK input hashes', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-input-hash-'));
    try {
        const planManifest = manifest('plan');
        planManifest.modelSha256 = '0'.repeat(64);
        planManifest.sdkReportSha256 = '1'.repeat(64);
        const errors = validateCodeMigrationPlan(markdown(planManifest), planManifest, options(workspace, project('plan')));
        assert(errors.some((error) => error.path === '$.manifest.modelSha256'));
        assert(errors.some((error) => error.path === '$.manifest.sdkReportSha256'));
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('rejects duplicate checkpoint paths, invalid timestamps, and contradictory result fields', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-evidence-shape-'));
    const relativePath = 'src/orders.ts';
    const outputPath = path.join(workspace, relativePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'changed\n');
    try {
        const migrationProject = project('start', [relativePath, relativePath]);
        migrationProject.phases.codeMigration.completedAt = 'yesterday';
        migrationProject.phases.codeMigration.planPath = 'plans/code-migration.md';
        const migrateManifest = manifest('migrate', {
            outputFiles: [{ path: relativePath, sha256: fileSha256(outputPath) }],
            validation: [
                passedCheck('npm run verify', { reason: 'contradiction' }),
                { checks: ['other'], coverage: 'Lint configuration', status: 'not-applicable', reason: 'No lint configured.', exitCode: 0 },
            ],
        });
        const errors = validateCodeMigrationPlan(markdown(migrateManifest), migrateManifest, options(workspace, migrationProject));
        assert(errors.some((error) => error.path === '$.project.phases.codeMigration.outputPaths'));
        assert(errors.some((error) => error.path === '$.project.phases.codeMigration.completedAt'));
        assert(errors.some((error) => error.path === '$.project.phases.codeMigration.planPath'));
        assert(errors.some((error) => error.path.endsWith('.reason') && error.message.includes('omitted')));
        assert(errors.some((error) => error.path.endsWith('.exitCode') && error.message.includes('omitted')));
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('rejects rule provenance mismatch without treating advisory concerns as failures', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-rules-'));
    try {
        const migrateManifest = manifest('migrate', {
            bestPractices: {
                rules: [APPLIED_RULE, APPLIED_RULE],
                unresolvedConcerns: ['pagination'],
            },
            validation: [passedCheck()],
        });
        const plan = markdown(migrateManifest).replace(
            /## Applied Rules\n[\s\S]*?\n\n## Unresolved Blockers/u,
            '## Applied Rules\nrules/different.md\n\n## Unresolved Blockers',
        );
        const errors = validateCodeMigrationPlan(plan, migrateManifest, options(workspace, project('start')));
        assert(errors.some((error) => error.path === '$.manifest.bestPractices.rules'));
        assert(errors.some((error) => error.path === '$.sections.rules'));
        assert(!errors.some((error) => error.path === '$.manifest.bestPractices.unresolvedConcerns'));
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('rejects malformed best-practice concern records', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'code-concern-shape-'));
    try {
        for (const unresolvedConcerns of [undefined, null, 'pagination', [null], [''], [' '], [1]]) {
            const planManifest = manifest('plan', { bestPractices: { rules: [APPLIED_RULE], unresolvedConcerns } });
            assert(validateCodeMigrationPlan(markdown(planManifest), planManifest, options(workspace, project('plan')))
                .some(error => error.path === '$.manifest.bestPractices.unresolvedConcerns'));
        }
    } finally {
        fs.rmSync(workspace, { recursive: true });
    }
});

test('rejects output symlinks that escape the workspace', (context) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-symlink-'));
    const workspace = path.join(root, 'workspace');
    const outsidePath = path.join(root, 'outside.ts');
    const symlinkPath = path.join(workspace, 'src', 'linked.ts');
    fs.mkdirSync(path.dirname(symlinkPath), { recursive: true });
    fs.writeFileSync(outsidePath, 'outside\n');
    try {
        fs.symlinkSync(outsidePath, symlinkPath);
    } catch {
        fs.rmSync(root, { recursive: true });
        context.skip('symlinks are unavailable');
        return;
    }
    try {
        const relativePath = 'src/linked.ts';
        const migrateManifest = manifest('migrate', {
            outputFiles: [{ path: relativePath, sha256: fileSha256(outsidePath) }],
            validation: [passedCheck()],
        });
        const errors = validateCodeMigrationPlan(
            markdown(migrateManifest),
            migrateManifest,
            options(workspace, project('start', [relativePath])),
        );
        assert(errors.some((error) => error.message.includes('after resolving symlinks')));
    } finally {
        fs.rmSync(root, { recursive: true });
    }
});
