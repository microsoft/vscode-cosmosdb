#!/usr/bin/env node
// Purpose: Validate all schema-conversion domain models and summaries in one bounded batch.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { readPhaseEvidence } from './phase-summary.mjs';
import { validateCosmosModel } from './validate-cosmos-model.mjs';
import {
    readExpectedPatternIdsByDomain,
    validateSchemaConversionSummary,
} from './validate-schema-conversion-summary.mjs';

export const MAX_DOMAIN_VALIDATION_OUTPUT_BYTES = 16 * 1024;
export const DEFAULT_DOMAIN_VALIDATION_PAGE_SIZE = 20;

function diagnostic(domain, artifact, error) {
    return { domain, artifact, path: error.path, message: error.message };
}

export function validateSchemaConversionDomain(
    { name, model, summary },
    referenceRegistry = [],
    { expectedPatternIds = [], warnings = [] } = {},
) {
    const modelWarnings = [];
    const errors = validateCosmosModel(model, { referenceRegistry, warnings: modelWarnings }).map((error) =>
        diagnostic(name, 'model', error),
    );
    warnings.push(...modelWarnings.map(warning => diagnostic(name, 'model', warning)));
    if (model?.domain !== name) {
        errors.push(diagnostic(name, 'model', { path: '$.domain', message: `must equal ${name}` }));
    }
    const expectedDocTypes = model?.containers?.flatMap(container =>
        container.entities?.map(entity => entity.docType) ?? [],
    ) ?? [];
    errors.push(
        ...validateSchemaConversionSummary(summary, 'domain', { expectedDocTypes, expectedPatternIds }).map(error =>
            diagnostic(name, 'summary', error),
        ),
    );
    return errors;
}

export function validateSchemaConversionDomains(
    domains,
    referenceRegistry = [],
    { expectedPatternIdsByDomain = new Map(), warnings = [] } = {},
) {
    const errors = [];
    for (const domain of domains) {
        try {
            const modelPath = path.join(domain.directory, 'cosmos-model.json');
            const summaryPath = path.join(domain.directory, 'summary.md');
            const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
            const summary = fs.readFileSync(summaryPath, 'utf8');
            errors.push(
                ...validateSchemaConversionDomain(
                    { name: domain.name, model, summary },
                    referenceRegistry,
                    { expectedPatternIds: expectedPatternIdsByDomain.get(domain.name) ?? [], warnings },
                ),
            );
        } catch (error) {
            errors.push(diagnostic(domain.name, 'domain', { path: '$', message: error.message }));
        }
    }
    return errors;
}

function summaryResult(domainCount, errors, offset, limit, returned, warnings) {
    const nextOffset = offset + returned.length;
    const returnedErrors = returned.filter(entry => entry.severity !== 'warning');
    const returnedWarnings = returned
        .filter((entry) => entry.severity === 'warning')
        .map(({ severity, ...entry }) => entry);
    const diagnosticCount = errors.length + warnings.length;
    return {
        valid: errors.length === 0,
        domainCount,
        invalidDomainCount: new Set(errors.map(error => error.domain)).size,
        errorCount: errors.length,
        errors: returnedErrors,
        ...(warnings.length
            ? {
                warningCount: warnings.length,
                warnings: returnedWarnings,
                returnedWarnings: returnedWarnings.length,
            }
            : {}),
        offset,
        limit,
        returnedErrors: returnedErrors.length,
        truncated: offset > 0 || nextOffset < diagnosticCount,
        ...(nextOffset < diagnosticCount ? { nextOffset } : {}),
    };
}

export function summarizeDomainValidation(
    domainCount,
    errors,
    {
        offset = 0,
        limit = DEFAULT_DOMAIN_VALIDATION_PAGE_SIZE,
        maxOutputBytes = MAX_DOMAIN_VALIDATION_OUTPUT_BYTES,
        warnings = [],
    } = {},
) {
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Offset must be a non-negative integer.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be between 1 and 100.');
    const returned = [];
    const diagnostics = [...errors, ...warnings.map(warning => ({ ...warning, severity: 'warning' }))];
    for (const error of diagnostics.slice(offset, offset + limit)) {
        const candidate = summaryResult(domainCount, errors, offset, limit, [...returned, error], warnings);
        if (Buffer.byteLength(`${JSON.stringify(candidate, null, 2)}\n`) <= maxOutputBytes) {
            returned.push(error);
            continue;
        }
        const omitted = {
            domain: String(error.domain).slice(0, 200),
            artifact: String(error.artifact).slice(0, 100),
            path: String(error.path).slice(0, 500),
            message: 'Diagnostic omitted: exceeds output limit',
            ...(error.severity === 'warning' ? { severity: 'warning' } : {}),
        };
        const fallback = summaryResult(domainCount, errors, offset, limit, [...returned, omitted], warnings);
        if (Buffer.byteLength(`${JSON.stringify(fallback, null, 2)}\n`) <= maxOutputBytes) returned.push(omitted);
        break;
    }
    return summaryResult(domainCount, errors, offset, limit, returned, warnings);
}

function parseArguments(argv) {
    const options = { domains: [], offset: 0, limit: DEFAULT_DOMAIN_VALIDATION_PAGE_SIZE };
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--workspace') options.workspace = path.resolve(requireOptionValue(argv, index++));
        else if (argument === '--reference-manifest') options.referenceManifest = path.resolve(requireOptionValue(argv, index++));
        else if (argument === '--domain') {
            const value = requireOptionValue(argv, index++);
            const separator = value?.indexOf('=') ?? -1;
            if (separator <= 0 || !value.slice(0, separator).trim() || !value.slice(separator + 1).trim()) {
                throw new Error('--domain must use <name>=<directory>');
            }
            options.domains.push({ name: value.slice(0, separator), directory: path.resolve(value.slice(separator + 1)) });
        } else if (argument === '--offset') options.offset = Number(requireOptionValue(argv, index++));
        else if (argument === '--limit') options.limit = Number(requireOptionValue(argv, index++));
        else throw new Error(`Unexpected argument: ${argument}`);
    }
    if (!options.workspace || !options.referenceManifest || options.domains.length === 0) {
        throw new Error('Usage: validate-schema-conversion-domains.mjs --workspace <path> --reference-manifest <manifest.json> --domain <name>=<directory> [--domain ...] [--offset <number>] [--limit <number>]');
    }
    if (new Set(options.domains.map(domain => domain.name)).size !== options.domains.length) {
        throw new Error('Domain names must be unique.');
    }
    return options;
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node validate-schema-conversion-domains.mjs --workspace <path> --reference-manifest <manifest.json> --domain <name>=<directory> [options]

Read-only batch validation of domain models and summaries against shared references
and assessed access patterns. All paths resolve from the current working directory.

    --workspace <path>          Required application root.
    --reference-manifest <path> Required root schema-conversion manifest with referenceRegistry.
    --domain <name>=<directory> Required, repeatable; directory holds cosmos-model.json and summary.md.
    --offset <n>                Diagnostic offset; default 0.
    --limit <n>                 Page size from 1 to 100; default ${DEFAULT_DOMAIN_VALIDATION_PAGE_SIZE}.

Outputs bounded JSON. Pagination does not narrow validation. Replaces separate domain
model and summary checks for unchanged inputs; not a replacement for final phase completion.
Exit: 0 when all supplied domains validate; 1 for validation or I/O errors.
`)) return 0;
    try {
        const options = parseArguments(argv);
        const referenceRegistry = readPhaseEvidence(options.referenceManifest).referenceRegistry ?? [];
        if (!Array.isArray(referenceRegistry)) throw new Error('Reference registry must be an array.');
        const expectedPatternIdsByDomain = readExpectedPatternIdsByDomain(
            options.workspace,
            options.domains.map(domain => domain.name),
        );
        const warnings = [];
        const errors = validateSchemaConversionDomains(options.domains, referenceRegistry, {
            expectedPatternIdsByDomain,
            warnings,
        });
        const result = summarizeDomainValidation(options.domains.length, errors, { ...options, warnings });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result.valid ? 0 : 1;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
