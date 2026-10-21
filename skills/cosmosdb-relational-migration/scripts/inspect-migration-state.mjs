#!/usr/bin/env node
// Purpose: Inspect migration progress and identify the next eligible phase.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    checkCodeMigrationPrerequisites,
    checkPhaseCompletion,
    DEFAULT_COMPLETION_PAGE_SIZE,
    summarizePhaseCompletion,
} from './check-phase-completion.mjs';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { fileSha256, selectedDiscoveryFiles } from './freshness.mjs';
import { normalizePhaseName } from './phase-names.mjs';
import { validateMigrationProject } from './validate-migration-project.mjs';

export const MAX_INSPECTION_OUTPUT_BYTES = 16 * 1024;
const MAX_INSPECTION_COMPLETION_BYTES = 12 * 1024;
const PHASES = ['preflight', 'discovery', 'assessment', 'schema-conversion', 'provisioning'];
const PREFLIGHT_STEPS = new Set(['application-details', 'schema-acquisition', 'volumetrics', 'access-patterns']);
const PREREQUISITE = {
    discovery: 'preflight',
    assessment: 'discovery',
    'schema-conversion': 'assessment',
    provisioning: 'schema-conversion',
    'code-migration': 'schema-conversion',
};

function readProject(workspace) {
    const projectPath = path.join(workspace, '.cosmosdb-migration', 'project.json');
    if (!fs.existsSync(projectPath)) return { projectPath, project: undefined, errors: [] };
    try {
        const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
        return { projectPath, project, errors: validateMigrationProject(project) };
    } catch (error) {
        return { projectPath, project: undefined, errors: [{ path: '$', message: error.message }] };
    }
}

export function inspectDiscoveryInputs(workspace, source, { offset = 0, limit = DEFAULT_COMPLETION_PAGE_SIZE } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('Input pages require a non-negative offset and limit from 1 to 100.');
    }
    const { project, errors } = readProject(workspace);
    if (errors.length) throw new Error(`Invalid migration project: ${JSON.stringify(errors)}`);
    const files = selectedDiscoveryFiles(workspace, project ?? {}, source);
    const result = { source, total: files.length, offset, files: [] };
    for (const file of files.slice(offset, offset + limit)) {
        const entry = {
            path: path.relative(workspace, file).split(path.sep).join('/'),
            bytes: fs.statSync(file).size,
            sha256: fileSha256(file),
        };
        if (outputBytes({ ...result, files: [...result.files, entry] }) > MAX_INSPECTION_COMPLETION_BYTES) {
            if (!result.files.length) throw new Error('Input path exceeds the inspection output limit.');
            break;
        }
        result.files.push(entry);
    }
    if (offset + result.files.length < files.length) result.nextOffset = offset + result.files.length;
    return result;
}

function persistedStatus(project, phase) {
    const statuses = {
        preflight: project.phases.discovery.preflightStatus,
        discovery: project.phases.discovery.status,
        assessment: project.phases.assessment?.status,
        'schema-conversion': project.phases.schemaConversion?.status,
        provisioning: project.phases.provisioning?.status,
        'code-migration': project.phases.codeMigration?.status,
    };
    return statuses[phase] ?? 'not-started';
}

function phaseAction(workspace, project, phase, regenerate, completionOptions) {
    const completion = checkPhaseCompletion(workspace, phase);
    const summary = summarizePhaseCompletion(completion, completionOptions);
    if (completion.complete) return { action: regenerate ? 'regenerate' : 'complete', phase, completion: summary };
    return {
        action: persistedStatus(project, phase) === 'in-progress' ? 'resume' : 'run',
        phase,
        completion: summary,
    };
}

export function inspectMigrationState(workspace, requestedPhase, regenerate = false, completionOptions = {}) {
    const { projectPath, project, errors } = readProject(workspace);
    const phase = requestedPhase === undefined ? undefined : normalizePhaseName(requestedPhase);
    if (requestedPhase !== undefined && phase === undefined) {
        return {
            action: 'blocked',
            phase: requestedPhase,
            projectPath,
            errors: [`Unknown phase: ${requestedPhase}`],
        };
    }
    if (!project && errors.length === 0) {
        return { action: 'initialize', phase: phase ?? 'preflight', projectPath, errors: [] };
    }
    if (errors.length > 0) return { action: 'blocked', phase, projectPath, errors };

    if (phase) {
        const prerequisite = PREREQUISITE[phase];
        if (prerequisite) {
            const prerequisiteResult = phase === 'code-migration'
                ? checkCodeMigrationPrerequisites(workspace)
                : checkPhaseCompletion(workspace, prerequisite);
            if (!prerequisiteResult.complete) {
                if (phase === 'discovery') {
                    return {
                        action: persistedStatus(project, phase) === 'in-progress' ? 'resume' : 'run',
                        phase,
                        prerequisite,
                        preflightSteps: [...PREFLIGHT_STEPS],
                        projectPath,
                        errors: [],
                        completion: summarizePhaseCompletion(prerequisiteResult, completionOptions),
                    };
                }
                return {
                    action: 'blocked',
                    phase,
                    prerequisite,
                    projectPath,
                    errors: [`${prerequisite} is incomplete`],
                    completion: summarizePhaseCompletion(prerequisiteResult, completionOptions),
                };
            }
        }
        return { ...phaseAction(workspace, project, phase, regenerate, completionOptions), projectPath, errors: [] };
    }

    if (regenerate) {
        return { action: 'regenerate', phase: 'all', phases: PHASES, projectPath, errors: [] };
    }

    for (const phase of PHASES) {
        const result = phaseAction(workspace, project, phase, false, completionOptions);
        if (result.action !== 'complete') return { ...result, projectPath, errors: [] };
    }
    return { action: 'complete', phase: 'all', projectPath, errors: [] };
}

function outputBytes(result) {
    return Buffer.byteLength(`${JSON.stringify(result, null, 2)}\n`);
}

export function summarizeInspectionResult(
    result,
    { offset = 0, limit = DEFAULT_COMPLETION_PAGE_SIZE, maxOutputBytes = MAX_INSPECTION_OUTPUT_BYTES } = {},
) {
    if (outputBytes(result) <= maxOutputBytes) return result;
    const allErrors = result.errors ?? [];
    const requested = allErrors.slice(offset, offset + limit);
    const compact = {
        ...result,
        errors: [],
        errorCount: allErrors.length,
        returnedErrors: 0,
        errorsTruncated: offset > 0 || offset < allErrors.length,
    };
    for (const error of requested) {
        const candidate = { ...compact, errors: [...compact.errors, error], returnedErrors: compact.errors.length + 1 };
        if (outputBytes(candidate) <= maxOutputBytes) {
            compact.errors.push(error);
            compact.returnedErrors++;
            continue;
        }
        const omitted = 'Diagnostic omitted: exceeds output limit';
        const fallback = { ...compact, errors: [...compact.errors, omitted], returnedErrors: compact.errors.length + 1 };
        if (outputBytes(fallback) <= maxOutputBytes) {
            compact.errors.push(omitted);
            compact.returnedErrors++;
        }
        break;
    }
    const nextErrorOffset = offset + compact.returnedErrors;
    compact.errorsTruncated = offset > 0 || nextErrorOffset < allErrors.length;
    if (nextErrorOffset < allErrors.length) compact.nextErrorOffset = nextErrorOffset;
    if (outputBytes(compact) <= maxOutputBytes) return compact;
    return {
        action: result.action,
        phase: String(result.phase).slice(0, 200),
        errors: ['Inspection details omitted: exceeds output limit'],
        truncated: true,
    };
}

function parseArguments(argv) {
    let workspace = process.cwd();
    let phase;
    let preflightStep;
    let regenerate = false;
    let offset = 0;
    let limit = DEFAULT_COMPLETION_PAGE_SIZE;
    let artifactPath;
    let inputs;
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--workspace') workspace = path.resolve(requireOptionValue(argv, index++));
        else if (argv[index] === '--phase') phase = requireOptionValue(argv, index++);
        else if (argv[index] === '--preflight-step') preflightStep = requireOptionValue(argv, index++);
        else if (argv[index] === '--regenerate') regenerate = true;
        else if (argv[index] === '--offset') offset = Number(requireOptionValue(argv, index++));
        else if (argv[index] === '--limit') limit = Number(requireOptionValue(argv, index++));
        else if (argv[index] === '--artifact') artifactPath = requireOptionValue(argv, index++);
        else if (argv[index] === '--inputs') inputs = requireOptionValue(argv, index++);
        else throw new Error(`Unexpected argument: ${argv[index]}`);
    }
    if (preflightStep !== undefined && !PREFLIGHT_STEPS.has(preflightStep)) {
        throw new Error(`Unknown preflight step: ${preflightStep}`);
    }
    if (preflightStep !== undefined && normalizePhaseName(phase) !== 'preflight') {
        throw new Error('--preflight-step requires --phase preflight.');
    }
    if (!Number.isInteger(offset) || offset < 0) throw new Error('--offset must be a non-negative integer.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be between 1 and 100.');
    if (inputs !== undefined && (phase !== undefined || preflightStep !== undefined || regenerate || artifactPath !== undefined)) {
        throw new Error('--inputs is a separate inspection; use only --workspace, --offset, and --limit with it.');
    }
    return { workspace, phase, preflightStep, regenerate, inputs, completionOptions: { offset, limit, artifactPath, maxOutputBytes: MAX_INSPECTION_COMPLETION_BYTES } };
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node inspect-migration-state.mjs [--workspace <path>] [options]

Read-only workflow routing with embedded phase completion. Outputs bounded JSON.

    --workspace <path>       Application root; default current working directory.
    --phase <name>           Scope to preflight, discovery, assessment, schema-conversion,
                                                    provisioning, or code-migration. Omit for the analytical sequence.
    --regenerate             Request regeneration routing; does not regenerate or write files.
    --preflight-step <name>  Requires --phase preflight. One of application-details,
                                                    schema-acquisition, volumetrics, access-patterns.
                                                    Returns routing metadata; completion still covers all preflight.
    --offset <n>             Diagnostic offset; default 0.
    --limit <n>              Page size from 1 to 100; default ${DEFAULT_COMPLETION_PAGE_SIZE}.
    --artifact <path>        Workspace-relative artifact diagnostic filter, not validation scope.
    --inputs <source>        List selected raw inputs: schema-ddl, volumetrics, or access-patterns.
                            Separate from phase routing; supports --offset and --limit.
                            Returns paths, byte counts, SHA-256 hashes, and nextOffset, not contents.

Discovery can start with incomplete preflight; follow preflightSteps before source analysis.
Preflight/Discovery routing includes inputCounts; enumerate each source with --inputs before analysis.
Read action and completion; success does not imply the phase is complete.
Exit: 0 for a routing result; 1 when blocked or arguments/inspection fail.
`)) return 0;
    try {
        const { workspace, phase, preflightStep, regenerate, inputs, completionOptions } = parseArguments(argv);
        if (inputs !== undefined) {
            process.stdout.write(`${JSON.stringify(inspectDiscoveryInputs(workspace, inputs, completionOptions), null, 2)}\n`);
            return 0;
        }
        const result = inspectMigrationState(workspace, phase, regenerate, completionOptions);
        if (['preflight', 'discovery'].includes(result.phase) && result.action !== 'blocked') {
            const { project } = readProject(workspace);
            result.inputCounts = Object.fromEntries(['schema-ddl', 'volumetrics', 'access-patterns'].map(source =>
                [source, selectedDiscoveryFiles(workspace, project ?? {}, source).length],
            ));
        }
        const routedResult = preflightStep === undefined ? result : { ...result, preflightStep };
        process.stdout.write(`${JSON.stringify(summarizeInspectionResult(routedResult, {
            offset: completionOptions.offset,
            limit: completionOptions.limit,
        }), null, 2)}\n`);
        return result.action === 'blocked' ? 1 : 0;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
