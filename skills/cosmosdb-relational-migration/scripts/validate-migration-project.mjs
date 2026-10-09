#!/usr/bin/env node
// Purpose: Validate migration project state and resolve DDL parsing choices.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { showHelp } from './cli-help.mjs';

const PHASE_STATUSES = new Set(['not-started', 'in-progress', 'complete']);
const TARGET_TYPES = new Set(['emulator', 'azure', 'provision']);
const DDL_METHODS = new Set(['sqlglot', 'model']);
const DDL_DECISIONS = new Set(['interactive', 'explicit', 'unattended-default']);
const DDL_FALLBACK_REASONS = new Set(['unsupported-dialect', 'unavailable']);

function ddlParsingChoiceError(choice) {
    if (!choice || !DDL_METHODS.has(choice.method) || !DDL_DECISIONS.has(choice.decisionSource)) {
        return 'Invalid saved DDL parsing decision';
    }
    const hasFallbackFrom = choice.fallbackFrom !== undefined;
    const hasFallbackReason = choice.fallbackReason !== undefined;
    if (hasFallbackFrom !== hasFallbackReason) return 'DDL parsing fallbackFrom and fallbackReason must be recorded together';
    if (hasFallbackFrom) {
        if (choice.method !== 'model' || choice.fallbackFrom !== 'sqlglot' || !DDL_FALLBACK_REASONS.has(choice.fallbackReason)) {
            return 'Invalid DDL parsing fallback';
        }
    } else if (choice.decisionSource === 'unattended-default' && choice.method !== 'sqlglot') {
        return 'Unattended default applies only to SQLGlot unless an automatic fallback is recorded';
    }
}

export function resolveDdlParsingChoice(project, { mode = 'interactive', requestedMethod } = {}) {
    if (!['interactive', 'autonomous'].includes(mode)) throw new Error('Unknown execution mode');
    if (requestedMethod !== undefined) {
        if (!DDL_METHODS.has(requestedMethod)) throw new Error('DDL parsing method must be sqlglot or model');
        return { method: requestedMethod, decisionSource: 'explicit' };
    }
    const saved = project.phases?.discovery?.ddlParsing;
    if (saved !== undefined) {
        const error = ddlParsingChoiceError(saved);
        if (error) throw new Error(error);
        if (mode !== 'interactive' || saved.decisionSource !== 'unattended-default' || saved.method === 'model') return { ...saved };
    }
    return mode === 'autonomous' ? { method: 'sqlglot', decisionSource: 'unattended-default' } : { needsConfirmation: true };
}

export function resolveDdlParsingFallback(choice, { reason, dialect } = {}) {
    const error = ddlParsingChoiceError(choice);
    if (error) throw new Error(error);
    if (!DDL_FALLBACK_REASONS.has(reason)) throw new Error('DDL parsing fallback reason must be unsupported-dialect or unavailable');
    if (choice.method !== 'sqlglot') return { choice: { ...choice } };
    const dialectSuffix = dialect ? ` ${dialect}` : '';
    if (reason === 'unavailable' && ['interactive', 'explicit'].includes(choice.decisionSource)) {
        return {
            abort: true,
            choice: { ...choice },
            error: 'Explicitly selected SQLGlot is unavailable; install it using permitted host tooling or select model-only interpretation.',
        };
    }
    const fallbackChoice = {
        method: 'model',
        decisionSource: choice.decisionSource,
        fallbackFrom: 'sqlglot',
        fallbackReason: reason,
    };
    return {
        abort: false,
        choice: fallbackChoice,
        warning:
            reason === 'unsupported-dialect'
                ? `SQLGlot does not support the${dialectSuffix} source dialect; continuing with model-only interpretation.`
                : 'SQLGlot is unavailable; continuing the unattended run with model-only interpretation.',
        researchDialect: reason === 'unsupported-dialect',
    };
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, pathLabel, message) {
    errors.push({ path: pathLabel, message });
}

function requireObject(value, pathLabel, errors) {
    if (!isObject(value)) {
        addError(errors, pathLabel, 'must be an object');
        return false;
    }
    return true;
}

function requireString(value, pathLabel, errors) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        addError(errors, pathLabel, 'must be a non-empty string');
        return false;
    }
    return true;
}

function optionalString(object, key, pathLabel, errors) {
    if (object[key] !== undefined && typeof object[key] !== 'string') {
        addError(errors, `${pathLabel}.${key}`, 'must be a string when present');
    }
}

function optionalBoolean(object, key, pathLabel, errors) {
    if (object[key] !== undefined && typeof object[key] !== 'boolean') {
        addError(errors, `${pathLabel}.${key}`, 'must be a boolean when present');
    }
}

function optionalStringArray(object, key, pathLabel, errors) {
    const value = object[key];
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        addError(errors, `${pathLabel}.${key}`, 'must be an array of strings when present');
    }
}

function validateStatus(value, pathLabel, errors) {
    if (!PHASE_STATUSES.has(value)) {
        addError(errors, pathLabel, 'must be one of not-started, in-progress, or complete');
    }
}

function validateSourceSelection(value, pathLabel, errors) {
    if (value === undefined || !requireObject(value, pathLabel, errors)) return;
    optionalStringArray(value, 'files', pathLabel, errors);
    if (value.files !== undefined) {
        if (value.path !== undefined || value.includedFiles !== undefined) {
            addError(errors, pathLabel, 'files cannot be combined with path or includedFiles');
        }
    }
    if (value.files !== undefined || (value.path === undefined && value.includedFiles === undefined)) {
        for (const key of ['files', 'excludedFiles']) {
            if (!Array.isArray(value[key])) continue;
            for (const [index, file] of value[key].entries()) {
                if (typeof file !== 'string' || !file.trim() || file.includes('\\') ||
                    path.posix.isAbsolute(file) || /^[A-Za-z]:/u.test(file) ||
                    path.posix.normalize(file) !== file || file === '..' || file === '.' ||
                    file.startsWith('../../')) {
                    addError(errors, `${pathLabel}.${key}[${index}]`, 'must be a normalized migration-relative file path inside the workspace');
                }
            }
        }
    }
    optionalString(value, 'path', pathLabel, errors);
    optionalStringArray(value, 'includedFiles', pathLabel, errors);
    optionalStringArray(value, 'excludedFiles', pathLabel, errors);
}

function validateApplicationAnalysis(value, errors) {
    const pathLabel = '$.phases.discovery.applicationAnalysis';
    if (value === undefined || !requireObject(value, pathLabel, errors)) return;
    for (const key of ['projectName', 'projectType', 'language', 'databaseType', 'databaseAccess', 'completedAt']) {
        optionalString(value, key, pathLabel, errors);
    }
    optionalStringArray(value, 'frameworks', pathLabel, errors);
}

function validateAssessmentDomain(value, index, errors) {
    const pathLabel = `$.phases.assessment.domains[${index}]`;
    if (!requireObject(value, pathLabel, errors)) return;
    requireString(value.name, `${pathLabel}.name`, errors);
    optionalStringArray(value, 'tables', pathLabel, errors);
    if (!Array.isArray(value.tables)) addError(errors, `${pathLabel}.tables`, 'is required');
    optionalStringArray(value, 'crossDomainDependencies', pathLabel, errors);
    if (!Array.isArray(value.crossDomainDependencies)) {
        addError(errors, `${pathLabel}.crossDomainDependencies`, 'is required');
    }
    if (!Number.isInteger(value.estimatedTokens) || value.estimatedTokens < 0) {
        addError(errors, `${pathLabel}.estimatedTokens`, 'must be a non-negative integer');
    }
    if (typeof value.isMapped !== 'boolean') addError(errors, `${pathLabel}.isMapped`, 'must be a boolean');
}

function validateAccessPattern(value, index, errors) {
    const pathLabel = `$.phases.assessment.parsedAccessPatterns[${index}]`;
    if (!requireObject(value, pathLabel, errors)) return;
    for (const key of ['name', 'type', 'frequency']) requireString(value[key], `${pathLabel}.${key}`, errors);
    for (const key of ['tables', 'codeReferences']) {
        optionalStringArray(value, key, pathLabel, errors);
        if (!Array.isArray(value[key])) addError(errors, `${pathLabel}.${key}`, 'is required');
    }
    for (const key of ['filterFields', 'singleOrBatch', 'sqlExample', 'codeExample']) {
        optionalString(value, key, pathLabel, errors);
    }
}

function validateDiscovery(value, errors) {
    const pathLabel = '$.phases.discovery';
    if (!requireObject(value, pathLabel, errors)) return;
    validateStatus(value.status, `${pathLabel}.status`, errors);
    if (value.preflightStatus !== undefined) validateStatus(value.preflightStatus, `${pathLabel}.preflightStatus`, errors);
    optionalString(value, 'preflightCompletedAt', pathLabel, errors);
    optionalString(value, 'discoveryInstructions', pathLabel, errors);
    if (value.ddlParsing !== undefined && requireObject(value.ddlParsing, `${pathLabel}.ddlParsing`, errors)) {
        if (!DDL_METHODS.has(value.ddlParsing.method)) addError(errors, `${pathLabel}.ddlParsing.method`, 'must be sqlglot or model');
        if (!DDL_DECISIONS.has(value.ddlParsing.decisionSource)) addError(errors, `${pathLabel}.ddlParsing.decisionSource`, 'must be interactive, explicit, or unattended-default');
        const choiceError = ddlParsingChoiceError(value.ddlParsing);
        if (choiceError) addError(errors, `${pathLabel}.ddlParsing`, choiceError);
    }
    validateSourceSelection(value.schemaInventory, `${pathLabel}.schemaInventory`, errors);
    validateSourceSelection(value.volumetrics, `${pathLabel}.volumetrics`, errors);
    validateSourceSelection(value.accessPatterns, `${pathLabel}.accessPatterns`, errors);
    validateApplicationAnalysis(value.applicationAnalysis, errors);
}

function validateAssessment(value, errors) {
    const pathLabel = '$.phases.assessment';
    if (value === undefined || !requireObject(value, pathLabel, errors)) return;
    validateStatus(value.status, `${pathLabel}.status`, errors);
    optionalString(value, 'assessmentInstructions', pathLabel, errors);
    optionalString(value, 'completedAt', pathLabel, errors);
    if (value.domains !== undefined) {
        if (!Array.isArray(value.domains)) addError(errors, `${pathLabel}.domains`, 'must be an array when present');
        else value.domains.forEach((domain, index) => validateAssessmentDomain(domain, index, errors));
    }
    if (value.parsedAccessPatterns !== undefined) {
        if (!Array.isArray(value.parsedAccessPatterns)) {
            addError(errors, `${pathLabel}.parsedAccessPatterns`, 'must be an array when present');
        } else {
            value.parsedAccessPatterns.forEach((pattern, index) => validateAccessPattern(pattern, index, errors));
        }
    }
}

function validateSchemaConversion(value, errors) {
    const pathLabel = '$.phases.schemaConversion';
    if (value === undefined || !requireObject(value, pathLabel, errors)) return;
    validateStatus(value.status, `${pathLabel}.status`, errors);
    optionalString(value, 'schemaConversionInstructions', pathLabel, errors);
    optionalBoolean(value, 'thoroughAnalysis', pathLabel, errors);
    optionalStringArray(value, 'domains', pathLabel, errors);
    optionalString(value, 'completedAt', pathLabel, errors);
}

function validateTargetEnvironment(value, errors) {
    const pathLabel = '$.phases.targetEnvironment';
    if (value === undefined || !requireObject(value, pathLabel, errors)) return;
    if (!TARGET_TYPES.has(value.type)) addError(errors, `${pathLabel}.type`, 'must be emulator, azure, or provision');
    for (const key of [
        'endpoint',
        'accountName',
        'tenantId',
        'resourceGroup',
        'location',
        'subscriptionId',
        'subscriptionName',
        'verifiedAt',
    ]) {
        optionalString(value, key, pathLabel, errors);
    }
    optionalBoolean(value, 'verified', pathLabel, errors);
    if (value.capacityMode !== undefined && !['serverless', 'provisioned'].includes(value.capacityMode)) {
        addError(errors, `${pathLabel}.capacityMode`, 'must be serverless or provisioned');
    }
    if (value.maxThroughput !== undefined) {
        if (value.capacityMode !== 'provisioned') {
            addError(errors, `${pathLabel}.maxThroughput`, 'requires provisioned target capacity');
        }
        if (!Number.isInteger(value.maxThroughput) || value.maxThroughput < 1000 || value.maxThroughput % 1000 !== 0) {
            addError(errors, `${pathLabel}.maxThroughput`, 'must be an integer multiple of 1000 and at least 1000');
        }
    }
}

function validateProvisioning(value, errors) {
    const pathLabel = '$.phases.provisioning';
    if (value === undefined || !requireObject(value, pathLabel, errors)) return;
    validateStatus(value.status, `${pathLabel}.status`, errors);
    optionalString(value, 'databaseName', pathLabel, errors);
    optionalStringArray(value, 'containersCreated', pathLabel, errors);
    optionalBoolean(value, 'sampleDataInserted', pathLabel, errors);
    optionalStringArray(value, 'artifactPaths', pathLabel, errors);
    optionalString(value, 'completedAt', pathLabel, errors);
}

function validateCodeMigration(value, errors) {
    const pathLabel = '$.phases.codeMigration';
    if (value === undefined || !requireObject(value, pathLabel, errors)) return;
    validateStatus(value.status, `${pathLabel}.status`, errors);
    optionalString(value, 'planPath', pathLabel, errors);
    optionalStringArray(value, 'outputPaths', pathLabel, errors);
    optionalString(value, 'completedAt', pathLabel, errors);
}

export function validateMigrationExecution(value) {
    const errors = [];
    const pathLabel = '$.execution';
    if (value === undefined || !requireObject(value, pathLabel, errors)) return errors;
    if (value.version !== 1) addError(errors, `${pathLabel}.version`, 'must equal 1');
    if (typeof value.runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value.runId)) {
        addError(errors, `${pathLabel}.runId`, 'must be a tracking identifier of at most 128 characters');
    }
    const steps = {
        all: [],
        preflight: ['schema-acquisition', 'application-details', 'volumetrics', 'access-patterns'],
        discovery: [],
        assessment: [],
        'schema-conversion': [],
        provisioning: ['target-account', 'resources-and-data'],
        'code-migration': ['plan', 'migrate'],
    };
    if (!Object.hasOwn(steps, value.phase)) addError(errors, `${pathLabel}.phase`, 'must be a named phase or all');
    if (value.step !== null && (!Object.hasOwn(steps, value.phase) || !steps[value.phase].includes(value.step))) {
        addError(errors, `${pathLabel}.step`, 'must be null or a supported step for the requested phase');
    }
    if (!['running', 'waiting-for-decision', 'blocked', 'complete', 'failed', 'cancelled'].includes(value.activity)) {
        addError(errors, `${pathLabel}.activity`, 'must be a supported agent activity');
    }
    for (const key of ['startedAt', 'updatedAt']) {
        if (typeof value[key] !== 'string' || !Number.isFinite(Date.parse(value[key])) ||
            new Date(value[key]).toISOString() !== value[key]) {
            addError(errors, `${pathLabel}.${key}`, 'must be an ISO UTC timestamp');
        }
    }
    if (Date.parse(value.updatedAt) < Date.parse(value.startedAt)) {
        addError(errors, `${pathLabel}.updatedAt`, 'must not precede startedAt');
    }
    if (typeof value.detail !== 'string' || value.detail.length > 500) {
        addError(errors, `${pathLabel}.detail`, 'must be a string of at most 500 characters');
    }
    for (const key of ['allowProvisioning', 'allow-provisioning']) {
        if (Object.hasOwn(value, key)) addError(errors, `${pathLabel}.${key}`, 'authorization must not be stored in activity');
    }
    return errors;
}

export function validateMigrationProject(project) {
    const errors = [];
    if (!requireObject(project, '$', errors)) return errors;
    if (project.version !== 1) addError(errors, '$.version', 'must equal 1');
    requireString(project.name, '$.name', errors);
    if (project.sourceCode !== 'parent') addError(errors, '$.sourceCode', 'must equal parent');
    optionalString(project, 'sessionId', '$', errors);
    optionalBoolean(project, 'consentGiven', '$', errors);
    optionalString(project, 'migrationInstructions', '$', errors);
    errors.push(...validateMigrationExecution(project.execution));
    if (project.runCounts !== undefined && requireObject(project.runCounts, '$.runCounts', errors)) {
        for (const key of ['discovery', 'assessment', 'schemaConversion', 'provisioning']) {
            const value = project.runCounts[key];
            if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
                addError(errors, `$.runCounts.${key}`, 'must be a non-negative integer when present');
            }
        }
    }
    if (!requireObject(project.phases, '$.phases', errors)) return errors;
    validateDiscovery(project.phases.discovery, errors);
    validateAssessment(project.phases.assessment, errors);
    validateSchemaConversion(project.phases.schemaConversion, errors);
    validateTargetEnvironment(project.phases.targetEnvironment, errors);
    validateProvisioning(project.phases.provisioning, errors);
    validateCodeMigration(project.phases.codeMigration, errors);
    return errors;
}

export function runCli(argv) {
    if (showHelp(argv, `
Usage: node validate-migration-project.mjs <project.json>

Read-only validation of the version 1 project shape. Does not validate artifact contents,
freshness, or phase completion. The required file path resolves from the current directory.
Use for targeted diagnosis; state writes and completion checks already validate project shape.
Outputs JSON {valid, errors}. Exit: 0 when valid; 1 for invalid JSON, schema, or I/O errors.
`)) return 0;
    const filePath = argv[0];
    if (!filePath || argv.length !== 1) {
        process.stderr.write('Usage: validate-migration-project.mjs <project.json>\n');
        return 1;
    }
    try {
        const project = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
        const errors = validateMigrationProject(project);
        process.stdout.write(`${JSON.stringify({ valid: errors.length === 0, errors }, null, 2)}\n`);
        return errors.length === 0 ? 0 : 1;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
