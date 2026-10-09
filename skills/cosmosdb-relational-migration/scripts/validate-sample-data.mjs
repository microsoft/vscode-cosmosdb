#!/usr/bin/env node
// Purpose: Validate migration sample data against the target model and identity rules.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { readIdentityManifest, resolveItemId, validateIdentityManifest } from './identity-mapping.mjs';
import { splitIndexPathParts, validateCosmosModel } from './validate-cosmos-model.mjs';
import { readSourceInventory, resolveForeignKey, resolveSource } from './validate-source-evidence.mjs';

const ROOT_KEYS = new Set(['sampleData']);
const ENTRY_KEYS = new Set(['containerName', 'items']);
const UNRESOLVED_VALUE = /(?:\{[^{}]+\}|<value>|\bTBD\b|\bREPLACE[_ -]?ME\b|\bTODO\b)/iu;
const MAX_ITEM_BYTES = 2 * 1024 * 1024;
const MAX_NESTING_DEPTH = 128;
const MAX_PARTITION_KEY_BYTES = 2048;

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

function matchesJsonType(value, type) {
    if (type === 'null') return value === null;
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return isObject(value);
    if (type === 'integer') return Number.isInteger(value);
    return typeof value === type && (type !== 'number' || Number.isFinite(value));
}

function scanValue(value, jsonPath, errors, depth = 1) {
    if ((Array.isArray(value) || isObject(value)) && depth > MAX_NESTING_DEPTH) {
        addError(errors, jsonPath, `exceeds the ${MAX_NESTING_DEPTH}-level object/array nesting limit`);
        return false;
    }
    if (typeof value === 'string' && UNRESOLVED_VALUE.test(value)) {
        addError(errors, jsonPath, 'contains an unresolved placeholder');
    }
    let withinDepthLimit = true;
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            if (!scanValue(item, `${jsonPath}[${index}]`, errors, depth + 1)) withinDepthLimit = false;
        });
    } else if (isObject(value)) {
        for (const [key, child] of Object.entries(value)) {
            if (!scanValue(child, `${jsonPath}.${key}`, errors, depth + 1)) withinDepthLimit = false;
        }
    }
    return withinDepthLimit;
}

function validateId(item, entity, jsonPath, errors, mapping) {
    if (typeof item.id !== 'string' || item.id.length === 0) {
        addError(errors, `${jsonPath}.id`, 'must be a non-empty string');
        return;
    }
    if (/[\/\\?#]/u.test(item.id) || /\s$/u.test(item.id)) {
        addError(errors, `${jsonPath}.id`, 'contains a forbidden ID character or trailing whitespace');
    }
    try {
        if (resolveItemId(entity, item, mapping) !== item.id) addError(errors, `${jsonPath}.id`, 'must equal idTemplate resolved using the selected identity mapping');
    } catch (error) {
        addError(errors, `${jsonPath}.id`, error.message);
    }
}

function attributeForSource(entity, table, column, inventory) {
    const matches = entity.attributes.filter(attribute =>
        attribute.isId !== true &&
        attribute.source.table !== '(generated)' &&
        resolveSource(attribute.source.table, inventory).name === table.name &&
        attribute.source.column === column,
    );
    if (matches.length !== 1) {
        throw new Error(`Entity ${entity.name} must map ${table.name}.${column} to exactly one natural-key field.`);
    }
    return matches[0];
}

function keyValues(entity, item, table, columns, inventory) {
    return columns.map(column => item[attributeForSource(entity, table, column, inventory).target]);
}

function sameValues(left, right) {
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

function relationshipEndpoints(owner, target, foreignKey, inventory) {
    const ownerTable = resolveSource(owner.sourceTable, inventory);
    const targetTable = resolveSource(target.sourceTable, inventory);
    const sourceEntity = foreignKey.table.name === ownerTable.name
        ? owner
        : foreignKey.table.name === targetTable.name
          ? target
          : undefined;
    const referencedEntity = foreignKey.referencedTable.name === ownerTable.name
        ? owner
        : foreignKey.referencedTable.name === targetTable.name
          ? target
          : undefined;
    if (!sourceEntity || !referencedEntity) {
        throw new Error(`Foreign-key endpoints do not match relationship ${owner.name} -> ${target.name}.`);
    }
    return { sourceEntity, referencedEntity };
}

function validateEmbeddedDocument(document, entity, jsonPath, errors) {
    if (!isObject(document)) {
        addError(errors, jsonPath, 'must be an embedded object');
        return false;
    }
    scanValue(document, jsonPath, errors);
    if (document.docType !== undefined && document.docType !== entity.docType) {
        addError(errors, `${jsonPath}.docType`, `must equal ${entity.docType} when present`);
    }
    for (const attribute of entity.attributes) {
        const attributePath = `${jsonPath}.${attribute.target}`;
        if (!Object.hasOwn(document, attribute.target)) {
            addError(errors, attributePath, 'is required by the embedded entity model');
        } else if (!matchesJsonType(document[attribute.target], attribute.type)) {
            addError(errors, attributePath, `must have JSON type ${attribute.type}`);
        }
    }
    return true;
}

function validateReferenceRelationship(
    relationship,
    owner,
    target,
    foreignKey,
    samplesByEntity,
    errors,
    inventory,
) {
    const { sourceEntity, referencedEntity } = relationshipEndpoints(owner, target, foreignKey, inventory);
    if (sourceEntity.isEmbeddedOnly === true || referencedEntity.isEmbeddedOnly === true) {
        throw new Error('Reference relationships require standalone source and target entities.');
    }
    const referencedSamples = samplesByEntity.get(referencedEntity.name) ?? [];
    for (const sample of samplesByEntity.get(sourceEntity.name) ?? []) {
        const sourceValues = keyValues(sourceEntity, sample.item, foreignKey.table, foreignKey.columns, inventory);
        const found = referencedSamples.some(candidate =>
            sameValues(
                sourceValues,
                keyValues(
                    referencedEntity,
                    candidate.item,
                    foreignKey.referencedTable,
                    foreignKey.referencedColumns,
                    inventory,
                ),
            ),
        );
        if (!found) {
            addError(
                errors,
                sample.path,
                `has no ${referencedEntity.docType} sample matching relationship ${owner.name} -> ${target.name}`,
            );
        }
    }
}

function validateEmbedRelationship(
    relationship,
    owner,
    target,
    foreignKey,
    samplesByEntity,
    errors,
    inventory,
) {
    const { sourceEntity, referencedEntity } = relationshipEndpoints(owner, target, foreignKey, inventory);
    let embeddedCount = 0;
    for (const sample of samplesByEntity.get(owner.name) ?? []) {
        if (!Object.hasOwn(sample.item, relationship.targetProperty)) continue;
        const propertyPath = `${sample.path}.${relationship.targetProperty}`;
        const value = sample.item[relationship.targetProperty];
        const documents = relationship.type === 'one-to-one' ? [value] : value;
        if (relationship.type !== 'one-to-one' && !Array.isArray(value)) {
            addError(errors, propertyPath, 'must be an array for a to-many embedded relationship');
            continue;
        }
        for (const [index, document] of documents.entries()) {
            const documentPath = relationship.type === 'one-to-one' ? propertyPath : `${propertyPath}[${index}]`;
            if (!validateEmbeddedDocument(document, target, documentPath, errors)) continue;
            embeddedCount++;
            const sourceDocument = sourceEntity === owner ? sample.item : document;
            const referencedDocument = referencedEntity === owner ? sample.item : document;
            const sourceValues = keyValues(
                sourceEntity,
                sourceDocument,
                foreignKey.table,
                foreignKey.columns,
                inventory,
            );
            const referencedValues = keyValues(
                referencedEntity,
                referencedDocument,
                foreignKey.referencedTable,
                foreignKey.referencedColumns,
                inventory,
            );
            if (!sameValues(sourceValues, referencedValues)) {
                addError(errors, documentPath, `does not match relationship ${owner.name} -> ${target.name}`);
            }
        }
    }
    if (embeddedCount === 0) {
        addError(
            errors,
            '$.sampleData',
            `must include embedded samples for ${owner.name}.${relationship.targetProperty}`,
        );
    }
}

function collectEmbeddedSamples(owner, sample, entities, samplesByEntity, ancestors = new Set(), depth = 1) {
    if (!isObject(sample.item) || ancestors.has(sample.item) || depth >= MAX_NESTING_DEPTH) return;
    const nextAncestors = new Set(ancestors).add(sample.item);
    for (const relationship of owner.relationships ?? []) {
        if (relationship.strategy !== 'embed') continue;
        const target = entities.get(relationship.targetEntity.toLocaleLowerCase('en-US'));
        if (!target) continue;
        const value = sample.item[relationship.targetProperty];
        const toOne = relationship.type === 'one-to-one';
        const documents = toOne ? [value] : Array.isArray(value) ? value : [];
        const childDepth = depth + (toOne ? 1 : 2);
        if (childDepth > MAX_NESTING_DEPTH) continue;
        for (const [index, document] of documents.entries()) {
            if (!isObject(document)) continue;
            const child = {
                item: document,
                path: `${sample.path}.${relationship.targetProperty}${toOne ? '' : `[${index}]`}`,
            };
            const samples = samplesByEntity.get(target.name) ?? [];
            samples.push(child);
            samplesByEntity.set(target.name, samples);
            collectEmbeddedSamples(target, child, entities, samplesByEntity, nextAncestors, childDepth);
        }
    }
}

function validateRelationships(model, samplesByEntity, errors, inventory) {
    const relationships = model.containers.flatMap(container =>
        container.entities.flatMap(owner =>
            (owner.relationships ?? []).map(relationship => ({ owner, relationship })),
        ),
    );
    if (!relationships.length) return;
    if (!inventory || inventory.errors?.length) {
        addError(errors, '$.sampleData', 'source inventory is required to validate modeled relationships');
        return;
    }
    const entities = new Map(
        model.containers.flatMap(container =>
            container.entities.map(entity => [entity.name.toLocaleLowerCase('en-US'), entity]),
        ),
    );
    const rootSamples = [...samplesByEntity].flatMap(([name, samples]) =>
        samples.map(sample => ({ owner: entities.get(name.toLocaleLowerCase('en-US')), sample })),
    );
    const allSamplesByEntity = new Map([...samplesByEntity].map(([name, samples]) => [name, [...samples]]));
    for (const { owner, sample } of rootSamples) {
        collectEmbeddedSamples(owner, sample, entities, allSamplesByEntity);
    }
    for (const { owner, relationship } of relationships) {
        try {
            const target = entities.get(relationship.targetEntity.toLocaleLowerCase('en-US'));
            const foreignKey = resolveForeignKey(relationship.sourceFK, inventory);
            if (relationship.strategy === 'reference') {
                validateReferenceRelationship(
                    relationship,
                    owner,
                    target,
                    foreignKey,
                    samplesByEntity,
                    errors,
                    inventory,
                );
            } else {
                validateEmbedRelationship(
                    relationship,
                    owner,
                    target,
                    foreignKey,
                    allSamplesByEntity,
                    errors,
                    inventory,
                );
            }
        } catch (error) {
            addError(errors, '$.sampleData', error.message);
        }
    }
}

function uniquePathValue(item, uniquePath) {
    let value = item;
    for (const segment of splitIndexPathParts(uniquePath.slice(1), '/')) {
        const property = segment.startsWith('"') ? JSON.parse(segment) : segment;
        value = isObject(value) && Object.hasOwn(value, property) ? value[property] : null;
    }
    return value ?? null;
}

function validateItem(item, container, entityByDocType, jsonPath, uniqueKeys, coverage, errors, manifest) {
    if (!isObject(item)) {
        addError(errors, jsonPath, 'must be an object');
        return;
    }
    const withinDepthLimit = scanValue(item, jsonPath, errors);
    if (typeof item.docType !== 'string') {
        addError(errors, `${jsonPath}.docType`, 'must be a string');
        return;
    }
    const entity = entityByDocType.get(item.docType);
    if (!entity) {
        addError(errors, `${jsonPath}.docType`, `does not identify a standalone entity in container ${container.name}`);
        return;
    }
    coverage.add(item.docType);
    if (!withinDepthLimit) return;

    try {
        const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
        if (itemBytes > MAX_ITEM_BYTES) {
            addError(errors, jsonPath, `exceeds the ${MAX_ITEM_BYTES}-byte item limit (${itemBytes} UTF-8 JSON bytes)`);
            return;
        }
    } catch {
        addError(errors, jsonPath, 'must be serializable JSON');
        return;
    }

    for (const attribute of entity.attributes) {
        const attributePath = `${jsonPath}.${attribute.target}`;
        if (!Object.hasOwn(item, attribute.target)) {
            addError(errors, attributePath, 'is required by the canonical model');
        } else if (!matchesJsonType(item[attribute.target], attribute.type)) {
            addError(errors, attributePath, `must have JSON type ${attribute.type}`);
        }
    }
    validateId(item, entity, jsonPath, errors, manifest?.mappings.find(mapping => mapping.containerName === container.name && mapping.docType === entity.docType));

    const partitionValues = [];
    for (const partitionKey of container.partitionKeys) {
        const target = partitionKey.path.slice(1);
        const value = item[target];
        if (!Object.hasOwn(item, target) || value === null || !['string', 'number', 'boolean'].includes(typeof value)) {
            addError(errors, `${jsonPath}.${target}`, `must provide a scalar value for partition key ${partitionKey.path}`);
        } else if (typeof value === 'string') {
            const byteLength = Buffer.byteLength(value, 'utf8');
            if (byteLength > MAX_PARTITION_KEY_BYTES) {
                addError(
                    errors,
                    `${jsonPath}.${target}`,
                    `exceeds the ${MAX_PARTITION_KEY_BYTES}-byte partition-key limit (${byteLength} UTF-8 bytes)`,
                );
            }
        }
        partitionValues.push(value);
    }
    if (typeof item.id === 'string') {
        const uniqueKey = JSON.stringify([partitionValues, item.id]);
        if (uniqueKeys.has(uniqueKey)) addError(errors, jsonPath, 'duplicates an id within the same logical partition');
        uniqueKeys.add(uniqueKey);
    }
    for (const [index, constraint] of (container.uniqueKeyPolicy?.uniqueKeys ?? []).entries()) {
        const values = constraint.paths.map(uniquePath => uniquePathValue(item, uniquePath));
        if (values.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) {
            addError(errors, jsonPath, `unique-key constraint ${index} must resolve to scalar or null values`);
            continue;
        }
        const uniqueKey = JSON.stringify([partitionValues, 'unique-key', index, values]);
        if (uniqueKeys.has(uniqueKey)) {
            addError(errors, jsonPath, `duplicates unique-key constraint ${index} within the same logical partition`);
        }
        uniqueKeys.add(uniqueKey);
    }
}

export function validateSampleData(model, sampleData, identityManifest, sourceInventory) {
    const errors = validateCosmosModel(model).map((error) => ({
        path: `$.model${error.path.slice(1)}`,
        message: error.message,
    }));
    if (errors.length > 0) return errors;
    errors.push(...validateIdentityManifest(model, identityManifest));
    if (errors.length > 0) return errors;
    if (!checkObject(sampleData, '$', ROOT_KEYS, errors)) return errors;
    if (!Array.isArray(sampleData.sampleData)) {
        addError(errors, '$.sampleData', 'must be an array');
        return errors;
    }

    const containers = Array.isArray(model?.containers) ? model.containers : [];
    const containerByName = new Map(containers.map((container) => [container.name, container]));
    const samplesByEntity = new Map();
    const seenContainers = new Set();
    for (const [entryIndex, entry] of sampleData.sampleData.entries()) {
        const entryPath = `$.sampleData[${entryIndex}]`;
        if (!checkObject(entry, entryPath, ENTRY_KEYS, errors)) continue;
        if (typeof entry.containerName !== 'string' || entry.containerName.length === 0) {
            addError(errors, `${entryPath}.containerName`, 'must be a non-empty string');
            continue;
        }
        if (seenContainers.has(entry.containerName)) {
            addError(errors, `${entryPath}.containerName`, `duplicates container ${entry.containerName}`);
            continue;
        }
        seenContainers.add(entry.containerName);
        const container = containerByName.get(entry.containerName);
        if (!container) {
            addError(errors, `${entryPath}.containerName`, `does not exist in the canonical model (${entry.containerName})`);
            continue;
        }
        if (!Array.isArray(entry.items) || entry.items.length === 0) {
            addError(errors, `${entryPath}.items`, 'must be a non-empty array');
            continue;
        }

        const standaloneEntities = container.entities.filter((entity) => entity.isEmbeddedOnly !== true);
        const entityByDocType = new Map(standaloneEntities.map((entity) => [entity.docType, entity]));
        const coverage = new Set();
        const uniqueKeys = new Set();
        entry.items.forEach((item, itemIndex) => {
            const itemPath = `${entryPath}.items[${itemIndex}]`;
            const entity = entityByDocType.get(item?.docType);
            if (entity) {
                const samples = samplesByEntity.get(entity.name) ?? [];
                samples.push({ item, path: itemPath });
                samplesByEntity.set(entity.name, samples);
            }
            validateItem(item, container, entityByDocType, itemPath, uniqueKeys, coverage, errors, identityManifest);
        });
        for (const entity of standaloneEntities) {
            if (!coverage.has(entity.docType)) {
                addError(errors, `${entryPath}.items`, `must include a sample for docType ${entity.docType}`);
            }
        }
    }

    for (const containerName of containerByName.keys()) {
        if (!seenContainers.has(containerName)) addError(errors, '$.sampleData', `missing container ${containerName}`);
    }
    validateRelationships(model, samplesByEntity, errors, sourceInventory);
    return errors;
}

export function runCli(argv) {
    if (showHelp(argv, `
Usage: node validate-sample-data.mjs --model <model.json> <sample-data.json> [--workspace <path>]

Read-only validation of sample documents, identities, and relationships.
File paths resolve from the current working directory, not from --workspace.

  --model <path>       Required canonical model; reads sibling manifest.json for identity mappings.
  <sample-data.json>  Required positional sample file (not --sample-data).
  --workspace <path>   Application root for source inventory. Supply in the migration workflow;
                      omit only for isolated model/sample checks without source evidence.

Outputs JSON {valid, errors}. Does not seed data or prove live provisioning.
Exit: 0 when valid; 1 for invalid samples, evidence, arguments, or I/O errors.
`)) return 0;
    try {
        let modelPath;
        let sampleDataPath;
        let workspace;
        for (let index = 0; index < argv.length; index++) {
            if (argv[index] === '--model') modelPath = path.resolve(requireOptionValue(argv, index++));
            else if (argv[index] === '--workspace') workspace = path.resolve(requireOptionValue(argv, index++));
            else if (!sampleDataPath) sampleDataPath = path.resolve(argv[index]);
            else throw new Error(`Unexpected argument: ${argv[index]}`);
        }
        if (!modelPath || !sampleDataPath) {
            process.stderr.write(
                'Usage: validate-sample-data.mjs [--workspace <path>] --model <model.json> <sample-data.json>\n',
            );
            return 1;
        }
        const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
        const sampleData = JSON.parse(fs.readFileSync(sampleDataPath, 'utf8'));
        const project = workspace
            ? JSON.parse(fs.readFileSync(path.join(workspace, '.cosmosdb-migration', 'project.json'), 'utf8'))
            : undefined;
        const sourceInventory = project ? readSourceInventory(workspace, project) : undefined;
        const errors = validateSampleData(model, sampleData, readIdentityManifest(modelPath), sourceInventory);
        process.stdout.write(`${JSON.stringify({ valid: errors.length === 0, errors }, null, 2)}\n`);
        return errors.length === 0 ? 0 : 1;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
