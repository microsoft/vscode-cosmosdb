#!/usr/bin/env node
// Purpose: Validate code migration plans, manifests, and SDK compatibility evidence.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCompatibilityReport } from './check-sdk-compatibility.mjs';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { readSdkCompatibility } from './phase-summary.mjs';
import { validateMigrationProject } from './validate-migration-project.mjs';

const REQUIRED_SECTIONS = {
    overview: ['overview'],
    affectedFiles: ['affected files'],
    orderedChanges: ['ordered changes'],
    accessPatterns: ['access pattern migration'],
    configuration: ['configuration and authentication'],
    validation: ['validation'],
    rollback: ['rollback'],
    rules: ['applied rules'],
    blockerReview: ['blocker review'],
    blockers: ['unresolved blockers'],
};
const MANIFEST_KEYS = new Set([
    'version',
    'mode',
    'modelSha256',
    'sdkReportSha256',
    'bestPractices',
    'outputFiles',
    'blockingSteps',
    'validation',
]);
const BEST_PRACTICES_KEYS = new Set(['rules', 'unresolvedConcerns']);
const OUTPUT_KEYS = new Set(['path', 'sha256']);
const VALIDATION_KEYS = new Set(['command', 'status', 'exitCode', 'reason', 'checks', 'coverage']);
const VALIDATION_CHECKS = new Set(['build', 'behavior', 'other']);

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, jsonPath, message) {
    errors.push({ path: jsonPath, message });
}

function normalizeHeading(value) {
    return value
        .toLocaleLowerCase('en-US')
        .replace(/[`*_]/gu, ' ')
        .replace(/[^a-z0-9]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

function markdownSections(markdown) {
    const sections = new Map();
    let current;
    for (const line of markdown.split(/\r?\n/gu)) {
        const heading = line.match(/^#{1,6}\s+(.+?)\s*$/u)?.[1];
        if (heading) {
            current = normalizeHeading(heading);
            if (!sections.has(current)) sections.set(current, []);
        } else if (current) {
            sections.get(current).push(line);
        }
    }
    return new Map([...sections].map(([heading, lines]) => [heading, lines.join('\n').trim()]));
}

function checkObject(value, jsonPath, allowedKeys, errors) {
    if (!isObject(value)) {
        addError(errors, jsonPath, 'must be an object');
        return false;
    }
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) addError(errors, `${jsonPath}.${key}`, 'is not allowed');
    }
    return true;
}

function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isWithinWorkspace(workspace, filePath) {
    const relative = path.relative(path.resolve(workspace), path.resolve(filePath));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isRealPathWithinWorkspace(workspace, filePath) {
    try {
        return isWithinWorkspace(fs.realpathSync(workspace), fs.realpathSync(filePath));
    } catch {
        return false;
    }
}

function isUtcIsoDateTime(value) {
    if (!nonEmptyString(value) || !Number.isFinite(Date.parse(value))) return false;
    return new Date(value).toISOString() === value;
}

function resolveOutputPath(workspace, value, jsonPath, errors, checkCurrentFiles) {
    if (!nonEmptyString(value)) {
        addError(errors, jsonPath, 'must be a non-empty workspace-relative path');
        return undefined;
    }
    if (path.isAbsolute(value)) {
        addError(errors, jsonPath, 'must not be absolute');
        return undefined;
    }
    const resolved = path.resolve(workspace, value);
    if (!isWithinWorkspace(workspace, resolved)) {
        addError(errors, jsonPath, 'must remain inside the workspace');
        return undefined;
    }
    const relative = path.relative(workspace, resolved);
    if (relative === '.cosmosdb-migration' || relative.startsWith(`.cosmosdb-migration${path.sep}`)) {
        addError(errors, jsonPath, 'must not target migration checkpoint artifacts');
        return undefined;
    }
    if (checkCurrentFiles && fs.existsSync(resolved) && !isRealPathWithinWorkspace(workspace, resolved)) {
        addError(errors, jsonPath, 'must remain inside the workspace after resolving symlinks');
        return undefined;
    }
    return resolved;
}

export function fileSha256(filePath) {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function contentSha256(content) {
    return createHash('sha256').update(content).digest('hex');
}

export function validateCodeMigrationPlan(markdown, manifest, options) {
    return validatePlan(markdown, manifest, options, true);
}

export function validateCodeMigrationRecord(markdown, manifest, options) {
    return validatePlan(markdown, manifest, options, false);
}

function validatePlan(markdown, manifest, { workspace, project, modelContent, sdkReport, sdkReportContent }, checkCurrentFiles) {
    const errors = validateMigrationProject(project).map((error) => ({
        path: `$.project${error.path.slice(1)}`,
        message: error.message,
    }));
    if (errors.length > 0) return errors;
    if (typeof markdown !== 'string' || markdown.trim().length === 0) {
        return [...errors, { path: '$', message: 'plan must be non-empty Markdown' }];
    }
    const sections = markdownSections(markdown);
    const matchedSections = {};
    for (const [name, aliases] of Object.entries(REQUIRED_SECTIONS)) {
        const alias = aliases.find((candidate) => sections.has(candidate));
        if (!alias || !sections.get(alias)) {
            addError(errors, `$.sections.${name}`, `missing or empty required section (${aliases.join(' or ')})`);
        } else {
            matchedSections[name] = sections.get(alias);
        }
    }
    if (matchedSections.blockerReview && matchedSections.blockerReview !== 'No candidate blockers.') {
        for (const label of ['Evidence:', 'Solutions considered:', 'Recommendation:', 'Recommendation rationale:']) {
            if (!matchedSections.blockerReview.includes(label)) {
                addError(errors, '$.sections.blockerReview', `must include ${label}`);
            }
        }
    }

    if (!checkObject(manifest, '$.manifest', MANIFEST_KEYS, errors)) return errors;
    if (manifest.version !== 1) addError(errors, '$.manifest.version', 'must equal 1');
    if (!['plan', 'migrate'].includes(manifest.mode)) addError(errors, '$.manifest.mode', 'must be plan or migrate');
    for (const field of ['modelSha256', 'sdkReportSha256']) {
        if (!/^[0-9a-f]{64}$/u.test(manifest[field] ?? '')) {
            addError(errors, `$.manifest.${field}`, 'must be a lowercase SHA-256 value');
        }
    }
    if (checkCurrentFiles && (!nonEmptyString(modelContent) || manifest.modelSha256 !== contentSha256(modelContent ?? ''))) {
        addError(errors, '$.manifest.modelSha256', 'must match the exact canonical model file bytes');
    }
    if (checkCurrentFiles && (!nonEmptyString(sdkReportContent) || manifest.sdkReportSha256 !== contentSha256(sdkReportContent ?? ''))) {
        addError(errors, '$.manifest.sdkReportSha256', 'must match the serialized sdkCompatibility object from discovery-manifest.json');
    }
    if (checkObject(manifest.bestPractices, '$.manifest.bestPractices', BEST_PRACTICES_KEYS, errors)) {
        if (
            !Array.isArray(manifest.bestPractices.rules) ||
            manifest.bestPractices.rules.length === 0 ||
            manifest.bestPractices.rules.some((rule) => !nonEmptyString(rule))
        ) {
            addError(errors, '$.manifest.bestPractices.rules', 'must be a non-empty array of rule identifiers');
        } else {
            const uniqueRules = new Set(manifest.bestPractices.rules);
            if (uniqueRules.size !== manifest.bestPractices.rules.length) {
                addError(errors, '$.manifest.bestPractices.rules', 'must not contain duplicate rule identifiers');
            }
            for (const rule of uniqueRules) {
                if (!(matchedSections.rules ?? '').includes(rule)) {
                    addError(errors, '$.sections.rules', `must list applied rule ${rule}`);
                }
            }
        }
        if (
            !Array.isArray(manifest.bestPractices.unresolvedConcerns) ||
            manifest.bestPractices.unresolvedConcerns.some((item) => !nonEmptyString(item))
        ) {
            addError(errors, '$.manifest.bestPractices.unresolvedConcerns', 'must be an array of non-empty strings');
        }
    }
    if (!Array.isArray(manifest.outputFiles)) addError(errors, '$.manifest.outputFiles', 'must be an array');
    if (!Array.isArray(manifest.blockingSteps) || manifest.blockingSteps.some((step) => !nonEmptyString(step))) {
        addError(errors, '$.manifest.blockingSteps', 'must be an array of non-empty strings');
    } else {
        for (const [index, step] of manifest.blockingSteps.entries()) {
            if (!/^[A-Z][A-Z0-9-]*-\d{3}:\s+\S/u.test(step)) {
                addError(
                    errors,
                    `$.manifest.blockingSteps[${index}]`,
                    'must start with a stable identifier such as SDK-001:',
                );
            }
            if (!(matchedSections.blockerReview ?? '').includes(step)) {
                addError(errors, `$.manifest.blockingSteps[${index}]`, 'must appear in Blocker Review');
            }
            if (!(matchedSections.blockers ?? '').includes(step)) {
                addError(errors, `$.manifest.blockingSteps[${index}]`, 'must appear in Unresolved Blockers');
            }
        }
    }
    if (!Array.isArray(manifest.validation)) addError(errors, '$.manifest.validation', 'must be an array');
    const sdkValidation = checkCurrentFiles ? validateCompatibilityReport(
        sdkReport,
        String(project.phases.discovery.applicationAnalysis?.language ?? '').split(',').map(language => language.trim()).filter(Boolean),
    ) : undefined;
    if (sdkValidation) {
        errors.push(...sdkValidation.errors.map(error => ({ path: `$.sdkReport${error.path.slice(1)}`, message: error.message })));
    }
    const codeMigration = isObject(project.phases) ? project.phases.codeMigration : undefined;
    const expectedPlanPath = path.normalize('.cosmosdb-migration/code-migration-plan.md');
    if (path.normalize(codeMigration?.planPath ?? '') !== expectedPlanPath) {
        addError(errors, '$.project.phases.codeMigration.planPath', `must equal ${expectedPlanPath}`);
    }
    if (!isUtcIsoDateTime(codeMigration?.completedAt)) {
        addError(errors, '$.project.phases.codeMigration.completedAt', 'must be an ISO 8601 UTC timestamp');
    }

    const outputFiles = Array.isArray(manifest.outputFiles) ? manifest.outputFiles : [];
    const seenPaths = new Set();
    for (const [index, output] of outputFiles.entries()) {
        const outputPath = `$.manifest.outputFiles[${index}]`;
        if (!checkObject(output, outputPath, OUTPUT_KEYS, errors)) continue;
        const resolved = resolveOutputPath(workspace, output.path, `${outputPath}.path`, errors, checkCurrentFiles);
        if (nonEmptyString(output.path)) {
            const normalized = path.normalize(output.path);
            if (seenPaths.has(normalized)) addError(errors, `${outputPath}.path`, 'duplicates an output path');
            seenPaths.add(normalized);
        }
        if (output.sha256 !== undefined && !/^[0-9a-f]{64}$/u.test(output.sha256)) {
            addError(errors, `${outputPath}.sha256`, 'must be a lowercase SHA-256 value');
        } else if (resolved && checkCurrentFiles) {
            if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
                addError(errors, `${outputPath}.path`, 'does not identify an existing file');
            } else if (output.sha256 !== undefined && fileSha256(resolved) !== output.sha256) {
                addError(errors, `${outputPath}.sha256`, 'does not match current file bytes');
            }
        }
    }

    const validation = Array.isArray(manifest.validation) ? manifest.validation : [];
    const accountedChecks = new Set();
    for (const [index, result] of validation.entries()) {
        const resultPath = `$.manifest.validation[${index}]`;
        const errorCount = errors.length;
        if (!checkObject(result, resultPath, VALIDATION_KEYS, errors)) continue;
        if (
            !Array.isArray(result.checks) || result.checks.length === 0 ||
            result.checks.some(check => !VALIDATION_CHECKS.has(check)) ||
            new Set(result.checks).size !== result.checks.length
        ) {
            addError(errors, `${resultPath}.checks`, 'must list unique check categories: build, behavior, or other');
        }
        if (!nonEmptyString(result.coverage)) {
            addError(errors, `${resultPath}.coverage`, 'must describe the validation scope and coverage');
        }
        if (result.status === 'passed') {
            if (!nonEmptyString(result.command)) addError(errors, `${resultPath}.command`, 'must be a non-empty string');
            if (result.exitCode !== 0) addError(errors, `${resultPath}.exitCode`, 'must equal 0 when status is passed');
            if (result.reason !== undefined) addError(errors, `${resultPath}.reason`, 'must be omitted when status is passed');
        } else if (result.status === 'not-applicable') {
            if (result.command !== undefined) addError(errors, `${resultPath}.command`, 'must be omitted when no check applies');
            if (!nonEmptyString(result.reason)) {
                addError(errors, `${resultPath}.reason`, 'is required when status is not-applicable');
            }
            if (result.exitCode !== undefined) {
                addError(errors, `${resultPath}.exitCode`, 'must be omitted when status is not-applicable');
            }
        } else {
            addError(errors, `${resultPath}.status`, 'must be passed or not-applicable');
        }
        if (errors.length === errorCount) {
            for (const check of result.checks) accountedChecks.add(check);
        }
    }

    if (manifest.mode === 'plan') {
        if (outputFiles.length > 0) addError(errors, '$.manifest.outputFiles', 'must be empty in plan mode');
    } else if (manifest.mode === 'migrate') {
        if (checkCurrentFiles && sdkValidation?.codeMigrationAllowed !== true) {
            addError(errors, '$.sdkReport.codeMigrationAllowed', 'validated language results must permit migration');
        }
        if (manifest.blockingSteps?.length > 0) {
            addError(errors, '$.manifest.blockingSteps', 'must be empty in migrate mode');
        }
        for (const check of ['build', 'behavior']) {
            if (!accountedChecks.has(check)) {
                addError(errors, '$.manifest.validation', `must account for ${check} checks with coverage and a passing result or a reason they do not apply`);
            }
        }
        const checkpointPathList = (codeMigration?.outputPaths ?? []).map((value) =>
            path.normalize(value),
        );
        const checkpointPaths = new Set(checkpointPathList);
        if (checkpointPaths.size !== checkpointPathList.length) {
            addError(errors, '$.project.phases.codeMigration.outputPaths', 'must not contain duplicate paths');
        }
        if (checkpointPaths.size !== seenPaths.size || [...checkpointPaths].some((value) => !seenPaths.has(value))) {
            addError(errors, '$.manifest.outputFiles', 'must match project codeMigration.outputPaths');
        }
    }
    return errors;
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node validate-code-migration-plan.mjs --project <project.json> --sdk-report <manifest.json> --manifest <manifest.json> <summary.md> [--workspace <path>]

Read-only validation of the code-migration plan and evidence; never edits application code.
Paths resolve from the current working directory, not from --workspace.

    --workspace <path>  Application root; default current working directory. Supplies canonical model.
    --project <path>    Required migration project.json.
    --sdk-report <path> Required discovery manifest containing SDK compatibility evidence.
    --manifest <path>   Required code-migration manifest.
    <summary.md>       Required plan Markdown, positional (not --summary).

Outputs JSON {valid, errors}. Exit: 0 when valid; 1 for invalid or missing evidence/arguments.
Checks declared coverage and result consistency, not command names, execution, or test quality.
`)) return 0;
    try {
        let workspace = process.cwd();
        let projectPath;
        let sdkReportPath;
        let manifestPath;
        let planPath;
        for (let index = 0; index < argv.length; index++) {
            if (argv[index] === '--workspace') workspace = path.resolve(requireOptionValue(argv, index++));
            else if (argv[index] === '--project') projectPath = path.resolve(requireOptionValue(argv, index++));
            else if (argv[index] === '--sdk-report') sdkReportPath = path.resolve(requireOptionValue(argv, index++));
            else if (argv[index] === '--manifest') manifestPath = path.resolve(requireOptionValue(argv, index++));
            else if (!planPath) planPath = path.resolve(argv[index]);
            else throw new Error(`Unexpected argument: ${argv[index]}`);
        }
        if (!projectPath || !sdkReportPath || !manifestPath || !planPath) {
            process.stderr.write(
                'Usage: validate-code-migration-plan.mjs [--workspace <path>] --project <project.json> --sdk-report <manifest.json> --manifest <manifest.json> <summary.md>\n',
            );
            return 1;
        }
        const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
        const modelPath = path.join(workspace, '.cosmosdb-migration', 'phases', '3-schema-conversion', 'model.json');
        const modelContent = fs.readFileSync(modelPath, 'utf8');
        const { sdkReport, sdkReportContent } = readSdkCompatibility(sdkReportPath);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const markdown = fs.readFileSync(planPath, 'utf8');
        const errors = validateCodeMigrationPlan(markdown, manifest, {
            workspace,
            project,
            modelContent,
            sdkReport,
            sdkReportContent,
        });
        process.stdout.write(`${JSON.stringify({ valid: errors.length === 0, errors }, null, 2)}\n`);
        return errors.length === 0 ? 0 : 1;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
