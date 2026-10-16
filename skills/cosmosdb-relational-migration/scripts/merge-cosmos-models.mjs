#!/usr/bin/env node
// Purpose: Merge per-domain Cosmos DB models into one validated database model.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { readDomainModel, readPhaseEvidence } from './phase-summary.mjs';
import { reconcileCapacity } from './reconcile-capacity.mjs';
import {
    canonicalFullTextPolicy,
    canonicalStringify,
    canonicalUniqueKeyPolicy,
    validateAndCanonicalize,
    validateCosmosModel,
    writeFileAtomic,
} from './validate-cosmos-model.mjs';

function clone(value) {
    return structuredClone(value);
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function mergeUnique(left = [], right = []) {
    const values = new Map();
    for (const value of [...left, ...right]) values.set(stableJson(value), clone(value));
    return [...values.entries()]
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([, value]) => value);
}

function sameValue(left, right) {
    return stableJson(left) === stableJson(right);
}

function mergeIndexingPolicies(left, right, context, conflicts) {
    for (const key of ['indexingMode', 'automatic']) {
        if (left[key] !== undefined && right[key] !== undefined && !sameValue(left[key], right[key])) {
            conflicts.push(`${context}: indexing policy ${key} differs`);
        }
    }

    const includedPaths = mergeUnique(left.includedPaths, right.includedPaths);
    const excludedPaths = mergeUnique(left.excludedPaths, right.excludedPaths);
    const included = new Set(includedPaths.map((entry) => entry.path));
    for (const entry of excludedPaths) {
        if (included.has(entry.path)) conflicts.push(`${context}: index path "${entry.path}" is both included and excluded`);
    }

    const result = {
        indexingMode: left.indexingMode ?? right.indexingMode,
        automatic: left.automatic ?? right.automatic,
        includedPaths,
        excludedPaths,
    };
    const compositeIndexes = mergeUnique(left.compositeIndexes, right.compositeIndexes);
    if (compositeIndexes.length > 0) result.compositeIndexes = compositeIndexes;
    const fullTextIndexes = mergeUnique(left.fullTextIndexes, right.fullTextIndexes);
    if (fullTextIndexes.length > 0) result.fullTextIndexes = fullTextIndexes;
    return result;
}

function mergeFullTextPolicies(left, right, context, conflicts) {
    if (left === undefined) return clone(right);
    if (right === undefined) return clone(left);
    const first = canonicalFullTextPolicy(left);
    const second = canonicalFullTextPolicy(right);
    if (first.defaultLanguage !== second.defaultLanguage) {
        conflicts.push(`${context}: full-text default language differs`);
    }
    const paths = new Map(first.fullTextPaths.map((entry) => [entry.path, entry.language]));
    for (const entry of second.fullTextPaths) {
        if (paths.has(entry.path) && paths.get(entry.path) !== entry.language) {
            conflicts.push(`${context}: full-text language differs for path "${entry.path}"`);
        }
    }
    return {
        defaultLanguage: first.defaultLanguage,
        fullTextPaths: mergeUnique(first.fullTextPaths, second.fullTextPaths),
    };
}

function validateDomainInput(domainName, model, referenceRegistry) {
    const errors = validateCosmosModel(model, { referenceRegistry });
    if (model.domain !== domainName || domainName === 'all') errors.push({ path: '$.domain', message: 'must match the declared domain name and must not be all' });
    return errors.map((error) => ({ ...error, path: `${domainName}:${error.path}` }));
}

export function mergeCosmosModels(domainModels, { databaseName, capacityMode, capacityEvidence }) {
    const conflicts = [];
    const errors = [];
    const containers = new Map();
    const sourceTypes = new Set();
    const accessPatterns = [];
    const crossPartitionQueries = [];

    const orderedDomains = [...domainModels].sort((left, right) => left.domainName.localeCompare(right.domainName));
    if (new Set(orderedDomains.map(entry => entry.domainName)).size !== orderedDomains.length) {
        return { errors: [{ path: '$.domains', message: 'duplicate domain input' }], conflicts };
    }
    const referenceRegistry = orderedDomains.flatMap(({ domainName, model }) =>
        (model.containers ?? []).flatMap(container => (container.entities ?? []).map(entity => ({
            domain: domainName, name: entity.name, sourceTable: entity.sourceTable,
        }))),
    );
    for (const { domainName, model } of orderedDomains) {
        errors.push(...validateDomainInput(domainName, model, referenceRegistry));
        if (model.sourceType) sourceTypes.add(model.sourceType);
        accessPatterns.push(
            ...(model.accessPatterns ?? []).map((pattern) => ({ ...clone(pattern), name: `${domainName}: ${pattern.name}` })),
        );
        crossPartitionQueries.push(
            ...(model.crossPartitionQueries ?? []).map((query) => ({ ...clone(query), name: `${domainName}: ${query.name}` })),
        );

        for (const incomingContainer of model.containers ?? []) {
            const key = incomingContainer.name.toLocaleLowerCase('en-US');
            const existing = containers.get(key);
            if (!existing) {
                containers.set(key, { container: clone(incomingContainer), domains: [domainName], hasEstimates: ['maxThroughput', 'estimatedStorageGB', 'estimatedRowCount'].some(field => incomingContainer[field] !== undefined) });
                continue;
            }

            const context = `Container "${incomingContainer.name}" in domains "${existing.domains.join(', ')}" and "${domainName}"`;
            existing.domains.push(domainName);
            if (
                Array.isArray(existing.container.partitionKeys) &&
                Array.isArray(incomingContainer.partitionKeys) &&
                !sameValue(
                    existing.container.partitionKeys.map(partitionKey => partitionKey?.path),
                    incomingContainer.partitionKeys.map(partitionKey => partitionKey?.path),
                )
            ) {
                conflicts.push(`${context}: partition keys differ`);
            }

            const entityNames = new Set(existing.container.entities.map((entity) => entity.name.toLocaleLowerCase('en-US')));
            for (const entity of incomingContainer.entities) {
                if (entityNames.has(entity.name.toLocaleLowerCase('en-US'))) {
                    conflicts.push(`${context}: duplicate entity name "${entity.name}"`);
                } else {
                    existing.container.entities.push(clone(entity));
                    entityNames.add(entity.name.toLocaleLowerCase('en-US'));
                }
            }

            existing.container.indexingPolicy = mergeIndexingPolicies(
                existing.container.indexingPolicy,
                incomingContainer.indexingPolicy,
                context,
                conflicts,
            );
            if (errors.length === 0) {
                const fullTextPolicy = mergeFullTextPolicies(
                    existing.container.fullTextPolicy,
                    incomingContainer.fullTextPolicy,
                    context,
                    conflicts,
                );
                if (fullTextPolicy !== undefined) existing.container.fullTextPolicy = fullTextPolicy;
                const uniquePolicies = [existing.container.uniqueKeyPolicy, incomingContainer.uniqueKeyPolicy]
                    .map(policy => policy === undefined ? undefined : canonicalUniqueKeyPolicy(policy));
                if (!sameValue(uniquePolicies[0], uniquePolicies[1])) {
                    conflicts.push(`${context}: unique-key policies differ; every sharing domain must agree on the complete policy`);
                }
            }
            existing.hasEstimates ||= ['maxThroughput', 'estimatedStorageGB', 'estimatedRowCount'].some(field => incomingContainer[field] !== undefined);
        }
    }

    if (capacityEvidence !== undefined && (capacityEvidence?.version !== 1 || !Array.isArray(capacityEvidence.containers))) {
        conflicts.push('Capacity evidence must be version 1 with a containers array');
    } else {
        const evidenceNames = (capacityEvidence?.containers ?? []).map(entry => entry.name);
        if (new Set(evidenceNames).size !== evidenceNames.length || evidenceNames.some(name => !containers.has(name.toLowerCase()))) conflicts.push('Unknown or duplicate capacity evidence container');
        for (const { container, domains, hasEstimates } of containers.values()) {
            const evidence = capacityEvidence?.containers.find(entry => entry.name === container.name);
            if (evidence || (domains.length > 1 && hasEstimates)) {
                try {
                    const reconciled = reconcileCapacity(evidence, domains, capacityMode);
                    for (const field of ['maxThroughput', 'estimatedStorageGB', 'estimatedRowCount']) delete container[field];
                    Object.assign(container, reconciled);
                } catch (error) { conflicts.push(`Container "${container.name}": ${error.message}`); }
            }
        }
    }
    if (sourceTypes.size > 1) conflicts.push(`Source types differ: ${[...sourceTypes].sort().join(', ')}`);
    if (errors.length > 0 || conflicts.length > 0) return { errors, conflicts };

    const candidate = {
        version: 1,
        databaseName,
        capacityMode,
        domain: 'all',
        sourceType: sourceTypes.size === 1 ? [...sourceTypes][0] : undefined,
        containers: [...containers.values()].map(({ container }) => container),
        accessPatterns: accessPatterns.length > 0 ? accessPatterns : undefined,
        crossPartitionQueries: crossPartitionQueries.length > 0 ? crossPartitionQueries : undefined,
    };
    const result = validateAndCanonicalize(candidate);
    return { ...result, conflicts };
}

function parseArguments(argv) {
    const args = { databaseName: undefined, capacityMode: undefined, output: undefined, inputs: [] };
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--manifest') args.manifestPath = path.resolve(requireOptionValue(argv, index++));
        else if (argument === '--capacity-evidence') args.capacityPath = path.resolve(requireOptionValue(argv, index++));
        else if (argument === '--database') args.databaseName = requireOptionValue(argv, index++);
        else if (argument === '--capacity') args.capacityMode = requireOptionValue(argv, index++);
        else if (argument === '--output') args.output = path.resolve(requireOptionValue(argv, index++));
        else if (argument === '--input') {
            const input = requireOptionValue(argv, index++);
            const separator = input.indexOf('=');
            if (separator <= 0 || !input.slice(0, separator).trim() || !input.slice(separator + 1).trim()) {
                throw new Error('--input must use <domain>=<model.json>');
            }
            args.inputs.push({ domainName: input.slice(0, separator), filePath: path.resolve(input.slice(separator + 1)) });
        } else throw new Error(`Unexpected argument: ${argument}`);
    }
    if (!args.databaseName || !args.capacityMode || !args.output || args.inputs.length === 0) {
        throw new Error(
            'Usage: merge-cosmos-models.mjs --database <name> --capacity <serverless|provisioned> --output <model.json> --input <domain>=<model.json> [--input ...]',
        );
    }
    return args;
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node merge-cosmos-models.mjs --database <name> --capacity <serverless|provisioned> --output <model.json> --input <domain>=<model.json> [options]

Validate and merge accepted domain models; atomically write/replace the canonical root model.
Paths resolve from the current working directory. Does not update project checkpoints.

    --database <name>          Required target database name.
    --capacity <mode>          Required: serverless or provisioned.
    --output <path>            Required destination; existing model is replaced on success.
    --input <domain>=<path>    Required, repeatable; JSON containing the domain model itself.
    --manifest <path>          Root phase manifest; preferred source of capacity evidence.
                                                        Its database and capacity settings must match the CLI.
    --capacity-evidence <path> Fallback JSON when the manifest provides no capacityEvidence.

Use the phase manifest in normal workflow; standalone evidence is a diagnostic interface.
Outputs a JSON success report; errors/conflicts go to stderr. Does not resolve design conflicts.
Exit: 0 after writing a valid model; 1 for validation, merge, or I/O failures.
`)) return 0;
    try {
        const args = parseArguments(argv);
        const domainModels = args.inputs.map(({ domainName, filePath }) => ({
            domainName,
            model: path.basename(filePath) === 'manifest.json' ? readDomainModel(filePath) : JSON.parse(fs.readFileSync(filePath, 'utf8')),
        }));
        const manifest = args.manifestPath ? readPhaseEvidence(args.manifestPath) : undefined;
        if (manifest && (manifest.databaseName !== args.databaseName || manifest.capacityMode !== args.capacityMode)) throw new Error('Merge settings differ from the phase manifest');
        const result = mergeCosmosModels(domainModels, { ...args, capacityEvidence: manifest?.capacityEvidence ?? (args.capacityPath ? JSON.parse(fs.readFileSync(args.capacityPath, 'utf8')) : undefined) });
        const diagnostics = result.warnings?.length ? { warnings: result.warnings } : {};
        if (!result.model) {
            const report = { valid: false, errors: result.errors, conflicts: result.conflicts, ...diagnostics };
            process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
            return 1;
        }
        writeFileAtomic(args.output, canonicalStringify(result.model));
        process.stdout.write(`${JSON.stringify({ valid: true, output: args.output, ...diagnostics })}\n`);
        return 0;
    } catch (error) {
        process.stderr.write(`${JSON.stringify({ valid: false, errors: [{ path: '$', message: error.message }] }, null, 2)}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
