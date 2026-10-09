#!/usr/bin/env node
// Purpose: Read and atomically update scoped migration project state.

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { validateMigrationProject } from './validate-migration-project.mjs';

const MAX_OUTPUT_BYTES = 16384;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function revision(content) {
    return content === undefined ? 'missing' : createHash('sha256').update(content).digest('hex');
}

function readContent(projectPath) {
    try {
        return fs.readFileSync(projectPath, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    }
}

export function readProjectState(workspace) {
    const projectPath = path.join(workspace, '.cosmosdb-migration/project.json');
    const content = readContent(projectPath);
    return { projectPath, revision: revision(content), project: content === undefined ? undefined : JSON.parse(content) };
}

export function updateProjectState(workspace, expectedRevision, update) {
    const state = readProjectState(workspace);
    if (state.revision !== expectedRevision) throw new Error('Project changed; read the required fields again before retrying.');
    const project = update(state.project);
    const errors = validateMigrationProject(project);
    if (errors.length) throw new Error(`Invalid project update: ${JSON.stringify(errors)}`);
    const content = `${JSON.stringify(project, null, 2)}\n`;
    fs.mkdirSync(path.dirname(state.projectPath), { recursive: true });
    const temporaryPath = `${state.projectPath}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, content, { flag: 'wx' });
        if (revision(readContent(state.projectPath)) !== expectedRevision) {
            throw new Error('Project changed during update; checkpoint was not replaced.');
        }
        fs.renameSync(temporaryPath, state.projectPath);
    } finally {
        fs.rmSync(temporaryPath, { force: true });
    }
    return { revision: revision(content) };
}

function pointerKeys(pointer) {
    if (!pointer?.startsWith('/') || /~(?![01])/u.test(pointer)) throw new Error('Use a non-root JSON pointer, such as /phases/discovery.');
    return pointer.slice(1).split('/').map(key => key.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeValue(current, value) {
    if (!isObject(value)) return value;
    const merged = isObject(current) ? { ...current } : {};
    for (const [key, child] of Object.entries(value)) {
        if (UNSAFE_KEYS.has(key)) throw new Error('Unsafe project property.');
        merged[key] = mergeValue(merged[key], child);
    }
    return merged;
}

function validateArrayKey(parent, key) {
    if (Array.isArray(parent) && (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= parent.length)) {
        throw new Error('Select an existing array index or update the containing array.');
    }
}

export function setProjectValue(project, pointer, value) {
    if (!project) throw new Error('Initialize the project first.');
    const keys = pointerKeys(pointer);
    if (keys.some(key => UNSAFE_KEYS.has(key))) throw new Error('Unsafe project property.');
    let parent = project;
    for (const key of keys.slice(0, -1)) {
        validateArrayKey(parent, key);
        if (!Object.hasOwn(parent, key)) parent[key] = {};
        if (!isObject(parent[key]) && !Array.isArray(parent[key])) throw new Error('Select an object property or array index.');
        parent = parent[key];
    }
    const key = keys.at(-1);
    validateArrayKey(parent, key);
    parent[key] = mergeValue(parent[key], value);
    return project;
}

function structureDescription(value) {
    if (value === undefined) return {};
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) return { type: 'array', length: value.length };
    return { type: typeof value };
}

function structurePage(value, pointer, offset, limit) {
    const objectKeys = isObject(value) ? Object.keys(value) : [];
    const total = Array.isArray(value) ? value.length : objectKeys.length;
    const keys = Array.isArray(value)
        ? Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, index) => String(offset + index))
        : objectKeys.slice(offset, offset + limit);
    return {
        pointer,
        found: value !== undefined,
        ...structureDescription(value),
        total,
        offset,
        entries: keys.map(name => ({
            name,
            pointer: `${pointer}/${name.replace(/~/gu, '~0').replace(/\//gu, '~1')}`,
            ...structureDescription(value[name]),
        })),
        ...(offset + keys.length < total ? { nextOffset: offset + keys.length } : {}),
    };
}

export function selectProjectState(state, pointer, offset = 0, limit = 20, { toc = false } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('Offset must be non-negative and limit must be between 1 and 100.');
    }
    let selection;
    if (pointer !== undefined || toc) {
        let value = state.project;
        const keys = toc && (pointer === undefined || pointer === '') ? [] : pointerKeys(pointer);
        for (const key of keys) {
            value = value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
        }
        selection = toc
            ? structurePage(value, pointer ?? '', offset, limit)
            : Array.isArray(value)
              ? { pointer, found: true, total: value.length, offset, value: value.slice(offset, offset + limit) }
              : { pointer, found: value !== undefined, value };
    } else {
        const project = state.project;
        selection = {
            exists: project !== undefined,
            name: project?.name,
            version: project?.version,
            phases: Object.fromEntries(Object.entries(project?.phases ?? {}).map(([phase, value]) => [phase,
                phase === 'targetEnvironment' ? {
                    type: value?.type,
                    endpoint: value?.endpoint,
                    accountName: value?.accountName,
                    resourceGroup: value?.resourceGroup,
                    subscriptionId: value?.subscriptionId,
                    location: value?.location,
                    capacityMode: value?.capacityMode,
                    maxThroughput: value?.maxThroughput,
                    verified: value?.verified,
                } : {
                    status: value?.status,
                    preflightStatus: value?.preflightStatus,
                },
            ])),
            freshness: Object.fromEntries(Object.entries(project?.freshness ?? {}).map(([phase, manifest]) => [phase, {
                inputCount: manifest?.inputs?.length,
                outputCount: manifest?.outputs?.length,
            }])),
        };
    }
    const result = { revision: state.revision, ...selection };
    if (Buffer.byteLength(`${JSON.stringify(result, null, 2)}\n`) > MAX_OUTPUT_BYTES) {
        throw new Error('Selection exceeds 16 KiB; select a narrower JSON pointer or a smaller page.');
    }
    return result;
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node project-state.mjs [--workspace <path>] [operation]

Read or atomically update <workspace>/.cosmosdb-migration/project.json.
Workspace defaults to the current working directory. No operation prints a summary.

    --toc [<json-pointer>]        List structure, not values; omit pointer for the root.
    --get <json-pointer>          Read a non-root pointer; array values are paginated.
    --offset <n>                 Read offset; default 0. Applies to --toc and --get arrays.
    --limit <n>                  Read page size from 1 to 100; default 20.
    --init <name>                Create a version 1 project; requires --expect missing.
    --set <json-pointer>         Update a non-root pointer; requires --value and --expect.
    --value <json>               JSON value, not a filename. Quote JSON for your shell.
    --expect <revision>          Revision from the latest read; required for writes.

Choose one operation. Writes merge objects, replace arrays/scalars, validate the
project, and preserve unrelated fields. On conflict, reread and reconsider the change.
Outputs JSON (at most 16 KiB for reads); writes return the new revision.
Exit: 0 on success; 1 for invalid input, revision conflicts, or I/O failures.
`)) return 0;
    try {
        const options = {};
        for (let index = 0; index < argv.length; index++) {
            const option = argv[index];
            if (option === '--toc') {
                if (options[option] !== undefined) throw new Error(`Invalid argument: ${option}`);
                options[option] = argv[index + 1] !== undefined && !argv[index + 1].startsWith('--') ? argv[++index] : '';
                continue;
            }
            if (!['--workspace', '--get', '--offset', '--limit', '--set', '--value', '--expect', '--init'].includes(option)) {
                throw new Error(`Unexpected argument: ${option}`);
            }
            if (options[option] !== undefined) throw new Error(`Invalid argument: ${option}`);
            options[option] = requireOptionValue(argv, index++);
        }
        const workspace = path.resolve(options['--workspace'] ?? process.cwd());
        const writing = options['--set'] !== undefined || options['--init'] !== undefined;
        const toc = options['--toc'] !== undefined;
        if (toc && options['--get'] !== undefined) throw new Error('Choose either --toc or --get.');
        let result;
        if (writing) {
            if (!options['--expect']) throw new Error('Writes require --expect <revision> from a scoped read.');
            if (toc || options['--get'] !== undefined || options['--offset'] !== undefined || options['--limit'] !== undefined ||
                (options['--set'] !== undefined && options['--init'] !== undefined)) throw new Error('Choose one read or write operation.');
            if (options['--set'] !== undefined && options['--value'] === undefined) throw new Error('--set requires --value <json>.');
            if (options['--init'] !== undefined && options['--value'] !== undefined) throw new Error('--init does not accept --value.');
            result = updateProjectState(workspace, options['--expect'], project => {
                if (options['--init'] !== undefined) {
                    if (project) throw new Error('Project already exists.');
                    return { version: 1, name: options['--init'], sourceCode: 'parent', sessionId: randomUUID(), runCounts: {},
                        phases: { discovery: { preflightStatus: 'not-started', status: 'not-started' } } };
                }
                return setProjectValue(project, options['--set'], JSON.parse(options['--value']));
            });
        } else {
            if (options['--value'] !== undefined || options['--expect'] !== undefined) throw new Error('Write arguments require --set or --init.');
            result = selectProjectState(readProjectState(workspace), toc ? options['--toc'] : options['--get'], Number(options['--offset'] ?? 0), Number(options['--limit'] ?? 20), { toc });
        }
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return 0;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
