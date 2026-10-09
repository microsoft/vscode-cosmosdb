#!/usr/bin/env node
// Purpose: Generate and verify Cosmos DB provisioning artifacts from a migration model.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { readIdentityManifest } from './identity-mapping.mjs';
import { canonicalizeCosmosModel, validateCosmosModel } from './validate-cosmos-model.mjs';
import { validateSampleData } from './validate-sample-data.mjs';
import { readSourceInventory } from './validate-source-evidence.mjs';

const DATA_CONTRIBUTOR_ROLE_ID = '00000000-0000-0000-0000-000000000002';

function escapeBicep(value) {
    return value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'").replace(/\r/gu, '\\r').replace(/\n/gu, '\\n');
}

function escapeShell(value) {
    return /^[a-zA-Z0-9_.-]+$/u.test(value) ? value : `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

function emitIndexingPolicy(lines, policy, indent) {
    lines.push(`${indent}indexingPolicy: {`);
    lines.push(`${indent}  indexingMode: '${escapeBicep(policy.indexingMode ?? 'consistent')}'`);
    lines.push(`${indent}  automatic: ${policy.automatic ?? true}`);
    for (const collectionName of ['includedPaths', 'excludedPaths', 'fullTextIndexes']) {
        if (collectionName === 'fullTextIndexes' && !policy.fullTextIndexes?.length) continue;
        lines.push(`${indent}  ${collectionName}: [`);
        for (const entry of policy[collectionName] ?? []) {
            lines.push(`${indent}    {`);
            lines.push(`${indent}      path: '${escapeBicep(entry.path)}'`);
            lines.push(`${indent}    }`);
        }
        lines.push(`${indent}  ]`);
    }
    if (policy.compositeIndexes?.length) {
        lines.push(`${indent}  compositeIndexes: [`);
        for (const group of policy.compositeIndexes) {
            lines.push(`${indent}    [`);
            for (const entry of group) {
                lines.push(`${indent}      {`);
                lines.push(`${indent}        path: '${escapeBicep(entry.path)}'`);
                lines.push(`${indent}        order: '${escapeBicep(entry.order)}'`);
                lines.push(`${indent}      }`);
            }
            lines.push(`${indent}    ]`);
        }
        lines.push(`${indent}  ]`);
    }
    lines.push(`${indent}}`);
}

function isNewAccountTarget(targetEnvironment) {
    return targetEnvironment?.type === 'provision' && !targetEnvironment.endpoint;
}

export function buildBicep(model, targetEnvironment) {
    const createAccount = isNewAccountTarget(targetEnvironment);
    const bicepTarget = targetEnvironment?.type === 'emulator' ? undefined : targetEnvironment;
    const capacityMode = bicepTarget?.capacityMode ?? model.capacityMode;
    const lines = [
        '// Generated from the canonical Cosmos DB migration model. Do not edit by hand.',
        "targetScope = 'resourceGroup'",
        '',
        'param accountName string',
        ...(createAccount ? ['param location string = resourceGroup().location'] : []),
        `param databaseName string = '${escapeBicep(model.databaseName)}'`,
        ...(createAccount ? ['param principalId string = deployer().objectId'] : []),
        '',
        `resource account 'Microsoft.DocumentDB/databaseAccounts@2024-05-15'${createAccount ? '' : ' existing'} = {`,
        '  name: accountName',
    ];
    if (createAccount) lines.push(
        '  location: location',
        "  kind: 'GlobalDocumentDB'",
        '  properties: {',
        "    databaseAccountOfferType: 'Standard'",
        '    disableLocalAuth: true',
        '    locations: [',
        '      {',
        '        locationName: location',
        '        failoverPriority: 0',
        '        isZoneRedundant: false',
        '      }',
        '    ]',
        ...(capacityMode === 'serverless'
            ? ['    capabilities: [', '      {', "        name: 'EnableServerless'", '      }', '    ]']
            : ['    capabilities: []']),
        '  }',
    );
    lines.push(
        '}',
        '',
        "resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {",
        '  parent: account',
        '  name: databaseName',
        '  properties: {',
        '    resource: {',
        '      id: databaseName',
        '    }',
        '  }',
        '}',
        '',
    );

    for (const [index, container] of model.containers.entries()) {
        const paths = container.partitionKeys.map((partitionKey) => partitionKey.path);
        const capacity = getProvisioningCapacity(model, container, bicepTarget);
        lines.push(
            `resource container_${index} 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-10-15' = {`,
            '  parent: database',
            `  name: '${escapeBicep(container.name)}'`,
            '  properties: {',
            '    resource: {',
            `      id: '${escapeBicep(container.name)}'`,
            '      partitionKey: {',
            `        paths: [${paths.map((partitionPath) => `'${escapeBicep(partitionPath)}'`).join(', ')}]`,
            `        kind: '${paths.length > 1 ? 'MultiHash' : 'Hash'}'`,
            '        version: 2',
            '      }',
        );
        if (container.fullTextPolicy) {
            lines.push('      fullTextPolicy: {');
            lines.push(`        defaultLanguage: '${escapeBicep(container.fullTextPolicy.defaultLanguage)}'`);
            lines.push('        fullTextPaths: [');
            for (const entry of container.fullTextPolicy.fullTextPaths) {
                lines.push('          {');
                lines.push(`            path: '${escapeBicep(entry.path)}'`);
                if (entry.language !== undefined) {
                    lines.push(`            language: '${escapeBicep(entry.language)}'`);
                }
                lines.push('          }');
            }
            lines.push('        ]', '      }');
        }
        if (container.uniqueKeyPolicy) {
            lines.push('      uniqueKeyPolicy: {', '        uniqueKeys: [');
            for (const key of container.uniqueKeyPolicy.uniqueKeys) {
                lines.push('          {');
                lines.push(`            paths: [${key.paths.map(uniquePath => `'${escapeBicep(uniquePath)}'`).join(', ')}]`);
                lines.push('          }');
            }
            lines.push('        ]', '      }');
        }
        emitIndexingPolicy(lines, container.indexingPolicy, '      ');
        lines.push('    }');
        if (capacity.capacityMode === 'provisioned') {
            lines.push('    options: {', '      autoscaleSettings: {');
            lines.push(`        maxThroughput: ${capacity.maxThroughput}`);
            lines.push('      }', '    }');
        } else {
            lines.push('    options: {}');
        }
        lines.push('  }', '}', '');
    }

    if (createAccount) lines.push(
        `var dataContributorRoleDefinitionId = resourceId('Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions', accountName, '${DATA_CONTRIBUTOR_ROLE_ID}')`,
        "resource dataContributorAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {",
        '  parent: account',
        '  name: guid(account.id, principalId, dataContributorRoleDefinitionId)',
        '  properties: {',
        '    principalId: principalId',
        '    roleDefinitionId: dataContributorRoleDefinitionId',
        '    scope: account.id',
        '  }',
        '}',
        '',
    );
    lines.push(
        'output accountEndpoint string = account.properties.documentEndpoint',
        'output databaseName string = database.name',
        '',
    );
    return lines.join('\n');
}

function accountNameFromTarget(target) {
    if (target?.accountName) return target.accountName;
    try {
        return target?.endpoint ? new URL(target.endpoint).hostname.split('.')[0] : undefined;
    } catch {
        return undefined;
    }
}

export function buildBicepParams(model, project) {
    const target = project.phases?.targetEnvironment;
    const accountName = accountNameFromTarget(target);
    const lines = ["using './main.bicep'", ''];
    lines.push(accountName ? `param accountName = '${escapeBicep(accountName)}'` : "// TODO: param accountName = '<value>'");
    if (isNewAccountTarget(target) && target.location) lines.push(`param location = '${escapeBicep(target.location)}'`);
    lines.push(`param databaseName = '${escapeBicep(model.databaseName)}'`, '');
    return lines.join('\n');
}

export function getProvisioningCapacity(model, container, targetEnvironment) {
    const emulator = targetEnvironment?.type === 'emulator';
    const capacityMode = targetEnvironment?.capacityMode ?? (emulator ? 'provisioned' : model.capacityMode);
    if (!['serverless', 'provisioned'].includes(capacityMode)) throw new Error('Target capacityMode must be serverless or provisioned.');
    if (model.capacityMode === 'provisioned' && capacityMode === 'serverless' && !emulator) {
        throw new Error('A serverless Azure account cannot satisfy a provisioned-capacity model. Select or create a provisioned account.');
    }
    if (capacityMode === 'serverless') return { capacityMode };
    const maxThroughput = model.capacityMode === 'provisioned'
        ? container.maxThroughput
        : targetEnvironment?.maxThroughput ?? (emulator ? 1000 : undefined);
    if (!Number.isInteger(maxThroughput) || maxThroughput < 1000 || maxThroughput % 1000 !== 0) {
        throw new Error('Select an autoscale maximum for the provisioned target: a multiple of 1000 RU/s, at least 1000.');
    }
    return { capacityMode, maxThroughput };
}

export function buildSeedScript(model, targetEnvironment) {
    const databaseName = escapeShell(model.databaseName);
    const seedOnly = targetEnvironment?.type !== 'emulator' || model.containers.some((container) =>
        container.fullTextPolicy !== undefined || container.uniqueKeyPolicy !== undefined);
    let connection = 'connect $1';
    if (
        ['azure', 'provision'].includes(targetEnvironment?.type) &&
        targetEnvironment.subscriptionId && targetEnvironment.resourceGroup
    ) {
        connection += ` --subscription=${escapeShell(targetEnvironment.subscriptionId)}`;
        connection += ` --resource-group=${escapeShell(targetEnvironment.resourceGroup)}`;
    }
    const lines = [
        '# Generated from the canonical Cosmos DB migration model. Do not embed credentials.',
        '# Usage: cosmosdbshell -c \'seed-data.csh "<connection>" "sample-data.json"\'',
        '# Check Shell capabilities with generate-provisioning-artifacts.mjs --check-shell <executable> before running.',
        ...(seedOnly
            ? [
                  '# Seed-only: provision and verify containers via main.bicep or a supported SDK before this script.',
              ]
            : []),
        connection,
        ...(seedOnly ? [] : [`create database ${databaseName}`]),
        '',
    ];
    for (const container of seedOnly ? [] : model.containers) {
        const containerName = escapeShell(container.name);
        const partitionKeys = container.partitionKeys.map((partitionKey) => partitionKey.path).join(',');
        const indexPolicy = `'${JSON.stringify(container.indexingPolicy).replace(/'/gu, "''")}'`;
        const scope = `--database=${databaseName} --container=${containerName}`;
        const capacity = getProvisioningCapacity(model, container, targetEnvironment);
        let command = `create container ${containerName} ${partitionKeys} --database=${databaseName}`;
        command += ` --index_policy=${indexPolicy}`;
        if (capacity.capacityMode === 'provisioned') command += ` --scale=auto --ru=${capacity.maxThroughput}`;
        lines.push(command);
        lines.push(`index set ${indexPolicy} ${scope}`);
        if (capacity.capacityMode === 'provisioned') {
            lines.push(`throughput autoscale ${capacity.maxThroughput} ${scope} --yes`);
        }
    }
    lines.push(
        '',
        '$data = (cat $2)',
        'for $entry in $data.sampleData {',
        `    echo $entry.items | mkitem --database=${databaseName} --container=$entry.containerName --upsert`,
        '}',
        '',
    );
    return lines.join('\n');
}

export function checkSeedShell(executable, run = spawnSync) {
    const errors = [];
    const requiredOptions = {
        connect: ['subscription', 'resource-group'],
        create: ['scale', 'ru', 'database', 'index_policy'],
        mkitem: ['upsert', 'database', 'container'],
        index: ['database', 'container'],
        throughput: ['database', 'container', 'yes'],
    };
    for (const [command, options] of Object.entries(requiredOptions)) {
        const result = run(executable, ['--output', 'json', '-c', `help ${command} --plain`], {
            encoding: 'utf8',
            timeout: 15_000,
            maxBuffer: 1024 * 1024,
        });
        if (result.error || result.status !== 0) {
            errors.push({ path: command, message: 'Cannot inspect Shell help; install a compatible Cosmos DB Shell and retry.' });
            break;
        }
        let help;
        try { help = JSON.parse(result.stdout); } catch { help = undefined; }
        if (help?.command !== command || !Array.isArray(help.options)) {
            errors.push({ path: command, message: 'Structured command help is unavailable; upgrade Cosmos DB Shell before running the seed script.' });
            break;
        }
        const optionNames = new Set(help.options.flatMap(option => Array.isArray(option?.names) ? option.names : []));
        for (const option of options) {
            if (!optionNames.has(option)) {
                errors.push({ path: `${command}.--${option}`, message: 'Required option is unavailable; upgrade Cosmos DB Shell before running the seed script.' });
            }
        }
        const subcommand = command === 'index' ? 'set' : command === 'throughput' ? 'autoscale' : undefined;
        if (subcommand && (!Array.isArray(help.parameters) || !help.parameters.some(parameter => parameter?.name === 'subcommand'))) {
            errors.push({ path: `${command}.${subcommand}`, message: 'Required subcommand is unavailable; upgrade Cosmos DB Shell before running the seed script.' });
        }
    }
    return errors;
}

export function buildProvisioningArtifacts(model, sampleData, project, identityManifest, sourceInventory) {
    const modelErrors = validateCosmosModel(model);
    if (modelErrors.length) throw new Error(`Invalid canonical model: ${JSON.stringify(modelErrors)}`);
    const sampleErrors = validateSampleData(model, sampleData, identityManifest, sourceInventory);
    if (sampleErrors.length) throw new Error(`Invalid sample data: ${JSON.stringify(sampleErrors)}`);
    if (!model.databaseName) throw new Error('The canonical model must define databaseName.');
    if (isNewAccountTarget(project.phases?.targetEnvironment)) {
        if (!accountNameFromTarget(project.phases.targetEnvironment)) throw new Error('Provision targets require accountName.');
        if (!project.phases.targetEnvironment.location) throw new Error('Provision targets require location.');
    }
    const canonicalModel = canonicalizeCosmosModel(model);
    return {
        'main.bicep': buildBicep(canonicalModel, project.phases?.targetEnvironment),
        'main.bicepparam': buildBicepParams(canonicalModel, project),
        'seed-data.csh': buildSeedScript(canonicalModel, project.phases?.targetEnvironment),
    };
}

function writeAtomic(filePath, content, force) {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') !== content && !force) {
        throw new Error(`Refusing to overwrite modified artifact without --force: ${filePath}`);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
    try {
        fs.writeFileSync(temporaryPath, content, 'utf8');
        fs.renameSync(temporaryPath, filePath);
    } finally {
        if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
    }
}

export function validateProvisioningArtifacts(
    artifacts,
    model,
    sampleData,
    project,
    identityManifest,
    sourceInventory,
) {
    let expected;
    try {
        expected = buildProvisioningArtifacts(model, sampleData, project, identityManifest, sourceInventory);
    } catch (error) {
        return [{ path: '$', message: error.message }];
    }
    return Object.entries(expected).flatMap(([name, content]) =>
        artifacts[name] === content ? [] : [{ path: `$.${name}`, message: 'does not match deterministic generation' }],
    );
}

function parseArguments(argv) {
    const result = { force: false, check: false };
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--model') result.modelPath = path.resolve(requireOptionValue(argv, index++));
        else if (argument === '--sample-data') result.sampleDataPath = path.resolve(requireOptionValue(argv, index++));
        else if (argument === '--project') result.projectPath = path.resolve(requireOptionValue(argv, index++));
        else if (argument === '--output') result.outputPath = path.resolve(requireOptionValue(argv, index++));
        else if (argument === '--force') result.force = true;
        else if (argument === '--check') result.check = true;
        else throw new Error(`Unexpected argument: ${argument}`);
    }
    if (!result.modelPath || !result.sampleDataPath || !result.projectPath || !result.outputPath) {
        throw new Error(
            'Usage: generate-provisioning-artifacts.mjs --model <model.json> --sample-data <sample-data.json> --project <project.json> --output <directory> [--check] [--force]',
        );
    }
    return result;
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node generate-provisioning-artifacts.mjs --model <model.json> --sample-data <sample-data.json> --project <project.json> --output <directory> [--check | --force]
             node generate-provisioning-artifacts.mjs --check-shell <executable>

Generate deterministic local provisioning files. Does not deploy or seed resources.
Paths resolve from the current working directory. All four paths are required for generation.

    --model <path>        Canonical model; also reads its sibling manifest.json for identity.
    --sample-data <path>  Sample documents to validate and seed.
    --project <path>      .cosmosdb-migration/project.json; workspace inferred from its parent.
    --output <directory>  Destination for generated files; existing differing files are protected.
    --check               Compare existing files with expected content; no writes.
    --force               Replace differing generated files; use only for authorized regeneration.
    --check-shell <exe>   Separate mode: execute a local Shell compatibility probe; no other options.

Outputs JSON with written filenames or validation results.
Exit: 0 on success; 1 for invalid input, mismatches, protected files, or probe failures.
`)) return 0;
    try {
        if (argv[0] === '--check-shell') {
            const executable = requireOptionValue(argv, 0);
            if (argv.length !== 2) throw new Error('Usage: generate-provisioning-artifacts.mjs --check-shell <executable>');
            const errors = checkSeedShell(executable);
            process.stdout.write(`${JSON.stringify({ valid: errors.length === 0, errors }, null, 2)}\n`);
            return errors.length === 0 ? 0 : 1;
        }
        const options = parseArguments(argv);
        const model = JSON.parse(fs.readFileSync(options.modelPath, 'utf8'));
        const sampleData = JSON.parse(fs.readFileSync(options.sampleDataPath, 'utf8'));
        const project = JSON.parse(fs.readFileSync(options.projectPath, 'utf8'));
        const identityManifest = readIdentityManifest(options.modelPath);
        const workspace = path.dirname(path.dirname(options.projectPath));
        const sourceInventory = readSourceInventory(workspace, project);
        const expected = buildProvisioningArtifacts(
            model,
            sampleData,
            project,
            identityManifest,
            sourceInventory,
        );
        if (options.check) {
            const current = Object.fromEntries(
                Object.keys(expected).map((name) => [name, fs.readFileSync(path.join(options.outputPath, name), 'utf8')]),
            );
            const errors = validateProvisioningArtifacts(
                current,
                model,
                sampleData,
                project,
                identityManifest,
                sourceInventory,
            );
            process.stdout.write(`${JSON.stringify({ valid: errors.length === 0, errors }, null, 2)}\n`);
            return errors.length === 0 ? 0 : 1;
        }
        for (const [name, content] of Object.entries(expected)) {
            writeAtomic(path.join(options.outputPath, name), content, options.force);
        }
        process.stdout.write(`${JSON.stringify({ written: Object.keys(expected) }, null, 2)}\n`);
        return 0;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
