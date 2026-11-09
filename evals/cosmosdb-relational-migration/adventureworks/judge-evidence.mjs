/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export const MAX_EVIDENCE_BYTES = 384_000;
const MAX_FILE_BYTES = 512_000;
const migration = '.cosmosdb-migration/';
const discovery = `${migration}phases/1-discovery/`;
const assessment = `${migration}phases/2-assessment/`;
const conversion = `${migration}phases/3-schema-conversion/`;
const provisioning = `${migration}phases/4-provisioning/`;
const digest = (content) => createHash('sha256').update(content).digest('hex');
const phases = [
    'preflight',
    'discovery',
    'assessment',
    'schema-conversion',
    'provisioning',
    'code-migration',
    'inferred-ddl',
];

export class JudgeEvidenceError extends Error {
    constructor(category, message) {
        super(message);
        this.category = category;
    }
}

export function evidencePhase(stimulus) {
    const phase = stimulus.tags?.scenario === 'inferred-ddl' ? 'inferred-ddl' : stimulus.tags?.phase;
    if (!phases.includes(phase)) throw new JudgeEvidenceError('evidence-configuration', 'Unknown isolated judge phase');
    return phase;
}

function confinedFile(root, path) {
    if (isAbsolute(path) || path.split(/[\\/]/).some((part) => part === '..' || part === '')) {
        throw new JudgeEvidenceError('evidence-path', `Unsafe evidence path: ${path}`);
    }
    let current = root;
    for (const part of path.split('/')) {
        current = join(current, part);
        if (lstatSync(current).isSymbolicLink()) {
            throw new JudgeEvidenceError('evidence-path', `Evidence must not follow symlinks: ${path}`);
        }
    }
    const rel = relative(root, realpathSync(current));
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
        throw new JudgeEvidenceError('evidence-path', `Evidence escapes the application: ${path}`);
    }
    return current;
}

function readText(root, path) {
    const file = confinedFile(root, path);
    const stat = lstatSync(file);
    if (!stat.isFile()) throw new JudgeEvidenceError('evidence-path', `Not an evidence file: ${path}`);
    if (stat.size > MAX_FILE_BYTES) {
        throw new JudgeEvidenceError('evidence-too-large', `Evidence file exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
    }
    const bytes = readFileSync(file);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new JudgeEvidenceError('evidence-format', `Non-text evidence: ${path}`);
    return { bytes, text };
}

function auditEvents(events) {
    return events.flatMap((event, index) => {
        const { type, data } = event;
        if (type === 'tool_call') {
            const args = data.arguments;
            if (data.toolName === 'apply_patch') {
                const text = typeof args === 'string' ? args : JSON.stringify(args);
                // Preserve executable edits; omit only duplicated migration artifact patch bodies.
                const paths = [
                    ...text.matchAll(/\*\*\* (?:Add File|Update File|Delete File|Move to): ([^\r\n\\]+)/g),
                ].map((match) => match[1]);
                if (
                    paths.length &&
                    paths.every((path) => path.includes('.cosmosdb-migration/') && /\.(?:md|json)$/.test(path))
                ) {
                    return [
                        {
                            index,
                            type,
                            tool: data.toolName,
                            paths,
                            argumentsSha256: digest(text),
                            note: 'Patch body omitted; selected final artifacts are included separately.',
                        },
                    ];
                }
            }
            return [{ index, type, tool: data.toolName, arguments: args }];
        }
        if (type === 'tool_result') {
            return [{ index, type, tool: data.toolName, success: data.success }];
        }
        if (type === 'skill_activation') {
            return [
                {
                    index,
                    type,
                    name: data.name,
                    path: data.path,
                    ...(typeof data.content === 'string' ? { contentSha256: digest(data.content) } : {}),
                },
            ];
        }
        if (['assistant_message', 'error'].includes(type)) {
            return [{ index, type, data }];
        }
        return [];
    });
}

export function buildJudgeEvidence(trajectory, stimulus, structuralValidation) {
    const phase = evidencePhase(stimulus);
    const workDir = realpathSync(trajectory.workDir);
    if (lstatSync(join(workDir, 'app')).isSymbolicLink()) {
        throw new JudgeEvidenceError('evidence-path', 'The application root must not be a symlink');
    }
    const root = realpathSync(join(workDir, 'app'));
    const files = [];
    const selected = new Set();
    const absentOptionalFiles = [];
    const add = (path, role, { optional = false, project = false } = {}) => {
        if (selected.has(path)) return;
        if (optional && !existsSync(join(root, path))) {
            absentOptionalFiles.push(`app/${path}`);
            return;
        }
        const { bytes, text } = readText(root, path);
        let content = text;
        let representation = 'complete text';
        let omittedProperties;
        if (path.endsWith('.json')) {
            let value = JSON.parse(text);
            representation = 'complete JSON, compact serialization';
            if (project) {
                const keys = ['version', 'name', 'sourceCode', 'customMetadata', 'phases', 'migrationInstructions'];
                omittedProperties = Object.keys(value).filter((key) => !keys.includes(key));
                value = Object.fromEntries(
                    keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
                );
                representation = 'project identity, user metadata, phase state and migration instructions';
            }
            content = JSON.stringify(value);
        }
        selected.add(path);
        files.push({
            path: `app/${path}`,
            role,
            sha256: digest(bytes),
            sourceBytes: bytes.length,
            representation,
            ...(omittedProperties ? { omittedProperties } : {}),
            content,
        });
    };
    const directoryFiles = (path, suffix, role) => {
        const directory = confinedFile(root, path);
        const entries = readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.name.endsWith(suffix))
            .sort((a, b) => a.name.localeCompare(b.name, 'en'));
        if (!entries.length)
            throw new JudgeEvidenceError('evidence-unavailable', `No ${suffix} evidence files in ${path}`);
        for (const entry of entries) {
            add(`${path}/${entry.name}`, role);
        }
    };
    const source = () => {
        add('AdventureWorks.Web.csproj', 'source application');
        add('Startup.cs', 'source application');
        directoryFiles('Controllers', '.cs', 'source controller evidence');
        directoryFiles('Models', '.cs', 'source EF/model evidence');
    };
    const inventory = () => add(`${discovery}preflight-manifest.json`, 'source inventory and provenance');
    const access = () => {
        add(`${discovery}discovery-report.md`, 'accepted source behavior');
        add(`${discovery}discovery-manifest.json`, 'source access and SDK evidence');
    };
    const model = () => {
        add(`${conversion}model.json`, 'canonical model');
        add(`${conversion}manifest.json`, 'conversion and identity evidence');
        add(`${conversion}summary.md`, 'model preservation design and clearance conditions');
    };
    add(`${migration}project.json`, 'checkpoint state', { project: true });
    add(`${discovery}volumetrics/workload.json`, 'synthetic input assumptions');
    if (['preflight', 'discovery', 'inferred-ddl'].includes(phase)) {
        source();
        inventory();
        directoryFiles(
            `${discovery}schema-ddl`,
            '.sql',
            phase === 'inferred-ddl' ? 'generated inferred DDL' : 'authoritative DDL',
        );
        add(`${discovery}preflight-summary.md`, 'preflight findings');
        add(`${discovery}volumetrics/volumetrics.md`, 'workload interpretation');
        add(`${discovery}access-patterns/access-patterns.md`, 'access-pattern interpretation');
        if (phase !== 'preflight') access();
    } else if (phase === 'assessment') {
        inventory();
        access();
        add(`${assessment}assessment-summary.md`, 'generated assessment');
        add(`${assessment}assessment-manifest.json`, 'generated ownership evidence');
        directoryFiles(`${assessment}domains`, '.md', 'generated domain assessment');
        directoryFiles(`${assessment}domains`, '.json', 'generated domain ownership');
    } else if (phase === 'schema-conversion') {
        inventory();
        access();
        add(`${assessment}assessment-summary.md`, 'accepted domain ownership');
        model();
        const domains = JSON.parse(readText(root, `${migration}project.json`).text).phases.schemaConversion.domains;
        for (const domain of domains) {
            if (typeof domain !== 'string' || /[\\/]/.test(domain) || domain === '..') {
                throw new JudgeEvidenceError('evidence-path', 'Invalid converted domain name');
            }
            add(`${conversion}domains/${domain}/summary.md`, 'generated domain design');
        }
    } else if (phase === 'provisioning') {
        model();
        for (const name of ['main.bicep', 'main.bicepparam', 'sample-data.json', 'seed-data.csh', 'summary.md']) {
            add(`${provisioning}${name}`, 'generated provisioning artifact');
        }
        add(`${provisioning}manifest.json`, 'local provisioning evidence', { optional: true });
    } else if (phase === 'code-migration') {
        source();
        access();
        model();
        add(`${migration}code-migration-plan.md`, 'complete generated plan');
        add(`${migration}code-migration-manifest.json`, 'generated plan evidence');
    }
    const packet = {
        version: 1,
        phase,
        structuralValidation,
        files,
        absentOptionalFiles,
        agentOutput: trajectory.output,
        audit: auditEvents(trajectory.events),
        exclusions: [
            'Only the listed phase-selected files are delivered; this is not a complete repository snapshot.',
            'Project freshness/activity/history fields are omitted; the independent artifact checker validates freshness and boundaries.',
            'Tool-result bodies and reasoning/token events are omitted. Success flags alone do not prove command exit codes.',
            'Migration artifact patch bodies may be represented by paths and hashes; full selected final files are supplied.',
            'Skills, setup files, staged reference checkpoints, caches, UI assets and unrelated phases are not judge evidence.',
        ],
    };
    const text = JSON.stringify(packet);
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_EVIDENCE_BYTES) {
        const largest = files
            .map(({ path, content }) => ({ path, bytes: Buffer.byteLength(content) }))
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, 3);
        throw new JudgeEvidenceError(
            'evidence-too-large',
            `The ${phase} packet is ${bytes} bytes; limit ${MAX_EVIDENCE_BYTES}. No content was truncated. Largest files: ${JSON.stringify(largest)}`,
        );
    }
    return { packet, text, bytes };
}
