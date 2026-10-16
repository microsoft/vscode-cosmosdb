#!/usr/bin/env node
// Purpose: Validate evidence that provisioned resources match the migration model.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { getProvisioningCapacity } from './generate-provisioning-artifacts.mjs';
import { readIdentityManifest } from './identity-mapping.mjs';
import { readPhaseEvidence } from './phase-summary.mjs';
import {
    canonicalStringify,
    canonicalUniqueKeyPolicy,
    canonicalizeCosmosModel,
    checkUniqueKeyPolicy,
    validateCosmosModel,
} from './validate-cosmos-model.mjs';
import { validateSampleData } from './validate-sample-data.mjs';
import { readSourceInventory } from './validate-source-evidence.mjs';

const ROOT_KEYS = new Set([
    'version',
    'verifiedAt',
    'modelSha256',
    'target',
    'databaseName',
    'containers',
    'sampleItems',
    'failures',
]);
const TARGET_KEYS = new Set(['type', 'accountName', 'endpoint']);
const CONTAINER_KEYS = new Set([
    'name',
    'partitionKeys',
    'indexingPolicy',
    'fullTextPolicy',
    'uniqueKeyPolicy',
    'capacityMode',
    'maxThroughput',
]);
const SAMPLE_KEYS = new Set(['containerName', 'id', 'partitionKeyValues', 'found', 'document']);
const SYSTEM_PROPERTIES = new Set(['_rid', '_self', '_etag', '_attachments', '_ts', '_lsn']);
const FAILURE_KEYS = new Set(['operation', 'resource', 'code']);
const TARGET_TYPES = new Set(['emulator', 'azure', 'provision']);

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, jsonPath, message) {
    errors.push({ path: jsonPath, message });
}

function checkObject(value, jsonPath, allowedKeys, errors) {
    if (!isObject(value)) {
        addError(errors, jsonPath, 'must be an object');
        return false;
    }
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) addError(errors, `${jsonPath}.${key}`, 'is not allowed');
    }
    return true;
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function equal(left, right) {
    return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function endpointOrigin(value, targetType) {
    if (typeof value !== 'string' || !value.trim()) throw new Error();
    const endpoint = new URL(value);
    if (
        !(endpoint.protocol === 'https:' || (targetType === 'emulator' && endpoint.protocol === 'http:')) ||
        endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/'
    ) throw new Error();
    return endpoint.origin;
}

function documentContent(document) {
    return Object.fromEntries(Object.entries(document).filter(([name]) => !SYSTEM_PROPERTIES.has(name)));
}

export function modelSha256(model) {
    return createHash('sha256').update(canonicalStringify(canonicalizeCosmosModel(model))).digest('hex');
}

function expectedContainers(model, targetEnvironment) {
    return canonicalizeCosmosModel(model).containers.map((container) => ({
        name: container.name,
        partitionKeys: container.partitionKeys.map((partitionKey) => partitionKey.path),
        indexingPolicy: {
            ...container.indexingPolicy,
            indexingMode: container.indexingPolicy.indexingMode ?? 'consistent',
            automatic: container.indexingPolicy.automatic ?? true,
        },
        ...(container.fullTextPolicy === undefined ? {} : { fullTextPolicy: container.fullTextPolicy }),
        ...(container.uniqueKeyPolicy === undefined ? {} : { uniqueKeyPolicy: container.uniqueKeyPolicy }),
        ...getProvisioningCapacity(model, container, targetEnvironment),
    }));
}

function sortContainers(containers) {
    return [...containers].sort((left, right) => String(left?.name).localeCompare(String(right?.name)));
}

function sortSampleItems(items) {
    return [...items].sort((left, right) =>
        JSON.stringify([left?.containerName, left?.id, left?.partitionKeyValues]).localeCompare(
            JSON.stringify([right?.containerName, right?.id, right?.partitionKeyValues]),
        ),
    );
}

function expectedSampleKeys(model, sampleData) {
    const containers = new Map(model.containers.map((container) => [container.name, container]));
    return sampleData.sampleData.flatMap((entry) => {
        const container = containers.get(entry.containerName);
        if (!container) return [];
        return entry.items.map((item) => ({
            containerName: entry.containerName,
            id: item.id,
            partitionKeyValues: container.partitionKeys.map((partitionKey) => item[partitionKey.path.slice(1)]),
            found: true,
        }));
    });
}

export function validateProvisioningVerification(
    model,
    sampleData,
    project,
    report,
    identityManifest,
    sourceInventory,
) {
    const modelErrors = validateCosmosModel(model).map((error) => ({
        path: `$.model${error.path.slice(1)}`,
        message: error.message,
    }));
    const sampleErrors = validateSampleData(model, sampleData, identityManifest, sourceInventory).map((error) => ({
        path: `$.sampleData${error.path.slice(1)}`,
        message: error.message,
    }));
    const errors = [...modelErrors, ...sampleErrors];
    if (errors.length > 0) return errors;
    if (!checkObject(report, '$', ROOT_KEYS, errors)) return errors;
    if (report.version !== 1) addError(errors, '$.version', 'must equal 1');
    if (typeof report.verifiedAt !== 'string' || !Number.isFinite(Date.parse(report.verifiedAt))) {
        addError(errors, '$.verifiedAt', 'must be an ISO date-time string');
    }
    if (report.modelSha256 !== modelSha256(model)) addError(errors, '$.modelSha256', 'does not match canonical model');
    if (report.databaseName !== model.databaseName) addError(errors, '$.databaseName', 'does not match canonical model');

    if (checkObject(report.target, '$.target', TARGET_KEYS, errors)) {
        const expectedTarget = project.phases?.targetEnvironment;
        if (!TARGET_TYPES.has(report.target.type) || report.target.type !== expectedTarget?.type) {
            addError(errors, '$.target.type', 'does not match the configured target type');
        }
        if (expectedTarget?.accountName !== undefined && report.target.accountName !== expectedTarget.accountName) {
            addError(errors, '$.target.accountName', 'does not match the configured account');
        }
        let expectedEndpoint;
        try {
            expectedEndpoint = endpointOrigin(expectedTarget?.endpoint, expectedTarget?.type);
        } catch {
            addError(errors, '$.project.phases.targetEnvironment.endpoint', 'resolve and persist the target service endpoint before verification; it must not contain credentials, a path, query, or fragment');
        }
        try {
            const observedEndpoint = endpointOrigin(report.target.endpoint, report.target.type);
            if (expectedEndpoint !== undefined && observedEndpoint !== expectedEndpoint) {
                addError(errors, '$.target.endpoint', 'does not match the configured target endpoint');
            }
        } catch {
            addError(errors, '$.target.endpoint', 'must record the service endpoint used for readback, without credentials, a path, query, or fragment');
        }
    }

    if (!Array.isArray(report.containers)) {
        addError(errors, '$.containers', 'must be an array');
    } else {
        const observed = report.containers.map((container, index) => {
            const containerPath = `$.containers[${index}]`;
            if (!checkObject(container, containerPath, CONTAINER_KEYS, errors)) return container;
            if (container.uniqueKeyPolicy === undefined) return container;
            const normalized = { ...container };
            if (equal(container.uniqueKeyPolicy, { uniqueKeys: [] })) {
                delete normalized.uniqueKeyPolicy;
            } else {
                const policyErrors = [];
                checkUniqueKeyPolicy(container.uniqueKeyPolicy, `${containerPath}.uniqueKeyPolicy`, policyErrors);
                errors.push(...policyErrors);
                if (policyErrors.length === 0) normalized.uniqueKeyPolicy = canonicalUniqueKeyPolicy(container.uniqueKeyPolicy);
            }
            return normalized;
        });
        try {
            const expected = expectedContainers(model, project.phases?.targetEnvironment);
            if (!equal(sortContainers(observed), sortContainers(expected))) {
                addError(errors, '$.containers', 'does not match the model and effective target configuration');
            }
        } catch (error) {
            addError(errors, '$.project.phases.targetEnvironment', error.message);
        }
    }

    if (!Array.isArray(report.sampleItems)) {
        addError(errors, '$.sampleItems', 'must be an array');
    } else {
        const expectedKeys = expectedSampleKeys(model, sampleData);
        const expectedDocuments = sampleData.sampleData.flatMap(entry => entry.items);
        report.sampleItems.forEach((sample, index) => {
            if (!checkObject(sample, `$.sampleItems[${index}]`, SAMPLE_KEYS, errors)) return;
            if (sample.found !== true) addError(errors, `$.sampleItems[${index}].found`, 'must be true');
            if (!isObject(sample.document)) {
                addError(errors, `$.sampleItems[${index}].document`, 'must contain the document returned by the point read');
                return;
            }
            const expectedIndex = expectedKeys.findIndex(expected =>
                expected.containerName === sample.containerName && expected.id === sample.id &&
                equal(expected.partitionKeyValues, sample.partitionKeyValues)
            );
            if (expectedIndex >= 0 && !equal(documentContent(sample.document), documentContent(expectedDocuments[expectedIndex]))) {
                addError(errors, `$.sampleItems[${index}].document`, 'does not match the expected sample content');
            }
        });
        const observedKeys = report.sampleItems.map(sample => ({
            containerName: sample?.containerName, id: sample?.id,
            partitionKeyValues: sample?.partitionKeyValues, found: sample?.found,
        }));
        if (!equal(sortSampleItems(observedKeys), sortSampleItems(expectedKeys))) {
            addError(errors, '$.sampleItems', 'must contain point-read evidence for every sample key');
        }
    }

    if (!Array.isArray(report.failures)) {
        addError(errors, '$.failures', 'must be an array');
    } else {
        report.failures.forEach((failure, index) =>
            checkObject(failure, `$.failures[${index}]`, FAILURE_KEYS, errors),
        );
        if (report.failures.length > 0) addError(errors, '$.failures', 'must be empty for completion');
    }
    return errors;
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node validate-provisioning-verification.mjs --model <model.json> --sample-data <sample-data.json> --project <project.json> <manifest.json>

Read-only validation of recorded provisioning verification. Does not query live resources.
All four paths are required and resolve from the current working directory.
Requires the readback endpoint and returned sample documents.

    --model <path>        Canonical model; reads sibling manifest.json for identity mappings.
    --sample-data <path>  Sample documents against which verification is checked.
    --project <path>      .cosmosdb-migration/project.json; used to infer workspace/source inventory.
    <manifest.json>      Provisioning manifest with verification; positional, not --manifest.

Outputs JSON {valid, errors}. Exit: 0 when valid; 1 for invalid/missing evidence or I/O errors.
`)) return 0;
    try {
        const options = {};
        for (let index = 0; index < argv.length; index++) {
            const argument = argv[index];
            if (argument === '--model') options.modelPath = path.resolve(requireOptionValue(argv, index++));
            else if (argument === '--sample-data') options.sampleDataPath = path.resolve(requireOptionValue(argv, index++));
            else if (argument === '--project') options.projectPath = path.resolve(requireOptionValue(argv, index++));
            else if (!options.reportPath) options.reportPath = path.resolve(argument);
            else throw new Error(`Unexpected argument: ${argument}`);
        }
        if (!options.modelPath || !options.sampleDataPath || !options.projectPath || !options.reportPath) {
            process.stderr.write(
                'Usage: validate-provisioning-verification.mjs --model <model.json> --sample-data <sample-data.json> --project <project.json> <manifest.json>\n',
            );
            return 1;
        }
        const model = JSON.parse(fs.readFileSync(options.modelPath, 'utf8'));
        const sampleData = JSON.parse(fs.readFileSync(options.sampleDataPath, 'utf8'));
        const project = JSON.parse(fs.readFileSync(options.projectPath, 'utf8'));
        const report = readPhaseEvidence(options.reportPath).verification;
        const workspace = path.dirname(path.dirname(options.projectPath));
        const errors = validateProvisioningVerification(
            model,
            sampleData,
            project,
            report,
            readIdentityManifest(options.modelPath),
            readSourceInventory(workspace, project),
        );
        process.stdout.write(`${JSON.stringify({ valid: errors.length === 0, errors }, null, 2)}\n`);
        return errors.length === 0 ? 0 : 1;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
