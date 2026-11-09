#!/usr/bin/env node
// Purpose: Assess source SDKs against supported Azure Cosmos DB SDK families.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';

export const MATRIX_VERSION = 1;
export const MATRIX_VERIFIED_AT = '2026-09-03';
export const SDK_OVERVIEW_URL = 'https://learn.microsoft.com/azure/cosmos-db/quickstart-dotnet';

const SDK_FAMILIES = [
    {
        family: 'dotnet',
        displayName: '.NET',
        aliases: ['.net', 'dotnet', 'c#', 'csharp'],
        interoperableAliases: ['f#', 'fsharp', 'visual basic', 'visual basic .net', 'vb', 'vb.net'],
        package: 'Microsoft.Azure.Cosmos',
        support: 'stable',
        documentation: 'https://learn.microsoft.com/azure/cosmos-db/quickstart-dotnet',
    },
    {
        family: 'nodejs',
        displayName: 'Node.js',
        aliases: ['node', 'node.js', 'nodejs', 'javascript', 'typescript', 'js', 'ts'],
        interoperableAliases: [],
        package: '@azure/cosmos',
        support: 'stable',
        documentation: 'https://learn.microsoft.com/azure/cosmos-db/quickstart-nodejs',
    },
    {
        family: 'java',
        displayName: 'Java',
        aliases: ['java'],
        interoperableAliases: ['kotlin', 'scala', 'clojure', 'groovy'],
        package: 'com.azure:azure-cosmos',
        support: 'stable',
        documentation: 'https://learn.microsoft.com/azure/cosmos-db/quickstart-java',
    },
    {
        family: 'python',
        displayName: 'Python',
        aliases: ['python', 'python3'],
        interoperableAliases: [],
        package: 'azure-cosmos',
        support: 'stable',
        documentation: 'https://learn.microsoft.com/azure/cosmos-db/quickstart-python',
    },
    {
        family: 'go',
        displayName: 'Go',
        aliases: ['go', 'golang'],
        interoperableAliases: [],
        package: 'github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos',
        support: 'stable',
        documentation: 'https://learn.microsoft.com/azure/cosmos-db/quickstart-go',
    },
    {
        family: 'rust',
        displayName: 'Rust',
        aliases: ['rust'],
        interoperableAliases: [],
        package: 'azure_data_cosmos',
        support: 'preview',
        documentation: 'https://learn.microsoft.com/azure/cosmos-db/quickstart-rust',
    },
];

function normalizeLanguage(language) {
    return language.trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}

export function classifyLanguage(language) {
    const normalizedLanguage = normalizeLanguage(language);
    for (const sdk of SDK_FAMILIES) {
        if (sdk.aliases.includes(normalizedLanguage)) {
            return {
                language,
                normalizedLanguage,
                status: sdk.support === 'preview' ? 'preview' : 'supported',
                sdkFamily: sdk.family,
                sdkDisplayName: sdk.displayName,
                package: sdk.package,
                interoperability: false,
                documentation: sdk.documentation,
            };
        }
        if (sdk.interoperableAliases.includes(normalizedLanguage)) {
            return {
                language,
                normalizedLanguage,
                status: 'supported',
                sdkFamily: sdk.family,
                sdkDisplayName: sdk.displayName,
                package: sdk.package,
                interoperability: true,
                documentation: sdk.documentation,
                warning: `No dedicated ${language} SDK is listed; use the ${sdk.displayName} SDK through runtime interoperability and verify framework compatibility.`,
            };
        }
    }

    return {
        language,
        normalizedLanguage,
        status: 'unsupported',
        sdkFamily: null,
        sdkDisplayName: null,
        package: null,
        interoperability: false,
        documentation: SDK_OVERVIEW_URL,
        warning: `No first-party Azure Cosmos DB for NoSQL SDK is listed for ${language}. Continue from discovery through provisioning, but migrate the project or data-access layer to .NET, JavaScript/TypeScript, Java, Python, or Go before code migration. Rust is available in public preview.`,
    };
}

export function buildCompatibilityReport(languages) {
    if (!Array.isArray(languages) || languages.some(language => typeof language !== 'string')) {
        throw new Error('SDK classification requires an array of language names.');
    }
    const uniqueLanguages = [...new Map(languages.map(language => language.trim()).filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .map(language => [normalizeLanguage(language), language])).values()];
    if (!uniqueLanguages.length) throw new Error('SDK classification requires at least one language.');
    const results = uniqueLanguages.map(classifyLanguage);
    const overallStatus = results.some((result) => result.status === 'unsupported')
        ? 'unsupported'
        : results.some((result) => result.status === 'preview')
          ? 'preview'
          : 'supported';

    return {
        version: 1,
        matrixVersion: MATRIX_VERSION,
        matrixVerifiedAt: MATRIX_VERIFIED_AT,
        overallStatus,
        analyticalPhasesAllowed: true,
        codeMigrationAllowed: results.every((result) => result.status !== 'unsupported'),
        results,
        officialSources: {
            sdkQuickstarts: SDK_OVERVIEW_URL,
            rustQuickstart: 'https://learn.microsoft.com/azure/cosmos-db/quickstart-rust',
        },
        onlineDocumentationRefreshRecommended: results.some((result) => result.status !== 'supported'),
    };
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isOfficialDocumentation(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'learn.microsoft.com' &&
            !url.username && !url.password && !url.port && url.pathname !== '/';
    } catch {
        return false;
    }
}

export function validateCompatibilityReport(report, expectedLanguages) {
    const errors = [];
    const fail = (field, message) => errors.push({ path: field, message });
    if (!isObject(report)) {
        return { errors: [{ path: '$', message: 'must be an SDK compatibility report object' }], codeMigrationAllowed: false };
    }
    if (report.version !== 1) fail('$.version', 'must equal 1');
    if (report.matrixVersion !== MATRIX_VERSION) fail('$.matrixVersion', 'must match the bundled SDK matrix version; regenerate the report');
    if (report.matrixVerifiedAt !== MATRIX_VERIFIED_AT) fail('$.matrixVerifiedAt', 'must identify the bundled matrix verification date');
    if (!Array.isArray(expectedLanguages) || !expectedLanguages.length || expectedLanguages.some(language => !nonEmptyString(language))) {
        fail('$.results', 'requires a non-empty list of expected application languages');
    }
    const expected = new Set((Array.isArray(expectedLanguages) ? expectedLanguages : [])
        .filter(nonEmptyString).map(normalizeLanguage));
    if (!Array.isArray(report.results) || !report.results.length) {
        fail('$.results', 'must be a non-empty array of language classifications');
        return { errors, codeMigrationAllowed: false };
    }
    const seen = new Set();
    const statuses = new Set(['supported', 'preview', 'unsupported']);
    const classificationFields = ['status', 'sdkFamily', 'package', 'interoperability'];
    for (const [index, result] of report.results.entries()) {
        const field = `$.results[${index}]`;
        if (!isObject(result) || !nonEmptyString(result.language)) {
            fail(field, 'requires a non-empty language name');
            continue;
        }
        const language = normalizeLanguage(result.language);
        if (seen.has(language)) fail(`${field}.language`, 'duplicates a normalized language');
        seen.add(language);
        if (!expected.has(language)) fail(`${field}.language`, 'is not an expected application language');
        if (result.normalizedLanguage !== language) fail(`${field}.normalizedLanguage`, 'must match the normalized language name');
        if (!statuses.has(result.status)) fail(`${field}.status`, 'must be supported, preview, or unsupported');
        if (typeof result.interoperability !== 'boolean') fail(`${field}.interoperability`, 'must be a boolean');
        for (const property of ['sdkFamily', 'sdkDisplayName', 'package']) {
            if (result.status === 'unsupported' ? result[property] !== null : !nonEmptyString(result[property])) {
                fail(`${field}.${property}`, result.status === 'unsupported' ? 'must be null for unsupported languages' : 'must identify the first-party SDK');
            }
        }
        if (result.status === 'unsupported' && result.interoperability !== false) {
            fail(`${field}.interoperability`, 'must be false for unsupported languages');
        }
        if (!isOfficialDocumentation(result.documentation)) fail(`${field}.documentation`, 'must be an HTTPS Microsoft Learn documentation URL');

        if (result.documentationOverride === undefined) {
            const baseline = classifyLanguage(result.language);
            for (const property of [...classificationFields, 'sdkDisplayName']) {
                if (result[property] !== baseline[property]) {
                    fail(`${field}.${property}`, 'differs from the bundled SDK matrix without documented override evidence');
                }
            }
        } else {
            const override = result.documentationOverride;
            const overridePath = `${field}.documentationOverride`;
            if (!isObject(override)) {
                fail(overridePath, 'must be an explicit documentation review object');
                continue;
            }
            if (!nonEmptyString(override.language) || normalizeLanguage(override.language) !== language) {
                fail(`${overridePath}.language`, 'must match the classified language');
            }
            for (const property of [...classificationFields, 'documentation']) {
                if (override[property] !== result[property]) fail(`${overridePath}.${property}`, 'must match the revised classification');
            }
            if (!isOfficialDocumentation(override.documentation)) fail(`${overridePath}.documentation`, 'must be an HTTPS Microsoft Learn documentation URL');
            if (typeof override.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(override.reviewedAt) ||
                !Number.isFinite(Date.parse(override.reviewedAt)) || new Date(override.reviewedAt).toISOString().slice(0, 10) !== override.reviewedAt) {
                fail(`${overridePath}.reviewedAt`, 'must be a valid YYYY-MM-DD review date');
            }
            if (!nonEmptyString(override.rationale)) fail(`${overridePath}.rationale`, 'must explain the evidence for the revised first-party SDK classification');
        }
    }
    for (const language of expected) {
        if (!seen.has(language)) fail('$.results', `missing classification for ${language}`);
    }
    const overallStatus = report.results.some(result => result?.status === 'unsupported') ? 'unsupported'
        : report.results.some(result => result?.status === 'preview') ? 'preview' : 'supported';
    const allowed = overallStatus !== 'unsupported';
    if (report.overallStatus !== overallStatus) fail('$.overallStatus', `must equal the derived status ${overallStatus}`);
    if (report.analyticalPhasesAllowed !== true) fail('$.analyticalPhasesAllowed', 'must be true regardless of SDK support status');
    if (report.codeMigrationAllowed !== allowed) fail('$.codeMigrationAllowed', `must equal the derived permission ${allowed}`);
    return { errors, overallStatus, codeMigrationAllowed: errors.length === 0 && allowed };
}

function writeFileAtomic(filePath, content) {
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);
    try {
        fs.writeFileSync(temporaryPath, content, 'utf8');
        JSON.parse(fs.readFileSync(temporaryPath, 'utf8'));
        fs.renameSync(temporaryPath, filePath);
    } finally {
        if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
    }
}

function parseArguments(argv) {
    const languages = [];
    let output;
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--language') languages.push(requireOptionValue(argv, index++));
        else if (argument === '--output') output = requireOptionValue(argv, index++);
        else throw new Error(`Unexpected argument: ${argument}`);
    }
    if (languages.every((language) => language.trim().length === 0)) {
        throw new Error('Usage: check-sdk-compatibility.mjs --language <name> [--language <name>] [--output <path>]');
    }
    return { languages, output };
}

export function runCli(argv) {
    if (showHelp(argv, `
Usage: node check-sdk-compatibility.mjs --language <name> [--language <name>] [--output <path>]

Classify detected application languages against the bundled SDK matrix.
Discovery-owned evidence; lack of SDK support blocks code migration, not analytical phases.

  --language <name>  Required, repeatable for polyglot applications.
  --output <path>    Atomically write/replace the JSON report instead of printing it.
                    Path resolves from the current working directory.

Default is read-only with JSON on stdout. Does not inspect source code or install SDKs.
Exit: 0 when a report is produced, including unsupported languages; 1 on errors.
Read the compatibility result in the report before planning code migration.
`)) return 0;
    try {
        const { languages, output } = parseArguments(argv);
        const report = buildCompatibilityReport(languages);
        const content = `${JSON.stringify(report, null, 2)}\n`;
        if (output) writeFileAtomic(output, content);
        else process.stdout.write(content);
        return 0;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
