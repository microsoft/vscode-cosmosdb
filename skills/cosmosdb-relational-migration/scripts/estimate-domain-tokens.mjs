#!/usr/bin/env node
// Purpose: Estimate schema-conversion working context without claiming an unknown model budget.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';

export const DEFAULT_CHARACTERS_PER_TOKEN = 3;
export const DEFAULT_TOOL_OUTPUT_BYTES = 16 * 1024;
export const DEFAULT_OUTPUT_RESERVE_RATIO = 0.2;
export const DEFAULT_SAFETY_MARGIN_RATIO = 0.1;
export const MAX_ESTIMATE_OUTPUT_BYTES = 16 * 1024;
export const DEFAULT_ESTIMATE_PAGE_SIZE = 50;

function requirePositiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
}

export function normalizeDomainMarkdown(markdown) {
    return markdown.replace(/^(## Estimated Tokens:\s*).*$/mu, (_line, prefix) => `${prefix}0`);
}

function requireNonNegativeInteger(value, name) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
}

function contentTokens(content, charactersPerToken) {
    if (typeof content !== 'string') throw new Error('Estimated content must be a string.');
    return Math.ceil(content.length / charactersPerToken);
}

function uniqueInputs(inputs, existing = new Map()) {
    const result = new Map(existing);
    for (const input of inputs) {
        if (!input || typeof input.id !== 'string' || !input.id || typeof input.content !== 'string') {
            throw new Error('Inputs require a non-empty id and string content.');
        }
        if (result.has(input.id) && result.get(input.id) !== input.content) {
            throw new Error(`Input ${input.id} has conflicting content.`);
        }
        result.set(input.id, input.content);
    }
    return result;
}

export function estimateDomainWorkingSets({
    domains,
    sharedInputs = [],
    ruleInputs = [],
    charactersPerToken = DEFAULT_CHARACTERS_PER_TOKEN,
    contextWindowTokens,
    outputReserveTokens,
    safetyMarginTokens,
    toolOutputBytes = DEFAULT_TOOL_OUTPUT_BYTES,
}) {
    if (!Array.isArray(domains) || domains.length === 0) throw new Error('At least one domain is required.');
    requirePositiveInteger(charactersPerToken, 'charactersPerToken');
    requireNonNegativeInteger(toolOutputBytes, 'toolOutputBytes');
    if (contextWindowTokens !== undefined) requirePositiveInteger(contextWindowTokens, 'contextWindowTokens');
    if (outputReserveTokens !== undefined) requireNonNegativeInteger(outputReserveTokens, 'outputReserveTokens');
    if (safetyMarginTokens !== undefined) requireNonNegativeInteger(safetyMarginTokens, 'safetyMarginTokens');
    if (contextWindowTokens === undefined && (outputReserveTokens !== undefined || safetyMarginTokens !== undefined)) {
        throw new Error('Output reserve and safety margin require a known context window.');
    }

    const names = domains.map(domain => domain?.name);
    if (names.some(name => typeof name !== 'string' || !name) || new Set(names).size !== names.length) {
        throw new Error('Domain names must be non-empty and unique.');
    }

    const shared = uniqueInputs([...sharedInputs, ...ruleInputs]);
    const sharedTokens = [...shared.values()].reduce(
        (total, content) => total + contentTokens(content, charactersPerToken),
        0,
    );
    const toolOutputTokens = Math.ceil(toolOutputBytes / charactersPerToken);
    const resolvedOutputReserve = contextWindowTokens === undefined
        ? null
        : outputReserveTokens ?? Math.ceil(contextWindowTokens * DEFAULT_OUTPUT_RESERVE_RATIO);
    const resolvedSafetyMargin = contextWindowTokens === undefined
        ? null
        : safetyMarginTokens ?? Math.ceil(contextWindowTokens * DEFAULT_SAFETY_MARGIN_RATIO);
    const usableInputTokens = contextWindowTokens === undefined
        ? null
        : Math.max(0, contextWindowTokens - resolvedOutputReserve - resolvedSafetyMargin);

    return {
        estimator: 'character-heuristic',
        charactersPerToken,
        contextWindowTokens: contextWindowTokens ?? null,
        outputReserveTokens: resolvedOutputReserve,
        safetyMarginTokens: resolvedSafetyMargin,
        usableInputTokens,
        sharedInputCount: shared.size,
        sharedTokens,
        toolOutputBytes,
        toolOutputTokens,
        domains: domains.map(domain => {
            if (typeof domain.markdown !== 'string') throw new Error(`Domain ${domain.name} markdown must be a string.`);
            const domainTokens = contentTokens(normalizeDomainMarkdown(domain.markdown), charactersPerToken);
            const domainInputs = uniqueInputs(domain.inputs ?? [], shared);
            const domainInputTokens = [...domainInputs]
                .filter(([id]) => !shared.has(id))
                .reduce((total, [, content]) => total + contentTokens(content, charactersPerToken), 0);
            const estimatedInputTokens = sharedTokens + domainTokens + domainInputTokens + toolOutputTokens;
            const budgetStatus = usableInputTokens === null
                ? 'unknown'
                : estimatedInputTokens <= usableInputTokens
                  ? 'fits'
                  : 'exceeds';
            return {
                name: domain.name,
                domainTokens,
                domainInputTokens,
                estimatedInputTokens,
                budgetStatus,
                splitRequired: budgetStatus === 'unknown' ? null : budgetStatus === 'exceeds',
            };
        }),
    };
}

function estimatePage(report, domains, offset, limit) {
    const nextOffset = offset + domains.length;
    return {
        estimator: report.estimator,
        charactersPerToken: report.charactersPerToken,
        contextWindowTokens: report.contextWindowTokens,
        outputReserveTokens: report.outputReserveTokens,
        safetyMarginTokens: report.safetyMarginTokens,
        usableInputTokens: report.usableInputTokens,
        sharedInputCount: report.sharedInputCount,
        sharedTokens: report.sharedTokens,
        toolOutputBytes: report.toolOutputBytes,
        toolOutputTokens: report.toolOutputTokens,
        domainCount: report.domains.length,
        exceedsCount: report.domains.filter(domain => domain.budgetStatus === 'exceeds').length,
        unknownCount: report.domains.filter(domain => domain.budgetStatus === 'unknown').length,
        domains,
        offset,
        limit,
        returnedDomains: domains.length,
        truncated: offset > 0 || nextOffset < report.domains.length,
        ...(nextOffset < report.domains.length ? { nextOffset } : {}),
    };
}

export function summarizeDomainWorkingSets(
    report,
    { offset = 0, limit = DEFAULT_ESTIMATE_PAGE_SIZE, maxOutputBytes = MAX_ESTIMATE_OUTPUT_BYTES } = {},
) {
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Offset must be a non-negative integer.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be between 1 and 100.');
    const returned = [];
    for (const domain of report.domains.slice(offset, offset + limit)) {
        const candidate = estimatePage(report, [...returned, domain], offset, limit);
        if (Buffer.byteLength(`${JSON.stringify(candidate, null, 2)}\n`) <= maxOutputBytes) {
            returned.push(domain);
            continue;
        }
        const omitted = {
            ...domain,
            name: String(domain.name).slice(0, 200),
        };
        const fallback = estimatePage(report, [...returned, omitted], offset, limit);
        if (Buffer.byteLength(`${JSON.stringify(fallback, null, 2)}\n`) <= maxOutputBytes) returned.push(omitted);
        break;
    }
    return estimatePage(report, returned, offset, limit);
}

function assignment(value, option) {
    const separator = value?.indexOf('=') ?? -1;
    if (separator <= 0 || !value.slice(0, separator).trim() || !value.slice(separator + 1).trim()) {
        throw new Error(`${option} must use <name>=<path>`);
    }
    return { name: value.slice(0, separator), filePath: path.resolve(value.slice(separator + 1)) };
}

function fileInput(filePath) {
    const realPath = fs.realpathSync(filePath);
    return { id: realPath, content: fs.readFileSync(realPath, 'utf8') };
}

function parseArguments(argv) {
    const options = {
        domains: [],
        domainInputs: [],
        sharedPaths: [],
        rulePaths: [],
        offset: 0,
        limit: DEFAULT_ESTIMATE_PAGE_SIZE,
    };
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--domain') options.domains.push(assignment(requireOptionValue(argv, index++), argument));
        else if (argument === '--domain-input') options.domainInputs.push(assignment(requireOptionValue(argv, index++), argument));
        else if (argument === '--shared') options.sharedPaths.push(path.resolve(requireOptionValue(argv, index++)));
        else if (argument === '--rule') options.rulePaths.push(path.resolve(requireOptionValue(argv, index++)));
        else if (argument === '--context-window') options.contextWindowTokens = Number(requireOptionValue(argv, index++));
        else if (argument === '--output-reserve') options.outputReserveTokens = Number(requireOptionValue(argv, index++));
        else if (argument === '--safety-margin') options.safetyMarginTokens = Number(requireOptionValue(argv, index++));
        else if (argument === '--tool-output-bytes') options.toolOutputBytes = Number(requireOptionValue(argv, index++));
        else if (argument === '--characters-per-token') options.charactersPerToken = Number(requireOptionValue(argv, index++));
        else if (argument === '--offset') options.offset = Number(requireOptionValue(argv, index++));
        else if (argument === '--limit') options.limit = Number(requireOptionValue(argv, index++));
        else throw new Error(`Unexpected argument: ${argument}`);
    }
    if (options.domains.length === 0) {
        throw new Error('Usage: estimate-domain-tokens.mjs --domain <name>=<path> [--domain ...] [--domain-input <name>=<path>] [--shared <path>] [--rule <path>] [--context-window <tokens>] [--output-reserve <tokens>] [--safety-margin <tokens>]');
    }
    return options;
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node estimate-domain-tokens.mjs --domain <name>=<path> [options]

Estimate schema-conversion working sets using a character heuristic. Read-only.
Paths resolve from the current working directory. Outputs paginated JSON.

    --domain <name>=<path>        Domain Markdown; repeat for multiple domains (required).
    --domain-input <name>=<path>  Additional input owned by a named domain; repeatable.
    --shared <path>              Input shared across domains; repeatable.
    --rule <path>                Selected rule shared across domains; repeatable.
    --context-window <tokens>    Known model context budget; omit when unknown.
    --output-reserve <tokens>    Requires a context window; default 20% of that window.
    --safety-margin <tokens>     Requires a context window; default 10% of that window.
    --tool-output-bytes <bytes>  Expected tool output; default 16384.
    --characters-per-token <n>  Positive integer; default 3.
    --offset <n>                Domain offset; default 0.
    --limit <n>                 Page size from 1 to 100; default 50.

Without a known context window, budgetStatus is unknown and splitRequired is null.
Exit: 0 on success; 1 for invalid arguments or inputs.
`)) return 0;
    try {
        const options = parseArguments(argv);
        const domainInputs = new Map(options.domains.map(domain => [domain.name, []]));
        for (const input of options.domainInputs) {
            if (!domainInputs.has(input.name)) throw new Error(`Unknown domain input owner: ${input.name}`);
            domainInputs.get(input.name).push(fileInput(input.filePath));
        }
        const result = estimateDomainWorkingSets({
            ...options,
            domains: options.domains.map(domain => ({
                name: domain.name,
                markdown: fs.readFileSync(domain.filePath, 'utf8'),
                inputs: domainInputs.get(domain.name),
            })),
            sharedInputs: options.sharedPaths.map(fileInput),
            ruleInputs: options.rulePaths.map(fileInput),
        });
        process.stdout.write(`${JSON.stringify(summarizeDomainWorkingSets(result, options), null, 2)}\n`);
        return 0;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
