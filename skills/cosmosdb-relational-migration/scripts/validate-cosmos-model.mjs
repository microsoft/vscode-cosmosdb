#!/usr/bin/env node
// Purpose: Validate and canonicalize generated Cosmos DB migration models.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { readDomainModel, readPhaseEvidence } from './phase-summary.mjs';

const ROOT_KEYS = new Set([
    'version',
    'databaseName',
    'capacityMode',
    'domain',
    'sourceType',
    'containers',
    'accessPatterns',
    'crossPartitionQueries',
]);
const CONTAINER_KEYS = new Set([
    'name',
    'partitionKeys',
    'entities',
    'indexingPolicy',
    'fullTextPolicy',
    'uniqueKeyPolicy',
    'maxThroughput',
    'estimatedStorageGB',
    'estimatedRowCount',
]);
const ENTITY_KEYS = new Set([
    'name',
    'docType',
    'sourceTable',
    'attributes',
    'relationships',
    'isEmbeddedOnly',
    'idTemplate',
]);
const ATTRIBUTE_KEYS = new Set(['target', 'source', 'type', 'isPartitionKey', 'isId']);
const RELATIONSHIP_KEYS = new Set([
    'targetEntity',
    'sourceFK',
    'type',
    'strategy',
    'targetProperty',
    'score',
    'rationale',
]);
const SOURCE_KEYS = new Set(['table', 'column', 'type']);
const INDEX_POLICY_KEYS = new Set([
    'indexingMode',
    'automatic',
    'includedPaths',
    'excludedPaths',
    'compositeIndexes',
    'fullTextIndexes',
]);
const RELATIONSHIP_TYPES = new Set(['one-to-one', 'one-to-many', 'many-to-many']);
const RELATIONSHIP_STRATEGIES = new Set(['embed', 'reference']);
const CAPACITY_MODES = new Set(['serverless', 'provisioned']);
const INDEX_ORDERS = new Set(['ascending', 'descending']);
const GUID_SOURCE_TYPES = new Set(['guid', 'uniqueidentifier', 'uuid']);
export const TARGET_JSON_TYPES = Object.freeze(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
        if (!allowedKeys.has(key)) addError(errors, `${jsonPath}.${key}`, 'is not a supported property');
    }
    return true;
}

function checkString(value, jsonPath, errors, { optional = false } = {}) {
    if (optional && value === undefined) return true;
    if (typeof value !== 'string' || value.trim().length === 0) {
        addError(errors, jsonPath, 'must be a non-empty string');
        return false;
    }
    return true;
}

function checkArray(value, jsonPath, errors, { optional = false, min = 0, max } = {}) {
    if (optional && value === undefined) return true;
    if (!Array.isArray(value)) {
        addError(errors, jsonPath, 'must be an array');
        return false;
    }
    if (value.length < min) addError(errors, jsonPath, `must contain at least ${min} item(s)`);
    if (max !== undefined && value.length > max) addError(errors, jsonPath, `must contain at most ${max} item(s)`);
    return true;
}

function checkUnique(values, jsonPath, label, errors, caseSensitive = false) {
    const seen = new Set();
    for (const [index, value] of values.entries()) {
        if (typeof value !== 'string') continue;
        const key = caseSensitive ? value : value.toLocaleLowerCase('en-US');
        if (seen.has(key)) addError(errors, `${jsonPath}[${index}]`, `duplicates ${label} "${value}"`);
        seen.add(key);
    }
}

function checkResourceName(value, jsonPath, errors) {
    if (!checkString(value, jsonPath, errors)) return;
    if (Buffer.byteLength(value, 'utf8') > 255) addError(errors, jsonPath, 'must be at most 255 UTF-8 bytes');
    if (/[\/\\?#]/u.test(value) || value.endsWith(' ')) {
        addError(errors, jsonPath, 'contains a forbidden resource-name character or trailing space');
    }
}

function checkSource(value, jsonPath, errors, { typeRequired = true } = {}) {
    if (!checkObject(value, jsonPath, SOURCE_KEYS, errors)) return;
    checkString(value.table, `${jsonPath}.table`, errors);
    checkString(value.column, `${jsonPath}.column`, errors);
    checkString(value.type, `${jsonPath}.type`, errors, { optional: !typeRequired });
}

function checkPartitionPath(value, jsonPath, errors) {
    if (!checkString(value, jsonPath, errors)) return;
    if (!/^\/[^\s/*?#]+$/u.test(value)) {
        addError(errors, jsonPath, 'must be a top-level path such as "/tenantId" without wildcards');
    }
}

export function splitIndexPathParts(value, separator) {
    const parts = [];
    let start = 0;
    let quoted = false;
    let escaped = false;
    let tuple = false;
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') quoted = false;
        } else if (character === '"') quoted = true;
        else if (character === '{') {
            if (tuple) throw new Error('tuple specifiers cannot be nested');
            tuple = true;
        } else if (character === '}') {
            if (!tuple) throw new Error('contains an unmatched tuple closing brace');
            tuple = false;
        } else if (character === separator && !tuple) {
            parts.push(value.slice(start, index));
            start = index + 1;
        }
    }
    if (quoted) throw new Error('contains an unclosed quoted property name');
    if (tuple) throw new Error('contains an unclosed tuple specifier');
    parts.push(value.slice(start));
    if (parts.some(part => !part.length)) throw new Error('contains an empty path segment or tuple member');
    return parts;
}

function validateIndexProperty(segment, { allowArrayWildcard = true } = {}) {
    if (segment.startsWith('"')) {
        try {
            if (!segment.endsWith('"') || typeof JSON.parse(segment) !== 'string') throw new Error();
        } catch {
            throw new Error('quoted property names must be valid JSON strings');
        }
    } else if (segment === '[]') {
        if (!allowArrayWildcard) throw new Error('tuple members cannot contain array wildcards');
    } else if (!/^(?:[\p{L}\p{N}_]+|\[\d+\])$/u.test(segment)) {
        throw new Error('property names with special characters must be double-quoted; unquoted markers are terminal-only');
    }
}

function isEtagIndexPath(value, composite = false) {
    if (typeof value !== 'string' || !value.startsWith('/')) return false;
    try {
        const segments = splitIndexPathParts(value.slice(1), '/');
        if (segments.length !== (composite ? 1 : 2)) return false;
        if (!composite && !['?', '*'].includes(segments[1])) return false;
        const property = segments[0].startsWith('"') ? JSON.parse(segments[0]) : segments[0];
        return property === '_etag';
    } catch {
        return false;
    }
}

function checkIndexPath(value, jsonPath, errors, { composite = false, allowTuple = false, rejectEtag = false, rejectId = false } = {}) {
    if (!checkString(value, jsonPath, errors)) return;
    try {
        if (!value.startsWith('/')) throw new Error('must be an absolute Cosmos DB index path');
        const segments = splitIndexPathParts(value.slice(1), '/');
        if (!composite && !['*', '?'].includes(segments.at(-1))) {
            throw new Error('must end with "/?" for a scalar or "/*" for a subtree');
        }
        const properties = composite ? segments : segments.slice(0, -1);
        for (const [index, segment] of properties.entries()) {
            if (segment.startsWith('{')) {
                if (!allowTuple || composite) throw new Error('tuple paths are supported only in includedPaths');
                if (!segment.endsWith('}') || index !== properties.length - 1 || segments.at(-1) !== '?') {
                    throw new Error('a tuple specifier must be followed immediately by the terminal "/?"');
                }
                const prefix = properties.slice(0, index);
                if (prefix.at(-1) !== '[]' || prefix.filter(part => part === '[]').length !== 1) {
                    throw new Error('a tuple prefix must contain exactly one array wildcard immediately before the tuple');
                }
                const members = splitIndexPathParts(segment.slice(1, -1), ',');
                for (const member of members) {
                    for (const part of splitIndexPathParts(member.trim(), '/')) {
                        validateIndexProperty(part, { allowArrayWildcard: false });
                    }
                }
            } else {
                if (composite && ['*', '?'].includes(segment)) {
                    throw new Error('composite index paths cannot contain wildcards or terminal markers');
                }
                validateIndexProperty(segment);
            }
        }
        if (rejectEtag && isEtagIndexPath(value, composite)) {
            throw new Error('must not explicitly index the system _etag property');
        }
        if (rejectId && !composite && properties.length === 1) {
            const property = properties[0].startsWith('"') ? JSON.parse(properties[0]) : properties[0];
            if (property === 'id') throw new Error('must not explicitly include the system id property; it is indexed automatically');
        }
    } catch (error) {
        addError(errors, jsonPath, error.message);
    }
}

function checkAttribute(attribute, jsonPath, errors) {
    if (!checkObject(attribute, jsonPath, ATTRIBUTE_KEYS, errors)) return;
    checkString(attribute.target, `${jsonPath}.target`, errors);
    checkSource(attribute.source, `${jsonPath}.source`, errors);
    if (!TARGET_JSON_TYPES.includes(attribute.type)) {
        addError(errors, `${jsonPath}.type`, `must be a supported target JSON type: ${TARGET_JSON_TYPES.join(', ')}`);
    }
    for (const key of ['isId', 'isPartitionKey']) {
        if (attribute[key] !== undefined && typeof attribute[key] !== 'boolean') {
            addError(errors, `${jsonPath}.${key}`, 'must be a boolean');
        }
    }
}

function checkRelationship(relationship, jsonPath, entityNames, errors) {
    if (!checkObject(relationship, jsonPath, RELATIONSHIP_KEYS, errors)) return;
    checkString(relationship.targetEntity, `${jsonPath}.targetEntity`, errors);
    if (typeof relationship.targetEntity === 'string' && !entityNames.has(relationship.targetEntity.toLowerCase())) {
        addError(errors, `${jsonPath}.targetEntity`, 'must reference an entity in the model');
    }
    checkSource(relationship.sourceFK, `${jsonPath}.sourceFK`, errors, { typeRequired: false });
    if (!RELATIONSHIP_TYPES.has(relationship.type)) {
        addError(errors, `${jsonPath}.type`, 'must be one-to-one, one-to-many, or many-to-many');
    }
    if (!RELATIONSHIP_STRATEGIES.has(relationship.strategy)) {
        addError(errors, `${jsonPath}.strategy`, 'must be embed or reference');
    }
    if (relationship.strategy === 'embed') {
        checkString(relationship.targetProperty, `${jsonPath}.targetProperty`, errors);
    } else if (relationship.targetProperty !== undefined) {
        addError(errors, `${jsonPath}.targetProperty`, 'is supported only for embed relationships');
    }
}

function checkRelationshipEntityDispositions(model, errors) {
    const entities = new Map(
        model.containers
            .flatMap(container => container.entities ?? [])
            .filter(entity => typeof entity?.name === 'string')
            .map(entity => [entity.name.toLowerCase(), entity]),
    );
    for (const [containerIndex, container] of model.containers.entries()) {
        for (const [entityIndex, entity] of (container.entities ?? []).entries()) {
            for (const [relationshipIndex, relationship] of (entity.relationships ?? []).entries()) {
                if (relationship?.strategy !== 'reference') continue;
                const relationshipPath = `$.containers[${containerIndex}].entities[${entityIndex}].relationships[${relationshipIndex}]`;
                if (entity.isEmbeddedOnly === true) {
                    addError(errors, `${relationshipPath}.strategy`, 'reference relationships require a standalone source entity');
                }
                const target = typeof relationship.targetEntity === 'string'
                    ? entities.get(relationship.targetEntity.toLowerCase())
                    : undefined;
                if (target?.isEmbeddedOnly === true) {
                    addError(errors, `${relationshipPath}.targetEntity`, 'reference relationships require a standalone target entity');
                }
            }
        }
    }
}

export function isUuidSourceType(sourceType) {
    return typeof sourceType === 'string' && GUID_SOURCE_TYPES.has(sourceType.toLocaleLowerCase('en-US'));
}

export function classifyItemIdentity(entity) {
    if (entity?.idTemplate === '{uuid}') return 'generated-uuid';
    const template = typeof entity?.idTemplate === 'string' ? entity.idTemplate : '';
    const idSource = entity?.attributes?.find(attribute => attribute?.isId === true)?.source;
    if (isUuidSourceType(idSource?.type) && template === `{${idSource.column}}`) {
        return 'native-uuid';
    }
    return 'derived';
}

function checkIdTemplate(entity, jsonPath, errors) {
    if (entity.isEmbeddedOnly === true) return;
    if (!checkString(entity.idTemplate, `${jsonPath}.idTemplate`, errors)) return;
    const placeholders = [...entity.idTemplate.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]);
    if (placeholders.length === 0) {
        addError(errors, `${jsonPath}.idTemplate`, 'must contain at least one source-column or uuid placeholder');
        return;
    }
    const sourceColumns = new Set(
        entity.attributes
            .map((attribute) => attribute?.source?.column)
            .filter((column) => typeof column === 'string'),
    );
    const idAttribute = entity.attributes.find((attribute) => attribute?.isId === true);
    const idSource = idAttribute?.source;
    const sourceType = typeof idSource?.type === 'string' ? idSource.type.toLocaleLowerCase('en-US') : '';
    const generatedId = idSource?.table === '(generated)' || idSource?.column === '(uuid)';
    const usesGeneratedUuid = placeholders.includes('uuid');

    if (/[/\\?#]/u.test(entity.idTemplate) || /\s$/u.test(entity.idTemplate)) {
        addError(errors, `${jsonPath}.idTemplate`, 'static template text contains a forbidden ID character or trailing whitespace');
    }
    if (usesGeneratedUuid) {
        if (
            entity.idTemplate !== '{uuid}' ||
            idSource?.table !== '(generated)' ||
            idSource?.column !== '(uuid)' ||
            sourceType !== 'uuid'
        ) {
            addError(
                errors,
                `${jsonPath}.idTemplate`,
                'generated UUID fallback must use idTemplate "{uuid}" and source (generated)/(uuid)/uuid',
            );
        }
    } else if (generatedId) {
        addError(errors, `${jsonPath}.idTemplate`, 'generated ID source requires the {uuid} fallback template');
    } else if (classifyItemIdentity(entity) !== 'native-uuid') {
        const entityPrefix = `${entity.name.slice(0, 1).toLocaleLowerCase('en-US')}${entity.name.slice(1)}-`;
        if (!entity.idTemplate.startsWith(entityPrefix)) {
            addError(errors, `${jsonPath}.idTemplate`, `derived IDs must start with "${entityPrefix}"`);
        }
    }

    if (!usesGeneratedUuid && typeof idSource?.column === 'string' && !placeholders.includes(idSource.column)) {
        addError(errors, `${jsonPath}.idTemplate`, 'must include the source column used by the id attribute');
    }
    for (const placeholder of placeholders) {
        if (placeholder !== 'uuid' && !sourceColumns.has(placeholder)) {
            addError(errors, `${jsonPath}.idTemplate`, `placeholder "${placeholder}" has no matching source column`);
        }
        if (
            placeholder !== 'uuid' &&
            !entity.attributes.some(
                (attribute) => attribute?.target !== 'id' && attribute?.source?.column === placeholder,
            )
        ) {
            addError(
                errors,
                `${jsonPath}.idTemplate`,
                `source key "${placeholder}" must also be preserved as a separate natural-key attribute`,
            );
        }
    }
}

function checkEntity(entity, jsonPath, partitionPaths, entityNames, errors) {
    if (!checkObject(entity, jsonPath, ENTITY_KEYS, errors)) return;
    checkString(entity.name, `${jsonPath}.name`, errors);
    checkString(entity.docType, `${jsonPath}.docType`, errors);
    checkString(entity.sourceTable, `${jsonPath}.sourceTable`, errors);
    if (entity.isEmbeddedOnly !== undefined && typeof entity.isEmbeddedOnly !== 'boolean') {
        addError(errors, `${jsonPath}.isEmbeddedOnly`, 'must be a boolean');
    }
    if (!checkArray(entity.attributes, `${jsonPath}.attributes`, errors, { min: 1 })) return;
    for (const [index, attribute] of entity.attributes.entries()) {
        checkAttribute(attribute, `${jsonPath}.attributes[${index}]`, errors);
    }
    checkUnique(
        entity.attributes.map((attribute) => attribute?.target),
        `${jsonPath}.attributes`,
        'attribute target',
        errors,
    );
    if (entity.isEmbeddedOnly !== true) {
        const idAttributes = entity.attributes.filter((attribute) => attribute?.isId === true);
        if (idAttributes.length !== 1) addError(errors, `${jsonPath}.attributes`, 'must contain exactly one isId=true attribute');
        else {
            if (idAttributes[0].target !== 'id') addError(errors, `${jsonPath}.attributes`, 'the isId=true attribute target must be "id"');
            if (idAttributes[0].type !== 'string') addError(errors, `${jsonPath}.attributes`, 'the id attribute type must be "string"');
        }
        for (const partitionPath of partitionPaths) {
            const target = partitionPath.slice(1);
            const matches = entity.attributes.filter(
                (attribute) => attribute?.target === target && attribute?.isPartitionKey === true,
            );
            if (matches.length !== 1) {
                addError(errors, `${jsonPath}.attributes`, `must contain one isPartitionKey=true attribute for "${partitionPath}"`);
            }
        }
    }
    checkIdTemplate(entity, jsonPath, errors);
    if (checkArray(entity.relationships, `${jsonPath}.relationships`, errors, { optional: true })) {
        for (const [index, relationship] of (entity.relationships ?? []).entries()) {
            checkRelationship(relationship, `${jsonPath}.relationships[${index}]`, entityNames, errors);
        }
    }
}

function checkIndexingPolicy(policy, jsonPath, errors, warnings) {
    const initialErrorCount = errors.length;
    if (!checkObject(policy, jsonPath, INDEX_POLICY_KEYS, errors)) return;
    if (policy.indexingMode !== undefined && !['consistent', 'none'].includes(policy.indexingMode)) {
        addError(errors, `${jsonPath}.indexingMode`, 'only consistent or none indexing modes are supported');
    }
    if (policy.automatic !== undefined && typeof policy.automatic !== 'boolean') {
        addError(errors, `${jsonPath}.automatic`, 'must be a boolean');
    }
    for (const collectionName of ['includedPaths', 'excludedPaths']) {
        const collectionPath = `${jsonPath}.${collectionName}`;
        if (!checkArray(policy[collectionName], collectionPath, errors)) continue;
        for (const [index, entry] of policy[collectionName].entries()) {
            if (!checkObject(entry, `${collectionPath}[${index}]`, new Set(['path']), errors)) continue;
            checkIndexPath(entry.path, `${collectionPath}[${index}].path`, errors, {
                allowTuple: collectionName === 'includedPaths',
                rejectEtag: collectionName === 'includedPaths' && policy.indexingMode !== 'none',
                rejectId: collectionName === 'includedPaths' && policy.indexingMode !== 'none',
            });
        }
    }
    if (policy.indexingMode === undefined || policy.indexingMode === 'consistent') {
        const hasRootPath = ['includedPaths', 'excludedPaths'].some(collectionName =>
            Array.isArray(policy[collectionName]) && policy[collectionName].some(entry => entry?.path === '/*'),
        );
        if (!hasRootPath) addError(errors, jsonPath, 'consistent indexing requires "/*" in includedPaths or excludedPaths');
    }
    if (checkArray(policy.compositeIndexes, `${jsonPath}.compositeIndexes`, errors, { optional: true })) {
        for (const [groupIndex, group] of (policy.compositeIndexes ?? []).entries()) {
            const groupPath = `${jsonPath}.compositeIndexes[${groupIndex}]`;
            if (!checkArray(group, groupPath, errors, { min: 2, max: 8 })) continue;
            for (const [entryIndex, entry] of group.entries()) {
                const entryPath = `${groupPath}[${entryIndex}]`;
                if (!checkObject(entry, entryPath, new Set(['path', 'order']), errors)) continue;
                checkIndexPath(entry.path, `${entryPath}.path`, errors, {
                    composite: true,
                    rejectEtag: policy.indexingMode !== 'none',
                });
                if (!INDEX_ORDERS.has(entry.order)) addError(errors, `${entryPath}.order`, 'must be ascending or descending');
            }
        }
    }
    if (checkArray(policy.fullTextIndexes, `${jsonPath}.fullTextIndexes`, errors, { optional: true })) {
        for (const [index, entry] of (policy.fullTextIndexes ?? []).entries()) {
            const entryPath = `${jsonPath}.fullTextIndexes[${index}]`;
            if (!checkObject(entry, entryPath, new Set(['path']), errors)) continue;
            checkIndexPath(entry.path, `${entryPath}.path`, errors, {
                composite: true,
                rejectEtag: policy.indexingMode !== 'none',
            });
        }
        checkUnique(
            (policy.fullTextIndexes ?? []).map((entry) => entry?.path),
            `${jsonPath}.fullTextIndexes`,
            'full-text index path',
            errors,
            true,
        );
    }
    if (
        errors.length === initialErrorCount &&
        policy.indexingMode !== 'none' &&
        !policy.excludedPaths.some(entry => entry.path === '/*' || isEtagIndexPath(entry.path))
    ) {
        warnings.push({
            path: `${jsonPath}.excludedPaths`,
            message:
                'Add an explicit /"_etag"/? exclusion to follow the migration convention; ' +
                'Cosmos DB excludes _etag by default.',
        });
    }
}

function checkFullTextPolicy(container, jsonPath, errors) {
    const policy = container.fullTextPolicy;
    const policyPath = `${jsonPath}.fullTextPolicy`;
    const paths = new Set();
    if (
        policy !== undefined &&
        checkObject(policy, policyPath, new Set(['defaultLanguage', 'fullTextPaths']), errors)
    ) {
        checkString(policy.defaultLanguage, `${policyPath}.defaultLanguage`, errors);
        if (checkArray(policy.fullTextPaths, `${policyPath}.fullTextPaths`, errors, { min: 1 })) {
            for (const [index, entry] of policy.fullTextPaths.entries()) {
                const entryPath = `${policyPath}.fullTextPaths[${index}]`;
                if (!checkObject(entry, entryPath, new Set(['path', 'language']), errors)) continue;
                checkIndexPath(entry.path, `${entryPath}.path`, errors, { composite: true });
                checkString(entry.language, `${entryPath}.language`, errors, { optional: true });
                paths.add(entry.path);
            }
            checkUnique(
                policy.fullTextPaths.map((entry) => entry?.path),
                `${policyPath}.fullTextPaths`,
                'full-text policy path',
                errors,
                true,
            );
        }
    }
    const indexes = container.indexingPolicy?.fullTextIndexes;
    if (!Array.isArray(indexes) || !indexes.length) return;
    if (container.indexingPolicy.indexingMode === 'none') {
        addError(errors, `${jsonPath}.indexingPolicy.indexingMode`, 'full-text indexes require consistent indexing');
    }
    for (const [index, entry] of indexes.entries()) {
        if (typeof entry?.path === 'string' && !paths.has(entry.path)) {
            addError(
                errors,
                `${jsonPath}.indexingPolicy.fullTextIndexes[${index}].path`,
                'must reference a path in the container fullTextPolicy.fullTextPaths',
            );
        }
    }
}

export function checkUniqueKeyPolicy(policy, jsonPath, errors) {
    if (policy === undefined) return;
    if (!checkObject(policy, jsonPath, new Set(['uniqueKeys']), errors)) return;
    if (!checkArray(policy.uniqueKeys, `${jsonPath}.uniqueKeys`, errors, { min: 1, max: 10 })) return;
    const constraints = new Set();
    let pathCount = 0;
    for (const [index, key] of policy.uniqueKeys.entries()) {
        const keyPath = `${jsonPath}.uniqueKeys[${index}]`;
        if (!checkObject(key, keyPath, new Set(['paths']), errors)) continue;
        if (!checkArray(key.paths, `${keyPath}.paths`, errors, { min: 1, max: 16 })) continue;
        pathCount += key.paths.length;
        for (const [pathIndex, uniquePath] of key.paths.entries()) {
            checkIndexPath(uniquePath, `${keyPath}.paths[${pathIndex}]`, errors, { composite: true });
            if (typeof uniquePath === 'string' && /(?:^|\/)\[\d*\](?:\/|$)/u.test(uniquePath)) {
                addError(errors, `${keyPath}.paths[${pathIndex}]`, 'must name scalar properties without array segments');
            }
        }
        checkUnique(key.paths, `${keyPath}.paths`, 'unique-key path', errors, true);
        if (key.paths.some(uniquePath => typeof uniquePath !== 'string')) continue;
        const signature = JSON.stringify([...key.paths].sort());
        if (constraints.has(signature)) addError(errors, keyPath, 'duplicates a unique-key constraint');
        constraints.add(signature);
    }
    if (pathCount > 16) addError(errors, jsonPath, 'must contain at most 16 paths across all unique-key constraints');
}

function checkContainer(container, jsonPath, entityNames, capacityMode, errors, warnings) {
    if (!checkObject(container, jsonPath, CONTAINER_KEYS, errors)) return;
    checkResourceName(container.name, `${jsonPath}.name`, errors);
    const partitionPaths = [];
    if (checkArray(container.partitionKeys, `${jsonPath}.partitionKeys`, errors, { min: 1, max: 3 })) {
        for (const [index, partitionKey] of container.partitionKeys.entries()) {
            const partitionPath = `${jsonPath}.partitionKeys[${index}]`;
            if (!checkObject(partitionKey, partitionPath, new Set(['path', 'candidates', 'analysis']), errors)) continue;
            checkPartitionPath(partitionKey.path, `${partitionPath}.path`, errors);
            if (typeof partitionKey.path === 'string') partitionPaths.push(partitionKey.path);
        }
        checkUnique(partitionPaths, `${jsonPath}.partitionKeys`, 'partition-key path', errors);
    }
    if (checkArray(container.entities, `${jsonPath}.entities`, errors, { min: 1 })) {
        checkUnique(container.entities.map((entity) => entity?.name), `${jsonPath}.entities`, 'entity name', errors);
        checkUnique(container.entities.map((entity) => entity?.docType), `${jsonPath}.entities`, 'docType', errors);
        for (const [index, entity] of container.entities.entries()) {
            checkEntity(entity, `${jsonPath}.entities[${index}]`, partitionPaths, entityNames, errors);
        }
    }
    checkIndexingPolicy(container.indexingPolicy, `${jsonPath}.indexingPolicy`, errors, warnings);
    checkFullTextPolicy(container, jsonPath, errors);
    checkUniqueKeyPolicy(container.uniqueKeyPolicy, `${jsonPath}.uniqueKeyPolicy`, errors);
    if (container.maxThroughput !== undefined) {
        if (!Number.isInteger(container.maxThroughput) || container.maxThroughput < 1000 || container.maxThroughput % 1000 !== 0) {
            addError(errors, `${jsonPath}.maxThroughput`, 'must be an integer multiple of 1000 and at least 1000');
        }
    }
    if (capacityMode === 'provisioned' && container.maxThroughput === undefined) {
        addError(errors, `${jsonPath}.maxThroughput`, 'is required for provisioned capacity');
    }
    if (capacityMode === 'serverless' && container.maxThroughput !== undefined) {
        addError(errors, `${jsonPath}.maxThroughput`, 'must be omitted for serverless capacity');
    }
    for (const key of ['estimatedStorageGB', 'estimatedRowCount']) {
        if (container[key] !== undefined && (typeof container[key] !== 'number' || container[key] < 0)) {
            addError(errors, `${jsonPath}.${key}`, 'must be a non-negative number');
        }
    }
}

function checkAccessPatterns(model, containerNames, errors) {
    if (!checkArray(model.accessPatterns, '$.accessPatterns', errors, { optional: true })) return;
    for (const [index, pattern] of (model.accessPatterns ?? []).entries()) {
        const jsonPath = `$.accessPatterns[${index}]`;
        if (!checkObject(pattern, jsonPath, new Set(['name', 'source', 'target']), errors)) continue;
        checkString(pattern.name, `${jsonPath}.name`, errors);
        if (checkObject(pattern.source, `${jsonPath}.source`, new Set(['type', 'query']), errors)) {
            checkString(pattern.source.type, `${jsonPath}.source.type`, errors);
            checkString(pattern.source.query, `${jsonPath}.source.query`, errors);
        }
        if (checkObject(pattern.target, `${jsonPath}.target`, new Set(['type', 'container', 'operation', 'query', 'partitionKeyValue', 'isCrossPartition', 'estimatedRU']), errors)) {
            checkString(pattern.target.type, `${jsonPath}.target.type`, errors);
            checkString(pattern.target.container, `${jsonPath}.target.container`, errors);
            checkString(pattern.target.operation, `${jsonPath}.target.operation`, errors);
            if (typeof pattern.target.container === 'string' && !containerNames.has(pattern.target.container.toLowerCase())) {
                addError(errors, `${jsonPath}.target.container`, 'must reference a container in the model');
            }
            if (typeof pattern.target.isCrossPartition !== 'boolean') {
                addError(errors, `${jsonPath}.target.isCrossPartition`, 'must be a boolean');
            }
        }
    }
}

function checkCrossPartitionQueries(model, containerNames, errors) {
    if (!checkArray(model.crossPartitionQueries, '$.crossPartitionQueries', errors, { optional: true })) return;
    for (const [index, query] of (model.crossPartitionQueries ?? []).entries()) {
        const jsonPath = `$.crossPartitionQueries[${index}]`;
        if (!checkObject(query, jsonPath, new Set(['name', 'container', 'query', 'reason', 'estimatedRUCost', 'optimizations']), errors)) continue;
        for (const key of ['name', 'container', 'query', 'reason', 'estimatedRUCost']) {
            checkString(query[key], `${jsonPath}.${key}`, errors);
        }
        if (typeof query.container === 'string' && !containerNames.has(query.container.toLowerCase())) {
            addError(errors, `${jsonPath}.container`, 'must reference a container in the model');
        }
        if (checkArray(query.optimizations, `${jsonPath}.optimizations`, errors)) {
            for (const [optimizationIndex, optimization] of query.optimizations.entries()) {
                checkString(optimization, `${jsonPath}.optimizations[${optimizationIndex}]`, errors);
            }
        }
    }
}

function checkUnresolvedPlaceholders(value, jsonPath, errors) {
    if (typeof value === 'string') {
        if (/(?:<value>|\bTBD\b|\bREPLACE[_ -]?ME\b|\bTODO\b)/iu.test(value)) {
            addError(errors, jsonPath, 'contains an unresolved placeholder');
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
            checkUnresolvedPlaceholders(item, `${jsonPath}[${index}]`, errors);
        }
        return;
    }
    if (isObject(value)) {
        for (const [key, item] of Object.entries(value)) {
            if (key !== 'idTemplate') checkUnresolvedPlaceholders(item, `${jsonPath}.${key}`, errors);
        }
    }
}

export function validateCosmosModel(model, { referenceRegistry = [], warnings = [] } = {}) {
    const errors = [];
    if (!checkObject(model, '$', ROOT_KEYS, errors)) return errors;
    if (model.version !== 1) addError(errors, '$.version', 'must equal 1');
    checkString(model.domain, '$.domain', errors);
    checkString(model.sourceType, '$.sourceType', errors, { optional: true });
    if (model.databaseName !== undefined) checkResourceName(model.databaseName, '$.databaseName', errors);
    if (model.capacityMode !== undefined && !CAPACITY_MODES.has(model.capacityMode)) {
        addError(errors, '$.capacityMode', 'must be serverless or provisioned');
    }
    if (model.domain === 'all') {
        checkResourceName(model.databaseName, '$.databaseName', errors);
        if (!CAPACITY_MODES.has(model.capacityMode)) addError(errors, '$.capacityMode', 'is required for the root model');
    }
    if (!checkArray(model.containers, '$.containers', errors, { min: 1 })) return errors;
    checkUnique(model.containers.map((container) => container?.name), '$.containers', 'container name', errors);
    const entityNames = new Set(
        model.containers.flatMap((container) => container?.entities ?? []).map((entity) => entity?.name?.toLowerCase()).filter(Boolean),
    );
    const localNames = model.containers.flatMap((container) => container?.entities ?? []).map((entity) => entity?.name);
    checkUnique(localNames, '$.containers[*].entities', 'globally ambiguous entity name', errors);
    if (model.domain !== 'all') {
        const external = referenceRegistry.filter((entry) => entry?.domain !== model.domain);
        for (const [index, entry] of external.entries()) {
            const registryPath = `$.referenceRegistry[${index}]`;
            if (!checkObject(entry, registryPath, new Set(['domain', 'name', 'sourceTable']), errors)) continue;
            for (const key of ['domain', 'name', 'sourceTable']) checkString(entry[key], `${registryPath}.${key}`, errors);
            if (typeof entry.name === 'string') {
                const key = entry.name.toLowerCase();
                if (entityNames.has(key)) addError(errors, registryPath, 'ambiguous entity identity; assign distinct model entity names');
                entityNames.add(key);
            }
        }
    }
    const containerNames = new Set(model.containers.map((container) => container?.name?.toLowerCase()).filter(Boolean));
    for (const [index, container] of model.containers.entries()) {
        checkContainer(container, `$.containers[${index}]`, entityNames, model.capacityMode, errors, warnings);
    }
    checkRelationshipEntityDispositions(model, errors);
    checkAccessPatterns(model, containerNames, errors);
    checkCrossPartitionQueries(model, containerNames, errors);
    checkUnresolvedPlaceholders(model, '$', errors);
    return errors;
}

function canonicalSource(source) {
    const result = { table: source.table, column: source.column };
    if (source.type !== undefined) result.type = source.type;
    return result;
}

function canonicalAttribute(attribute) {
    const result = { target: attribute.target, source: canonicalSource(attribute.source), type: attribute.type };
    if (attribute.isPartitionKey === true) result.isPartitionKey = true;
    if (attribute.isId === true) result.isId = true;
    return result;
}

function canonicalRelationship(relationship) {
    const result = {
        targetEntity: relationship.targetEntity,
        sourceFK: canonicalSource(relationship.sourceFK),
        type: relationship.type,
        strategy: relationship.strategy,
    };
    if (relationship.targetProperty !== undefined) result.targetProperty = relationship.targetProperty;
    return result;
}

function canonicalEntity(entity) {
    const result = {
        name: entity.name,
        docType: entity.docType,
        sourceTable: entity.sourceTable,
        attributes: entity.attributes.map(canonicalAttribute).sort((left, right) =>
            `${left.target}\0${left.source.table}\0${left.source.column}`.localeCompare(
                `${right.target}\0${right.source.table}\0${right.source.column}`,
            ),
        ),
    };
    if (entity.relationships?.length) {
        result.relationships = entity.relationships.map(canonicalRelationship).sort((left, right) =>
            `${left.targetEntity}\0${left.sourceFK.table}\0${left.sourceFK.column}`.localeCompare(
                `${right.targetEntity}\0${right.sourceFK.table}\0${right.sourceFK.column}`,
            ),
        );
    }
    if (entity.isEmbeddedOnly !== undefined) result.isEmbeddedOnly = entity.isEmbeddedOnly;
    if (entity.idTemplate !== undefined) result.idTemplate = entity.idTemplate;
    return result;
}

function canonicalIndexingPolicy(policy) {
    const result = {};
    if (policy.indexingMode !== undefined) result.indexingMode = policy.indexingMode;
    if (policy.automatic !== undefined) result.automatic = policy.automatic;
    result.includedPaths = [...policy.includedPaths].map(({ path: indexPath }) => ({ path: indexPath })).sort((a, b) => a.path.localeCompare(b.path));
    result.excludedPaths = [...policy.excludedPaths].map(({ path: indexPath }) => ({ path: indexPath })).sort((a, b) => a.path.localeCompare(b.path));
    if (policy.compositeIndexes?.length) {
        result.compositeIndexes = policy.compositeIndexes
            .map((group) => group.map(({ path: indexPath, order }) => ({ path: indexPath, order })))
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if (policy.fullTextIndexes?.length) {
        result.fullTextIndexes = policy.fullTextIndexes.map(({ path: indexPath }) => ({ path: indexPath })).sort((a, b) => a.path.localeCompare(b.path));
    }
    return result;
}

export function canonicalFullTextPolicy(policy) {
    return {
        defaultLanguage: policy.defaultLanguage,
        fullTextPaths: policy.fullTextPaths
            .map((entry) => ({
                path: entry.path,
                language: entry.language ?? policy.defaultLanguage,
            }))
            .sort((left, right) => left.path.localeCompare(right.path)),
    };
}

export function canonicalUniqueKeyPolicy(policy) {
    return {
        uniqueKeys: policy.uniqueKeys
            .map(({ paths }) => ({ paths: [...paths].sort() }))
            .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    };
}

function canonicalContainer(container) {
    const result = {
        name: container.name,
        partitionKeys: container.partitionKeys.map(({ path: partitionPath }) => ({ path: partitionPath })),
        entities: container.entities.map(canonicalEntity).sort((a, b) => a.name.localeCompare(b.name)),
        indexingPolicy: canonicalIndexingPolicy(container.indexingPolicy),
    };
    if (container.fullTextPolicy !== undefined)
        result.fullTextPolicy = canonicalFullTextPolicy(container.fullTextPolicy);
    if (container.uniqueKeyPolicy !== undefined)
        result.uniqueKeyPolicy = canonicalUniqueKeyPolicy(container.uniqueKeyPolicy);
    if (container.maxThroughput !== undefined) result.maxThroughput = container.maxThroughput;
    if (container.estimatedStorageGB !== undefined) result.estimatedStorageGB = container.estimatedStorageGB;
    if (container.estimatedRowCount !== undefined) result.estimatedRowCount = container.estimatedRowCount;
    return result;
}

function canonicalAccessPattern(pattern) {
    const target = {
        type: pattern.target.type,
        container: pattern.target.container,
        operation: pattern.target.operation,
    };
    if (pattern.target.query !== undefined) target.query = pattern.target.query;
    if (pattern.target.partitionKeyValue !== undefined) {
        target.partitionKeyValue = pattern.target.partitionKeyValue;
    }
    target.isCrossPartition = pattern.target.isCrossPartition;
    if (pattern.target.estimatedRU !== undefined) target.estimatedRU = pattern.target.estimatedRU;
    return {
        name: pattern.name,
        source: { type: pattern.source.type, query: pattern.source.query },
        target,
    };
}

function canonicalCrossPartitionQuery(query) {
    return {
        name: query.name,
        container: query.container,
        query: query.query,
        reason: query.reason,
        estimatedRUCost: query.estimatedRUCost,
        optimizations: [...query.optimizations].sort(),
    };
}

export function canonicalizeCosmosModel(model) {
    const result = { version: 1 };
    if (model.databaseName !== undefined) result.databaseName = model.databaseName;
    if (model.capacityMode !== undefined) result.capacityMode = model.capacityMode;
    result.domain = model.domain;
    if (model.sourceType !== undefined) result.sourceType = model.sourceType;
    result.containers = model.containers.map(canonicalContainer).sort((a, b) => a.name.localeCompare(b.name));
    if (model.accessPatterns?.length) {
        result.accessPatterns = model.accessPatterns
            .map(canonicalAccessPattern)
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    if (model.crossPartitionQueries?.length) {
        result.crossPartitionQueries = model.crossPartitionQueries
            .map(canonicalCrossPartitionQuery)
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    return result;
}

export function validateAndCanonicalize(model, options) {
    const warnings = options?.warnings ?? [];
    const errors = validateCosmosModel(model, { ...options, warnings });
    return errors.length === 0 ? { errors, warnings, model: canonicalizeCosmosModel(model) } : { errors, warnings };
}

export function canonicalStringify(model) {
    return `${JSON.stringify(model, null, 2)}\n`;
}

export function writeFileAtomic(filePath, content) {
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
    const args = { input: undefined, output: undefined, check: false };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--reference-manifest') args.referenceManifest = requireOptionValue(argv, index++);
        else if (arg === '--reference-registry') args.registryPath = requireOptionValue(argv, index++);
        else if (arg === '--output') args.output = requireOptionValue(argv, index++);
        else if (arg === '--check') args.check = true;
        else if (!args.input) args.input = arg;
        else throw new Error(`Unexpected argument: ${arg}`);
    }
    if (!args.input) throw new Error('Usage: validate-cosmos-model.mjs <model.json|manifest.json> [--reference-manifest <manifest.json>] [--output <path>] [--check]');
    if (args.check && args.output) throw new Error('--check and --output cannot be used together');
    return args;
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node validate-cosmos-model.mjs <model.json|manifest.json> [options]

Validate model structure/semantics and canonicalize it. Paths resolve from the current directory.
Input must contain the model itself, even if named manifest.json; phase manifests are not models.
Does not check phase completion. Prefer the canonical model JSON path in the workflow.

    --reference-manifest <path>  Root manifest containing referenceRegistry; preferred in workflow.
    --reference-registry <path>  Standalone registry JSON array; ignored if --reference-manifest is set.
    --check                     Print a compact validation result; do not emit/write the model.
    --output <path>             Atomically write/replace canonical model; incompatible with --check.

Default: print the full canonical model to stdout without writing. Use --check for repair diagnostics.
Errors and warnings may go to stderr. Exit: 0 when valid; 1 on validation or I/O errors.
`)) return 0;
    let args;
    try {
        args = parseArguments(argv);
        const input = path.basename(args.input) === 'manifest.json' ? readDomainModel(args.input) : JSON.parse(fs.readFileSync(args.input, 'utf8'));
        const referenceRegistry = args.referenceManifest ? readPhaseEvidence(args.referenceManifest).referenceRegistry ?? [] : args.registryPath ? JSON.parse(fs.readFileSync(args.registryPath, 'utf8')) : [];
        if (!Array.isArray(referenceRegistry)) throw new Error('Reference registry must be an array.');
        const result = validateAndCanonicalize(input, { referenceRegistry });
        const diagnostics = result.warnings.length ? { warnings: result.warnings } : {};
        if (result.errors.length > 0) {
            process.stderr.write(
                `${JSON.stringify({ valid: false, errors: result.errors, ...diagnostics }, null, 2)}\n`,
            );
            return 1;
        }
        if (args.check) {
            process.stdout.write(`${JSON.stringify({ valid: true, ...diagnostics })}\n`);
        } else {
            if (result.warnings.length) process.stderr.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
            const output = canonicalStringify(result.model);
            if (args.output) writeFileAtomic(args.output, output);
            else process.stdout.write(output);
        }
        return 0;
    } catch (error) {
        process.stderr.write(`${JSON.stringify({ valid: false, errors: [{ path: '$', message: error.message }] }, null, 2)}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
