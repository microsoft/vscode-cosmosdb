#!/usr/bin/env node
// Purpose: Select and order source domains that require schema conversion.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { showHelp } from './cli-help.mjs';
import { validateMigrationProject } from './validate-migration-project.mjs';

function compareNames(left, right) {
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

export function selectSchemaConversionDomains(project, includeUnmappedDomains = false) {
    const projectErrors = validateMigrationProject(project);
    if (projectErrors.length > 0) {
        throw new Error(`Invalid migration project: ${JSON.stringify(projectErrors)}`);
    }

    const domains = project.phases.assessment?.domains;
    if (!Array.isArray(domains) || domains.length === 0) {
        throw new Error('No assessed domains are available for schema conversion.');
    }

    const names = new Set();
    for (const domain of domains) {
        const normalizedName = domain.name.toLowerCase();
        if (names.has(normalizedName)) throw new Error(`Assessment domain name is duplicated: ${domain.name}`);
        names.add(normalizedName);
    }

    const selectedDomains = domains
        .filter((domain) => includeUnmappedDomains || domain.isMapped)
        .map(({ name, tables }) => ({ name, tables: [...tables].sort() }))
        .sort(compareNames);
    const skippedDomains = domains
        .filter((domain) => !includeUnmappedDomains && !domain.isMapped)
        .map(({ name, tables }) => ({ name, tables: [...tables].sort(), reason: 'no detected application mapping' }))
        .sort(compareNames);

    if (selectedDomains.length === 0) {
        throw new Error(
            'No mapped domains qualify for schema conversion. Rerun with --include-unmapped-domains to convert all assessed domains.',
        );
    }

    return { includeUnmappedDomains, selectedDomains, skippedDomains };
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node select-schema-conversion-domains.mjs <project.json> [--include-unmapped-domains]

Validate project state and select assessed domains for schema conversion. Read-only.
The project path resolves from the current working directory.

    --include-unmapped-domains  Include all assessed domains; default selects mapped domains only.

Outputs JSON with selectedDomains and skippedDomains in deterministic name order.
Exit: 0 on success; 1 for invalid project state, missing assessment, or no qualifying domains.
`)) return 0;
    const includeUnmappedDomains = argv.includes('--include-unmapped-domains');
    const positional = argv.filter((argument) => argument !== '--include-unmapped-domains');
    if (positional.length !== 1) {
        process.stderr.write(
            'Usage: select-schema-conversion-domains.mjs <project.json> [--include-unmapped-domains]\n',
        );
        return 1;
    }

    try {
        const project = JSON.parse(fs.readFileSync(path.resolve(positional[0]), 'utf8'));
        process.stdout.write(`${JSON.stringify(selectSchemaConversionDomains(project, includeUnmappedDomains), null, 2)}\n`);
        return 0;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
