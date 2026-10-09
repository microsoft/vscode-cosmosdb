#!/usr/bin/env node
// Purpose: Record and validate hashes that prove migration phase evidence is current.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATRIX_VERSION } from './check-sdk-compatibility.mjs';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { normalizePhaseName } from './phase-names.mjs';
import { readProjectState, updateProjectState } from './project-state.mjs';

const VOLATILE_TARGET_KEYS = new Set(['verified', 'verifiedAt']);

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonicalValue(value[key])]),
        );
    }
    return value;
}

export function canonicalValueSha256(value) {
    return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

export function fileSha256(filePath) {
    const hash = createHash('sha256');
    const descriptor = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(64 * 1024);
        let bytesRead;
        while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
            hash.update(buffer.subarray(0, bytesRead));
        }
        return hash.digest('hex');
    } finally {
        fs.closeSync(descriptor);
    }
}

function relativePath(workspace, filePath) {
    const relative = path.relative(path.resolve(workspace), path.resolve(filePath));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Freshness input must remain inside the workspace: ${filePath}`);
    }
    return relative.split(path.sep).join('/');
}

function fileInput(workspace, id, relative) {
    const absolute = path.resolve(workspace, relative);
    if (!fs.statSync(absolute).isFile()) throw new Error(`Freshness input is not a file: ${relative}`);
    const realWorkspace = fs.realpathSync(workspace);
    const realFile = fs.realpathSync(absolute);
    const realRelative = path.relative(realWorkspace, realFile);
    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
        throw new Error(`Freshness input resolves outside the workspace: ${relative}`);
    }
    return { id, kind: 'file', path: relativePath(workspace, absolute), sha256: fileSha256(absolute) };
}

function projectInput(id, value) {
    return { id, kind: 'project-value', sha256: canonicalValueSha256(value) };
}

export function selectedDiscoveryFiles(workspace, project, source) {
    const property = { 'schema-ddl': 'schemaInventory', volumetrics: 'volumetrics', 'access-patterns': 'accessPatterns' }[source];
    if (!property) throw new Error(`Unknown discovery source: ${source}`);
    const selection = project.phases?.discovery?.[property];
    const explicitFiles = selection?.files;
    const base = explicitFiles !== undefined
        ? path.join(workspace, '.cosmosdb-migration')
        : selection?.path !== undefined
        ? path.resolve(workspace, selection.path)
        : path.join(workspace, '.cosmosdb-migration/phases/1-discovery', source);
    relativePath(workspace, base);
    if (fs.existsSync(base)) relativePath(fs.realpathSync(workspace), fs.realpathSync(base));
    const list = (directory) =>
        !fs.existsSync(directory)
            ? []
            : fs
                  .readdirSync(directory, { withFileTypes: true })
                  .flatMap((entry) =>
                      entry.isDirectory() ? list(path.join(directory, entry.name)) : [path.join(directory, entry.name)],
                  );
    const included = (explicitFiles ?? selection?.includedFiles)?.map((value) => path.normalize(value));
    const legacyBase = explicitFiles === undefined && (selection?.path !== undefined || selection?.includedFiles !== undefined);
    const exclusionBase = legacyBase ? base : path.join(workspace, '.cosmosdb-migration');
    const excluded = new Set((selection?.excludedFiles ?? []).map((value) => {
        const legacyDefaultName = !legacyBase && explicitFiles === undefined &&
            !value.startsWith('phases/') && !value.startsWith('../') && !path.isAbsolute(value);
        const file = path.resolve(legacyDefaultName ? base : exclusionBase, value);
        relativePath(workspace, file);
        return file;
    }));
    const template = source === 'schema-ddl' ? undefined
        : path.resolve(workspace, '.cosmosdb-migration/phases/1-discovery', source, `${source}.md`);
    return (included ? included.map(file => path.resolve(base, file)) : list(base))
        .filter((filePath) => source !== 'schema-ddl' || /\.(?:ddl|sql)$/iu.test(filePath))
        .filter((filePath) => path.resolve(filePath) !== template)
        .filter((filePath) => !excluded.has(path.resolve(filePath)))
        .map((filePath) => {
            relativePath(explicitFiles !== undefined ? workspace : base, filePath);
            relativePath(fs.realpathSync(workspace), fs.realpathSync(filePath));
            if (!fs.statSync(filePath).isFile()) throw new Error(`Discovery input is not a file: ${filePath}`);
            return filePath;
        })
        .sort();
}

export function selectedDdlFiles(workspace, project) {
    return selectedDiscoveryFiles(workspace, project, 'schema-ddl');
}

function withoutKeys(value, excluded) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? null;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

function requiredInputs(workspace, project, phase) {
    const root = '.cosmosdb-migration';
    const discovery = project.phases?.discovery ?? {};
    const assessment = project.phases?.assessment ?? {};
    const conversion = project.phases?.schemaConversion ?? {};
    switch (phase) {
        case 'preflight':
            return [
                ...selectedDdlFiles(workspace, project).map((filePath) =>
                    fileInput(
                        workspace,
                        `source-ddl:${relativePath(workspace, filePath)}`,
                        relativePath(workspace, filePath),
                    ),
                ),
                projectInput('schema-selection', discovery.schemaInventory ?? null),
                ...['volumetrics', 'access-patterns'].flatMap(source =>
                    selectedDiscoveryFiles(workspace, project, source).map(file =>
                        fileInput(workspace, `source-${source}:${relativePath(workspace, file)}`, relativePath(workspace, file)),
                    ),
                ),
                projectInput('volumetrics-selection', discovery.volumetrics ?? null),
                projectInput('access-patterns-selection', discovery.accessPatterns ?? null),
                projectInput('ddl-parsing-choice', discovery.ddlParsing ?? null),
                projectInput('application-analysis', withoutKeys(discovery.applicationAnalysis, new Set(['completedAt']))),
                projectInput('sdk-matrix-version', MATRIX_VERSION),
                fileInput(workspace, 'volumetrics', `${root}/phases/1-discovery/volumetrics/volumetrics.md`),
                fileInput(workspace, 'access-patterns', `${root}/phases/1-discovery/access-patterns/access-patterns.md`),
            ];
        case 'discovery':
            return [
                fileInput(workspace, 'preflight-manifest', `${root}/phases/1-discovery/preflight-manifest.json`),
                projectInput('discovery-instructions', discovery.discoveryInstructions ?? null),
            ];
        case 'assessment':
            return [
                fileInput(workspace, 'discovery-manifest', `${root}/phases/1-discovery/discovery-manifest.json`),
                projectInput('assessment-instructions', assessment.assessmentInstructions ?? null),
            ];
        case 'schema-conversion':
            return [
                fileInput(workspace, 'assessment-manifest', `${root}/phases/2-assessment/assessment-manifest.json`),
                ...((assessment.domains ?? []).map((domain) =>
                    fileInput(
                        workspace,
                        `assessment-domain:${domain.name}`,
                        `${root}/phases/2-assessment/domains/${domain.name}.manifest.json`,
                    ),
                )),
                projectInput('schema-conversion-instructions', conversion.schemaConversionInstructions ?? null),
                projectInput(
                    'assessment-domain-selection',
                    (assessment.domains ?? []).map(({ name, tables, isMapped }) => ({ name, tables, isMapped })),
                ),
                ...((conversion.domains ?? []).map((domainName) =>
                    fileInput(
                        workspace,
                        `conversion-domain:${domainName}`,
                        `${root}/phases/3-schema-conversion/domains/${domainName}/cosmos-model.json`,
                    ),
                )),
            ];
        case 'provisioning':
            return [
                fileInput(workspace, 'canonical-model', `${root}/phases/3-schema-conversion/model.json`),
                fileInput(workspace, 'conversion-manifest', `${root}/phases/3-schema-conversion/manifest.json`),
                fileInput(workspace, 'bicep-template', `${root}/phases/4-provisioning/main.bicep`),
                fileInput(workspace, 'bicep-parameters', `${root}/phases/4-provisioning/main.bicepparam`),
                fileInput(workspace, 'sample-data', `${root}/phases/4-provisioning/sample-data.json`),
                fileInput(workspace, 'seed-script', `${root}/phases/4-provisioning/seed-data.csh`),
                projectInput(
                    'target-configuration',
                    withoutKeys(project.phases?.targetEnvironment, VOLATILE_TARGET_KEYS),
                ),
            ];
        default:
            throw new Error(`Unknown phase: ${phase}`);
    }
}

export function buildFreshnessManifest(
    workspace,
    project,
    phaseInput,
    consultedPaths = [],
) {
    const phase = normalizePhaseName(phaseInput);
    if (!phase) throw new Error(`Unknown phase: ${phaseInput}`);
    if (phase === 'code-migration') throw new Error('Code migration does not use freshness manifests.');
    const inputs = [
        ...requiredInputs(workspace, project, phase),
        ...consultedPaths.map((consultedPath, index) =>
            fileInput(workspace, `consulted:${String(index + 1).padStart(3, '0')}`, consultedPath),
        ),
    ].sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(inputs.map((input) => input.id)).size !== inputs.length) throw new Error('Freshness input IDs must be unique');
    const root = '.cosmosdb-migration/phases';
    const outputPaths = {
        preflight: [`${root}/1-discovery/preflight-manifest.json`],
        discovery: [`${root}/1-discovery/discovery-manifest.json`],
        assessment: [
            `${root}/2-assessment/assessment-manifest.json`,
            ...(project.phases?.assessment?.domains ?? []).map(domain => `${root}/2-assessment/domains/${domain.name}.manifest.json`),
        ],
        'schema-conversion': [`${root}/3-schema-conversion/manifest.json`, `${root}/3-schema-conversion/model.json`],
        provisioning: [`${root}/4-provisioning/manifest.json`],
    };
    const outputs = outputPaths[phase].map(outputPath => fileInput(workspace, `output:${outputPath}`, outputPath));
    return { version: 1, inputs, outputs };
}

export function validateFreshnessManifest(
    workspace,
    project,
    phaseInput,
    manifest,
) {
    if (normalizePhaseName(phaseInput) === 'code-migration') {
        return { freshness: 'not-applicable', staleInputs: [] };
    }
    if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.inputs) || !Array.isArray(manifest.outputs)) {
        return { freshness: 'unknown', staleInputs: [{ id: 'freshness-manifest', reason: 'missing or invalid version 1 freshness manifest' }] };
    }
    let expected;
    try {
        expected = buildFreshnessManifest(workspace, project, phaseInput);
    } catch (error) {
        return { freshness: 'stale', staleInputs: [{ id: 'required-inputs', reason: error.message }] };
    }
    const staleInputs = [];
    if (JSON.stringify(manifest.outputs) !== JSON.stringify(expected.outputs)) {
        staleInputs.push({ id: 'phase-outputs', reason: 'recorded outputs no longer match current content' });
    }
    const recordedById = new Map();
    const recordedInputs = manifest.inputs.filter(
        input => input?.kind !== 'skill-file' || input.skill !== 'cosmosdb-best-practices',
    );
    for (const input of recordedInputs) {
        if (!input || typeof input.id !== 'string' || recordedById.has(input.id)) {
            staleInputs.push({ id: input?.id ?? 'unknown', reason: 'invalid or duplicate freshness input ID' });
            continue;
        }
        recordedById.set(input.id, input);
    }
    for (const input of expected.inputs) {
        const recorded = recordedById.get(input.id);
        if (!recorded) staleInputs.push({ id: input.id, reason: 'required input is not recorded' });
        else if (JSON.stringify(recorded) !== JSON.stringify(input)) {
            staleInputs.push({ id: input.id, reason: 'recorded input no longer matches current content' });
        }
    }
    const expectedIds = new Set(expected.inputs.map((input) => input.id));
    for (const input of recordedInputs) {
        if (!input || expectedIds.has(input.id)) continue;
        if (typeof input.path !== 'string' || !/^[0-9a-f]{64}$/u.test(input.sha256 ?? '')) {
            staleInputs.push({ id: input.id, reason: 'additional inputs require a path and SHA-256 value' });
            continue;
        }
        try {
                        const current = input.kind === 'file' ? fileInput(workspace, input.id, input.path) : undefined;
            if (!current) throw new Error('Additional input kind is invalid');
            if (JSON.stringify(current) !== JSON.stringify(input)) {
                staleInputs.push({ id: input.id, reason: 'consulted input no longer matches current content' });
            }
        } catch (error) {
            staleInputs.push({ id: input.id, reason: error.message });
        }
    }
    return { freshness: staleInputs.length ? 'stale' : 'current', staleInputs };
}

export function recordFreshness(workspace, phaseInput, expectedRevision, consultedPaths = []) {
    const phase = normalizePhaseName(phaseInput);
    if (!phase) throw new Error(`Unknown phase: ${phaseInput}`);
    if (phase === 'code-migration') return { freshness: 'not-applicable' };
    let manifest;
    const result = updateProjectState(workspace, expectedRevision, project => {
        if (!project) throw new Error('Initialize the project first.');
        manifest = buildFreshnessManifest(workspace, project, phase, consultedPaths);
        project.freshness = { ...project.freshness, [phase]: manifest };
        return project;
    });
    return { ...result, phase, inputCount: manifest.inputs.length, outputCount: manifest.outputs.length };
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node freshness.mjs --phase <name> [--workspace <path>] [options]

Inspect input/output hashes or record them in project.json#freshness. Outputs JSON.

    --workspace <path>   Application root; default current working directory.
    --phase <name>       Required: preflight, discovery, assessment, schema-conversion,
                                            provisioning, or code-migration (freshness is not-applicable).
    --write              Record hashes; default is read-only inspection.
    --expect <revision>  Required with --write; revision from project-state.mjs.
    --consulted <path>   Materially used workspace-relative input; repeatable, requires --write.

Finalize artifacts and semantic project fields before recording. Hash recording does
not regenerate outputs or prove their correctness. Writes return counts and a revision.
Peer guidance is excluded; historical peer-file freshness entries are ignored.
Exit: 0 when inspection/recording succeeds, including stale/unknown inspection results;
1 for invalid arguments, I/O, or revision conflicts. Inspect freshness in the JSON.
`)) return 0;
    try {
        let workspace = process.cwd();
        let phase;
        let write = false;
        let expectedRevision;
        const consultedPaths = [];
        for (let index = 0; index < argv.length; index++) {
            if (argv[index] === '--workspace') workspace = path.resolve(requireOptionValue(argv, index++));
            else if (argv[index] === '--phase') phase = requireOptionValue(argv, index++);
            else if (argv[index] === '--write') write = true;
            else if (argv[index] === '--expect') expectedRevision = requireOptionValue(argv, index++);
            else if (argv[index] === '--consulted') consultedPaths.push(requireOptionValue(argv, index++));
            else throw new Error(`Unexpected argument: ${argv[index]}`);
        }
        if (!normalizePhaseName(phase)) throw new Error('Usage: freshness.mjs [--workspace <path>] --phase <name> [--write --expect <revision>] [--consulted <path>]');
        if (write && !expectedRevision) throw new Error('--write requires --expect <revision> from project-state.mjs.');
        if (!write && (expectedRevision || consultedPaths.length)) throw new Error('Recording arguments require --write.');
        const state = write ? undefined : readProjectState(workspace);
        const result = write
            ? recordFreshness(workspace, phase, expectedRevision, consultedPaths)
            : { revision: state.revision, ...validateFreshnessManifest(workspace, state.project, phase, state.project?.freshness?.[normalizePhaseName(phase)]) };
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return 0;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
