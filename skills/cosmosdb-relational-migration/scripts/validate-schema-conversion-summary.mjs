#!/usr/bin/env node
// Purpose: Validate required sections and model references in schema conversion summaries.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { readDomainModel, readPhaseEvidence } from './phase-summary.mjs';
import { readSourceInventory, resolveSource } from './validate-source-evidence.mjs';

const DOMAIN_SECTIONS = {
    overview: ['overview'],
    mappings: ['tables to container mapping', 'container mappings'],
    containers: ['container summary'],
    partitionKeys: ['partition key decisions'],
    embedding: ['embedding strategy'],
    accessPatterns: ['access pattern mappings'],
    crossPartition: ['cross partition queries'],
    indexing: ['indexing policies'],
    optimization: ['optimization recommendations'],
    capacity: ['throughput storage recommendations', 'throughput and storage recommendations'],
};

const ROOT_SECTIONS = {
    overview: ['database overview'],
    inventory: ['container inventory'],
    mappings: ['container mappings'],
    relationships: ['cross domain relationships'],
    conflicts: ['conflict resolutions'],
    deployment: ['deployment notes'],
    domains: ['per domain references'],
};

function normalizeHeading(value) {
    return value
        .toLocaleLowerCase('en-US')
        .replace(/[`*_]/gu, ' ')
        .replace(/[^a-z0-9]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

function headings(markdown) {
    return markdown
        .split(/\r?\n/gu)
        .map((line) => line.match(/^#{1,6}\s+(.+?)\s*$/u)?.[1])
        .filter(Boolean)
        .map(normalizeHeading);
}

function sections(markdown) {
    const result = new Map();
    let current;
    for (const line of markdown.split(/\r?\n/gu)) {
        const heading = line.match(/^#{1,6}\s+(.+?)\s*$/u)?.[1];
        if (heading) {
            current = normalizeHeading(heading);
            if (!result.has(current)) result.set(current, []);
        } else if (current) {
            result.get(current).push(line);
        }
    }
    return new Map([...result].map(([heading, lines]) => [heading, lines.join('\n').trim()]));
}

function containsIdentifier(content, identifier) {
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, 'u').test(content);
}

export function expectedPatternIdsForDomain(project, patterns, inventory, domainName) {
    const domain = project.phases?.assessment?.domains?.find(candidate => candidate.name === domainName);
    if (!domain || !Array.isArray(domain.tables)) {
        throw new Error(`Assessment metadata is missing for schema-conversion domain ${domainName}.`);
    }
    if (!Array.isArray(patterns)) throw new Error('Discovery evidence does not contain an access-pattern array.');
    if (inventory?.errors?.length) throw new Error('Source inventory is invalid; access-pattern coverage cannot be resolved.');

    const domainTables = new Set(domain.tables.map(table => resolveSource(table, inventory).name));
    const identifiers = new Set();
    for (const pattern of patterns) {
        if (typeof pattern?.id !== 'string' || !Array.isArray(pattern.tables)) {
            throw new Error('Discovery evidence contains an invalid access pattern.');
        }
        if (pattern.tables.some(table => domainTables.has(resolveSource(table, inventory).name))) {
            identifiers.add(pattern.id);
        }
    }
    return [...identifiers].sort((left, right) => left.localeCompare(right));
}

export function readExpectedPatternIdsByDomain(workspace, domainNames) {
    const migrationRoot = path.join(workspace, '.cosmosdb-migration');
    const project = JSON.parse(fs.readFileSync(path.join(migrationRoot, 'project.json'), 'utf8'));
    const patterns = readPhaseEvidence(
        path.join(migrationRoot, 'phases', '1-discovery', 'discovery-manifest.json'),
    ).patterns;
    const inventory = readSourceInventory(workspace, project);
    return new Map(
        domainNames.map(domainName => [
            domainName,
            expectedPatternIdsForDomain(project, patterns, inventory, domainName),
        ]),
    );
}

function parseExampleDocuments(markdown, errors) {
    const documents = [];
    const blocks = markdown.matchAll(/```json\s*([\s\S]*?)```/giu);
    for (const [index, block] of [...blocks].entries()) {
        try {
            const value = JSON.parse(block[1]);
            const formatted = JSON.stringify(value, null, 2);
            if (block[1].trim().replace(/\r\n/gu, '\n') !== formatted) {
                errors.push({
                    path: `$.examples[${index}]`,
                    message: 'must be formatted as readable JSON with two-space indentation',
                });
            }
            documents.push(...(Array.isArray(value) ? value : [value]));
        } catch {
            errors.push({ path: `$.examples[${index}]`, message: 'must contain valid JSON' });
        }
    }
    return documents.filter((value) => value !== null && typeof value === 'object' && !Array.isArray(value));
}

export function validateSchemaConversionSummary(markdown, kind, options = {}) {
    const errors = [];
    if (kind !== 'domain' && kind !== 'root') {
        return [{ path: '$.kind', message: 'must be domain or root' }];
    }
    if (typeof markdown !== 'string' || markdown.trim().length === 0) {
        return [{ path: '$', message: 'summary must be non-empty Markdown' }];
    }

    const actualHeadings = headings(markdown);
    const actualSections = sections(markdown);
    const requiredSections = kind === 'domain' ? DOMAIN_SECTIONS : ROOT_SECTIONS;
    for (const [section, aliases] of Object.entries(requiredSections)) {
        if (!aliases.some((alias) => actualHeadings.includes(alias))) {
            errors.push({ path: `$.sections.${section}`, message: `missing required section (${aliases.join(' or ')})` });
        }
    }

    if (kind === 'domain') {
        const accessPatternSection = DOMAIN_SECTIONS.accessPatterns
            .map(alias => actualSections.get(alias))
            .find(content => content !== undefined) ?? '';
        for (const patternId of options.expectedPatternIds ?? []) {
            if (!containsIdentifier(accessPatternSection, patternId)) {
                errors.push({
                    path: `$.sections.accessPatterns.${patternId}`,
                    message: `missing mapping for discovered access pattern ${patternId}`,
                });
            }
        }
        const exampleDocuments = parseExampleDocuments(markdown, errors);
        if (!exampleDocuments.some((document) => typeof document.id === 'string' && typeof document.docType === 'string')) {
            errors.push({ path: '$.examples', message: 'must include at least one JSON example document' });
        }
        const exampleDocTypes = new Set(exampleDocuments.map((document) => document.docType));
        for (const docType of options.expectedDocTypes ?? []) {
            if (!exampleDocTypes.has(docType)) {
                errors.push({ path: '$.examples', message: `missing JSON example for docType ${docType}` });
            }
        }
        if (!/\[(?:access patterns|volumetrics|workload notes|default assumed)\]/iu.test(markdown)) {
            errors.push({ path: '$.capacityInputs', message: 'must include at least one capacity evidence tag' });
        }
    }

    return errors;
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node validate-schema-conversion-summary.mjs --kind <domain|root> <summary.md> [options]

Read-only summary-specific diagnosis. Paths resolve from the current working directory.
The batch domain validator and phase completion already include the relevant summary checks.

    --kind <domain|root>  Required summary kind.
    <summary.md>         Required positional Markdown path.
    --workspace <path>   Required for domain summaries to load assessed access patterns.
    --domain <name>      Required for domain summaries; assessed domain name.
    --model <path>       Model for expected docTypes; domain default is sibling cosmos-model.json.

Outputs JSON {valid, errors}. Exit: 0 when valid; 1 for invalid summaries, arguments, or I/O errors.
`)) return 0;
    try {
        let kind;
        let filePath;
        let modelPath;
        let workspace;
        let domainName;
        for (let index = 0; index < argv.length; index++) {
            if (argv[index] === '--kind') kind = requireOptionValue(argv, index++);
            else if (argv[index] === '--model') modelPath = path.resolve(requireOptionValue(argv, index++));
            else if (argv[index] === '--workspace') workspace = path.resolve(requireOptionValue(argv, index++));
            else if (argv[index] === '--domain') domainName = requireOptionValue(argv, index++);
            else if (!filePath) filePath = path.resolve(argv[index]);
            else throw new Error(`Unexpected argument: ${argv[index]}`);
        }
        if (!kind || !filePath || (kind === 'domain' && (!workspace || !domainName))) {
            process.stderr.write(
                'Usage: validate-schema-conversion-summary.mjs --kind <domain|root> [--workspace <path> --domain <name>] [--model <model.json>] <summary.md>\n',
            );
            return 1;
        }
                const model = modelPath
                        ? JSON.parse(fs.readFileSync(modelPath, 'utf8'))
                        : kind === 'domain'
                            ? readDomainModel(path.join(path.dirname(filePath), 'cosmos-model.json'))
                            : undefined;
        const expectedDocTypes = model?.containers?.flatMap((container) =>
            container.entities.map((entity) => entity.docType),
        );
        const expectedPatternIds = kind === 'domain'
            ? readExpectedPatternIdsByDomain(workspace, [domainName]).get(domainName)
            : undefined;
        const errors = validateSchemaConversionSummary(fs.readFileSync(filePath, 'utf8'), kind, {
            expectedDocTypes,
            expectedPatternIds,
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
