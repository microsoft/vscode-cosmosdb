// Purpose: Execute bounded JSON mapping examples, not user code or source-engine operations.

import { isDeepStrictEqual } from 'node:util';
import { encodeSourceIdentity, resolveItemId } from './identity-mapping.mjs';
import { isPartitionKeyValue, readPartitionKeyValue } from './partition-key-values.mjs';
import { directIdentityField, entitySource, isFieldPathPrefix, sourceRefs, validateFieldPath } from './source-contract.mjs';
import { isValidTtl } from './validate-cosmos-model.mjs';

export const DOCUMENT_MAPPING_VERSION = 3;
const SYSTEM_FIELDS = new Set(['id', 'docType', '_rid', '_self', '_etag', '_attachments', '_ts']);
const DOCUMENT_MODES = new Set(['preserve', 'reshape', 'projection']);
const WORKLOAD_EVIDENCE = new Set([
    '.cosmosdb-migration/phases/1-discovery/access-patterns/access-patterns.md',
    '.cosmosdb-migration/phases/1-discovery/volumetrics/volumetrics.md',
]);

const missing = Object.freeze({ state: 'missing' });
const valueState = value => ({ state: 'value', value });

function matchesTargetType(value, attribute) {
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    return (value === null && attribute.nullable) || type === attribute.type ||
        (attribute.type === 'integer' && Number.isSafeInteger(value));
}

function assertJson(value, depth = 1) {
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('Mapping value would lose numeric precision');
    if (value === undefined || ['bigint', 'function', 'symbol'].includes(typeof value)) throw new Error('Mapping result must be lossless JSON');
    if (value && typeof value === 'object') {
        if (depth > 128) throw new Error('Mapping exceeds the target nesting limit');
        if (!Array.isArray(value) && ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new Error('Mapping requires plain JSON objects, not runtime-native values');
        Object.values(value).forEach(child => assertJson(child, depth + 1));
    }
}

export function readFieldValue(document, segments) {
    validateFieldPath(segments);
    const visit = (value, index) => {
        if (index === segments.length) return valueState(value);
        const segment = segments[index];
        if (segment.kind === 'array') {
            if (!Array.isArray(value)) throw new Error('Array traversal requires an array value');
            return { state: 'array', items: value.map(item => visit(item, index + 1)) };
        }
        return value !== null && typeof value === 'object' && Object.hasOwn(value, segment.name)
            ? visit(value[segment.name], index + 1) : missing;
    };
    return visit(document, 0);
}

export function executeMapping(operation, inputs, constant) {
    if (!['copy', 'tuple', 'constant', 'extended-json-string', 'date-iso8601', 'json-string', 'array-envelope'].includes(operation)) throw new Error(`Unknown bounded mapping operation: ${operation}`);
    if (!Array.isArray(inputs)) throw new Error('Mapping inputs must be ordered value states');
    const checkState = state => {
        if (state?.state === 'missing' && Object.keys(state).length === 1) return;
        if (state?.state === 'array' && Array.isArray(state.items)) { state.items.forEach(checkState); return; }
        if (state?.state !== 'value' || !Object.hasOwn(state, 'value')) throw new Error('Use explicit missing or value states');
        assertJson(state.value);
    };
    inputs.forEach(checkState);
    if (operation === 'constant') {
        if (inputs.length) throw new Error('Generated constants cannot replace source values');
        assertJson(constant);
        return valueState(constant);
    }
    if (operation === 'tuple') return valueState(inputs.map(state => {
        if (state.state !== 'value') throw new Error('Tuple inputs must be present values');
        return state.value;
    }));
    if (inputs.length !== 1) throw new Error('Unary mapping requires one input');
    if (operation === 'array-envelope') {
        const envelope = state => state.state === 'missing' ? { present: false }
            : state.state === 'array' ? { items: state.items.map(envelope) }
            : { present: true, value: state.value };
        if (inputs[0].state === 'missing') return missing;
        if (inputs[0].state === 'value' && inputs[0].value === null) return valueState(null);
        if (inputs[0].state !== 'array') throw new Error('Array envelope requires a typed traversal result');
        return valueState(inputs[0].items.map(envelope));
    }
    const transform = state => {
        if (state.state === 'missing') return missing;
        if (state.state === 'array') return { state: 'array', items: state.items.map(transform) };
        const value = state.value;
        if (operation === 'copy') return valueState(value);
        if (value === null) return valueState(null);
        if (operation === 'date-iso8601') {
            if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || !Object.hasOwn(value, '$date')) throw new Error('Date conversion requires an explicit Extended JSON date');
            const date = value.$date;
            if (typeof date === 'string') {
                const parsed = new Date(date);
                if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== date) throw new Error('Date conversion requires canonical UTC milliseconds without precision loss');
                return valueState(date);
            }
            if (!date || typeof date !== 'object' || Object.keys(date).length !== 1 ||
                typeof date.$numberLong !== 'string' || !/^-?\d+$/u.test(date.$numberLong)) throw new Error('Invalid Extended JSON date milliseconds');
            const milliseconds = BigInt(date.$numberLong);
            if (milliseconds < -8640000000000000n || milliseconds > 8640000000000000n) throw new Error('Date is outside the ISO date conversion range; preserve its native representation');
            return valueState(new Date(Number(milliseconds)).toISOString());
        }
        if (operation === 'extended-json-string') {
            const keys = value && typeof value === 'object' ? Object.keys(value) : [];
            if (keys.length !== 1 || !['$oid', '$numberLong', '$numberDecimal', '$date', '$binary'].includes(keys[0])) throw new Error('Expected canonical Extended JSON native value');
            const key = keys[0];
            if (key === '$binary' || key === '$date') return valueState(JSON.stringify(value));
            const scalar = value[key];
            if (typeof scalar !== 'string' || (key === '$oid' && !/^[0-9a-f]{24}$/iu.test(scalar)) ||
                (key === '$numberLong' && !/^-?\d+$/u.test(scalar))) throw new Error('Invalid Extended JSON scalar');
            return valueState(scalar);
        }
        if (operation === 'json-string') return valueState(JSON.stringify(value));
        throw new Error(`Unknown bounded mapping operation: ${operation}`);
    };
    return transform(inputs[0]);
}

function conversionPaths(mapping, inventory) {
    if (mapping.conversions === undefined) return [];
    if (mapping.operation !== 'copy' || mapping.inputs.length !== 1 || !Array.isArray(mapping.conversions)) throw new Error('Subtree conversions require a unary copy mapping');
    const reference = mapping.inputs[0];
    const dataset = inventory.datasets.find(entry => entry.id === reference.dataset);
    const parent = dataset?.fields.find(field => field.id === reference.field);
    if (!parent || !parent.nativeTypes.some(type => ['object', 'document', 'array'].includes(type))) throw new Error('Subtree conversions require an object or array source');
    const paths = [];
    for (const conversion of mapping.conversions) {
        const field = dataset.fields.find(entry => entry.id === conversion.field);
        if (!field || field.path.length <= parent.path.length || !isFieldPathPrefix(parent.path, field.path) ||
            !['date-iso8601', 'extended-json-string'].includes(conversion.operation)) throw new Error('Subtree conversion must reference a descendant field and a bounded native-value conversion');
        const relative = field.path.slice(parent.path.length);
        if (paths.some(entry => isFieldPathPrefix(entry.path, relative) || isFieldPathPrefix(relative, entry.path))) throw new Error('Subtree conversions must not overlap');
        paths.push({ path: relative, operation: conversion.operation });
    }
    return paths;
}

function convertAtPath(value, path, operation) {
    if (!path.length) return executeMapping(operation, [valueState(value)]).value;
    if (value === null) return null;
    const [segment, ...rest] = path;
    if (segment.kind === 'array') {
        if (!Array.isArray(value)) throw new Error('Subtree conversion requires an array at the declared path');
        return value.map(item => convertAtPath(item, rest, operation));
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Subtree conversion requires an object at the declared path');
    if (!Object.hasOwn(value, segment.name)) return value;
    Object.defineProperty(value, segment.name, {
        value: convertAtPath(value[segment.name], rest, operation), enumerable: true, writable: true, configurable: true,
    });
    return value;
}

export function executeFieldMapping(mapping, inputs, inventory) {
    const conversions = conversionPaths(mapping, inventory);
    const result = executeMapping(mapping.operation, inputs, mapping.constant);
    if (!conversions.length || result.state === 'missing') return result;
    if (result.state !== 'value') throw new Error('Subtree conversion needs a complete JSON subtree, not a projected traversal');
    let value = structuredClone(result.value);
    for (const conversion of conversions) value = convertAtPath(value, conversion.path, conversion.operation);
    return valueState(value);
}

export function executeDocumentMapping(inventory, entity, mappings, decision, source, { generatedId, partitionKeys = [], defaultTtl } = {}) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Document example requires a complete source object');
    assertJson(source);
    const dataset = inventory.datasets.find(entry => entry.id === entity.sourceDataset);
    if (!dataset || dataset.kind !== 'document') throw new Error('Document mapping requires a document dataset');
    if (!DOCUMENT_MODES.has(decision.mode)) throw new Error('Document mapping mode must be preserve, reshape, or projection');
    const nativeKey = directIdentityField(entity, dataset);
    const nativeValue = nativeKey && readFieldValue(source, nativeKey.path);
    if (nativeKey && nativeValue.state !== 'value') throw new Error('Source identity is missing');
    const nativeId = nativeKey ? encodeSourceIdentity(entity, [nativeValue.value]) : undefined;
    const ttlEnabled = defaultTtl !== undefined && !entity.isEmbeddedOnly;
    const targets = new Set();
    const mappedRoots = new Set();
    if (entity.identity?.sourceKey === 'rename') mappedRoots.add(nativeKey.path[0].name);
    const resolved = mappings.map(mapping => {
        const attribute = entity.attributes.find(entry => entry.target === mapping.target);
        if (!attribute) throw new Error('Document mapping target is not declared');
        const fixedDocType = mapping.target === 'docType' && mapping.operation === 'constant' &&
            attribute.source.generated === 'constant' && mapping.constant === entity.docType;
        if (targets.has(mapping.target) || (SYSTEM_FIELDS.has(mapping.target) && !fixedDocType)) throw new Error('Document mapping has a duplicate or reserved target');
        if (ttlEnabled && mapping.target === 'ttl' && decision.itemTtl !== true) throw new Error('Mapping an item ttl override requires itemTtl: true');
        targets.add(mapping.target);
        const fields = mapping.inputs.map(reference => {
            if (reference.dataset !== dataset.id) throw new Error('Whole-document examples require explicit single-dataset inputs');
            const field = dataset.fields.find(entry => entry.id === reference.field);
            if (!field) throw new Error('Unknown document source field');
            if (field.path.length === 1 && field.path[0].kind === 'property') mappedRoots.add(field.path[0].name);
            return field;
        });
        if (decision.mode === 'preserve') {
            const field = fields[0];
            const identity = fields.length === 1 && entity.identity?.fields?.some(reference =>
                reference.dataset === dataset.id && reference.field === field.id);
            const routing = partitionKeys.some(key => key.path === `/${mapping.target}`);
            const root = field?.path.length === 1 && field.path[0].kind === 'property' ? field.path[0].name : undefined;
            const scalarJson = mapping.operation === 'json-string' && field?.nativeTypes.every(type =>
                ['string', 'integer', 'number', 'boolean', 'null'].includes(type));
            const routingConstant = !fields.length && routing && mapping.operation === 'constant' &&
                attribute.source.generated === 'constant';
            if (!routingConstant && !fixedDocType && (fields.length !== 1 || (root === undefined && !identity && !routing) ||
                (root !== mapping.target && !identity && !routing && !SYSTEM_FIELDS.has(root) &&
                    !(ttlEnabled && (root === 'ttl' || (decision.itemTtl === true && mapping.target === 'ttl')))) ||
                (!['copy', 'date-iso8601', 'extended-json-string'].includes(mapping.operation) && !scalarJson))) {
                throw new Error('Preserve mode keeps document names and nesting; projections or reshaping require a documented Cosmos DB benefit');
            }
        }
        return { mapping, fields };
    });
    const target = decision.mode === 'projection' ? {} : structuredClone(source);
    for (const root of mappedRoots) delete target[root];
    if (decision.mode === 'reshape') {
        for (const field of dataset.fields.filter(field => field.path.length === 1 && field.path[0].kind === 'property')) {
            delete target[field.path[0].name];
        }
    }
    for (const key of ttlEnabled ? [...SYSTEM_FIELDS, 'ttl'] : SYSTEM_FIELDS) {
        const collision = decision.mode === 'projection' ? Object.hasOwn(source, key) && !mappedRoots.has(key) : Object.hasOwn(target, key);
        if (collision) throw new Error(`Source property ${key} collides with target metadata; inventory and map it explicitly`);
    }
    for (const { mapping, fields } of resolved) {
        if (Object.hasOwn(target, mapping.target)) throw new Error('A mapped target would overwrite an unaccounted source property');
        const result = executeFieldMapping(mapping, fields.map(field => readFieldValue(source, field.path)), inventory);
        if (result.state === 'array') throw new Error('Document mappings must produce JSON, not traversal states');
        if (result.state === 'value') Object.defineProperty(target, mapping.target, {
            value: structuredClone(result.value), enumerable: true, writable: true, configurable: true,
        });
    }
    target.docType = entity.docType;
    if (ttlEnabled && Object.hasOwn(target, 'ttl') && !isValidTtl(target.ttl)) throw new Error('Invalid mapped item ttl override');
    if (!entity.isEmbeddedOnly) {
        if (entity.identity?.kind === 'generated-uuid') target.id = generatedId;
        if (entity.identity?.sourceKey === 'rename') target.id = nativeId;
        target.id = resolveItemId(entity, target);
        if (nativeId !== undefined && target.id !== nativeId) throw new Error('A direct identity must retain the original source key, not a transformed natural-key copy');
    }
    for (const attribute of entity.attributes) {
        if (!Object.hasOwn(target, attribute.target)) {
            if (!attribute.optional) throw new Error('Whole-document example omits a required target field');
        } else if (!matchesTargetType(target[attribute.target], attribute)) throw new Error('Whole-document example has an invalid target field type');
    }
    assertJson(target);
    for (const key of partitionKeys) {
        readPartitionKeyValue(target, key.path);
    }
    if (Buffer.byteLength(JSON.stringify(target), 'utf8') > 2 * 1024 * 1024) throw new Error('Whole-document example exceeds the target 2 MiB item limit; justify and model a supported split');
    return target;
}

function validateDocumentMappings(inventory, models, evidence) {
    const expected = new Map(models.flatMap(({ domainName, model }) => model.containers.flatMap(container =>
        container.entities.filter(entity => inventory.datasets.some(dataset => dataset.id === entity.sourceDataset && dataset.kind === 'document'))
            .map(entity => [JSON.stringify([domainName, container.name, entity.name]), { entity, container }]))));
    if (!expected.size && evidence.documentMappings === undefined) return;
    if (!Array.isArray(evidence.documentMappings)) throw new Error('Document sources require whole-document preservation evidence');
    const targetIdentities = new Map();
    for (const decision of evidence.documentMappings) {
        const key = JSON.stringify([decision.domain, decision.container, decision.entity]);
        const entry = expected.get(key);
        if (!entry || !DOCUMENT_MODES.has(decision.mode)) throw new Error('Unknown or duplicate document mapping');
        if (decision.mode === 'projection') {
            const dispositions = (evidence.sourceDispositions ?? []).flatMap(disposition => disposition.targets)
                .filter(target => target.domain === decision.domain && target.container === decision.container && target.entity === decision.entity);
            if (!dispositions.length || dispositions.some(target => target.kind !== 'projection')) {
                throw new Error('Projection mode requires an explicit projection-only target disposition');
            }
        }
        const targets = models.flatMap(({ model }) => model.containers.flatMap(container => container.entities))
            .filter(entity => entity.sourceDataset === entry.entity.sourceDataset);
        if (decision.mode === 'preserve' && (targets.length > 1 || entry.entity.isEmbeddedOnly)) {
            throw new Error('Splitting, embedding, or duplicating a document across targets requires an evidenced Cosmos DB benefit');
        }
        if (decision.mode !== 'preserve') {
            const reason = decision.justification;
            if (!['performance', 'reliability', 'cost', 'service-limit'].includes(reason?.benefit) ||
                ![reason.rationale, reason.tradeoffs].every(value => typeof value === 'string' && value.trim()) ||
                !Array.isArray(reason.evidence) || !reason.evidence.length ||
                reason.evidence.some(file => typeof file !== 'string' ||
                    (!WORKLOAD_EVIDENCE.has(file.split('#')[0]) &&
                        !inventory.files.some(input => input.path === file.split('#')[0] && input.disposition === 'used')))) {
                throw new Error('Document restructuring requires an evidenced Cosmos DB benefit and migration tradeoffs');
            }
        }
        const mappings = evidence.fieldMappings.filter(mapping =>
            JSON.stringify([mapping.domain, mapping.container, mapping.entity]) === key);
        if (!Array.isArray(decision.examples) || !decision.examples.length) throw new Error('Document mapping needs complete source-to-target examples');
        for (const example of decision.examples) {
            const result = executeDocumentMapping(inventory, entry.entity, mappings, decision, example.source, {
                generatedId: example.output?.id, partitionKeys: entry.container.partitionKeys, defaultTtl: entry.container.defaultTtl,
            });
            if (!isDeepStrictEqual(result, example.output)) throw new Error('Whole-document mapping example loses, duplicates, or changes unaccounted source content');
            if (!entry.entity.isEmbeddedOnly) {
                const itemKey = JSON.stringify([decision.container, entry.container.partitionKeys.map(key => readPartitionKeyValue(result, key.path)), result.id]);
                const previous = targetIdentities.get(itemKey);
                if (previous !== undefined && previous !== key) throw new Error('Document identities collide in the same container and partition; preserve source namespace in the identity or routing');
                targetIdentities.set(itemKey, key);
            }
        }
        expected.delete(key);
    }
    if (expected.size) throw new Error('Every document target requires an explicit preservation or justified restructuring decision');
}

export function executeBehaviorExample(example) {
    if (example.operation === 'partition-batch') {
        const keys = example.input?.partitionKeys;
        const bytes = example.input?.payloadBytes;
        if (!Array.isArray(keys) || !keys.length || Array.from(keys).some(key => !Array.isArray(key) || !key.length || key.length > 3 ||
            Array.from(key).some(component => !isPartitionKeyValue(component))) ||
            !Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Partition batch example requires complete routing tuples and payloadBytes');
        assertJson(keys);
        return { supported: keys.every(key => isDeepStrictEqual(key, keys[0])) && keys.length <= 100 && bytes <= 2 * 1024 * 1024 };
    }
    throw new Error('Unsupported behavior example; this helper does not execute application hooks');
}

function validateExpirationExamples(semantic, examples, models, evidence) {
    if (!['fixed', 'sliding'].includes(semantic.expirationBasis)) throw new Error('Preserved expiration requires a fixed or sliding source deadline');
    const targets = models.flatMap(({ domainName, model }) => model.containers.flatMap(container =>
        container.entities.filter(entity => semantic.datasets.includes(entitySource(entity)))
            .map(entity => ({ domainName, container, entity }))));
    if (!targets.length) throw new Error('Expiration evidence requires a modeled target');
    const covered = new Set();
    for (const example of examples) {
        const matchesTarget = entry => entry.domain === example.domain && entry.container === example.container && entry.entity === example.entity;
        const target = targets.find(({ domainName, container, entity }) =>
            domainName === example.domain && container.name === example.container && entity.name === example.entity);
        if (!target || target.entity.isEmbeddedOnly || !isValidTtl(target.container.defaultTtl)) throw new Error('Expiration requires a standalone target with TTL enabled');
        const documents = evidence.documentMappings?.find(matchesTarget);
        const identities = evidence.identityExamples.find(matchesTarget);
        const mapping = evidence.fieldMappings.find(entry => matchesTarget(entry) && entry.target === 'ttl');
        const { backfill, update } = example.input ?? {};
        if (example.operation !== 'ttl-relative' || !isDeepStrictEqual(example.expected, { equivalent: true }) ||
            !backfill || !update || update.lastModifiedSeconds <= backfill.lastModifiedSeconds ||
            update.lastModifiedSeconds >= backfill.sourceExpiresAtSeconds ||
            (semantic.expirationBasis === 'fixed' && update.sourceExpiresAtSeconds !== backfill.sourceExpiresAtSeconds)) {
            throw new Error('Expiration evidence requires backfill and a later update before expiry, preserving the source deadline');
        }
        const routes = [backfill, update].map(stage => {
            if (!Number.isSafeInteger(stage.exampleIndex) || stage.exampleIndex < 0 ||
                !Number.isSafeInteger(stage.lastModifiedSeconds) || !Number.isSafeInteger(stage.sourceExpiresAtSeconds)) throw new Error('Invalid expiration example index or timestamps');
            const item = documents ? documents.examples[stage.exampleIndex]?.output : identities?.cases[stage.exampleIndex]?.item;
            if (!item) throw new Error('Expiration example must reference a mapped target item');
            const override = Object.hasOwn(item, 'ttl');
            if (!documents && (mapping || override) && !mapping?.examples.some(entry =>
                isDeepStrictEqual(entry.output, override ? valueState(item.ttl) : missing))) throw new Error('Item ttl is not supported by an executable field mapping');
            const ttl = override ? item.ttl : target.container.defaultTtl;
            if (!isValidTtl(ttl) || ttl === -1 || stage.lastModifiedSeconds + ttl !== stage.sourceExpiresAtSeconds) throw new Error('Required source expiration is not preserved');
            return [item.id, ...target.container.partitionKeys.map(key => readPartitionKeyValue(item, key.path))];
        });
        if (!isDeepStrictEqual(routes[0], routes[1])) throw new Error('Expiration examples must update the same target item');
        covered.add(target);
    }
    if (covered.size !== targets.length) throw new Error('Expiration examples must cover every affected target');
}

export function validateMappingEvidence(inventory, models, evidence, owners) {
    const mappings = evidence.fieldMappings;
    if (!Array.isArray(mappings)) throw new Error('Conversion requires executable fieldMappings');
    const expected = new Map(models.flatMap(({ domainName, model }) => model.containers.flatMap(container =>
        container.entities.flatMap(entity => entity.attributes.filter(attribute => attribute.target !== 'id').map(attribute =>
            [JSON.stringify([domainName, container.name, entity.name, attribute.target]), attribute])))));
    for (const mapping of mappings) {
        const key = JSON.stringify([mapping.domain, mapping.container, mapping.entity, mapping.target]);
        const attribute = expected.get(key);
        if (!attribute) throw new Error('Unknown or duplicate field mapping');
        expected.delete(key);
        if (!isDeepStrictEqual(mapping.inputs, sourceRefs(attribute.source))) throw new Error('Executable mapping inputs differ from target lineage');
        if (!Array.isArray(mapping.examples) || !mapping.examples.length) throw new Error('Every field mapping requires executable examples');
        for (const example of mapping.examples) {
            if (example.inputs?.length !== mapping.inputs.length ||
                !isDeepStrictEqual(executeFieldMapping(mapping, example.inputs, inventory), example.output)) throw new Error('Executable field mapping example failed');
            const output = example.output;
            if (output.state === 'missing' && !attribute.optional) throw new Error('Mapping produces a missing required target field');
            if (output.state === 'value') {
                const value = output.value;
                if (!matchesTargetType(value, attribute)) throw new Error('Executable example does not produce the declared target type');
            }
            if (output.state === 'array') throw new Error('Traversal states are evidence, not JSON values; use an explicit array envelope');
        }
        for (const reference of mapping.inputs) {
            const field = inventory.datasets.find(dataset => dataset.id === reference.dataset)?.fields.find(value => value.id === reference.field);
            const inputIndex = mapping.inputs.indexOf(reference);
            if (!mapping.examples.some(example => example.inputs[inputIndex]?.state === 'array' ||
                (example.inputs[inputIndex]?.state === 'value' && (example.inputs[inputIndex].value !== null || field?.nativeTypes.includes('null'))))) throw new Error('Field mapping requires a present-value example, not only missing/null cases');
            if (field?.presence !== 'required' && !mapping.examples.some(example => example.inputs.some(input => input.state === 'missing'))) throw new Error('Optional/unknown fields need a missing example');
            if (field?.nullable !== false && !mapping.examples.some(example => example.inputs.some(input => input.state === 'value' && input.value === null))) throw new Error('Nullable/unknown fields need a null example');
            if (field?.nativeTypes.some(type => /(?:objectid|decimal128|int64|long|binary|bson)/iu.test(type)) && mapping.operation === 'copy' && attribute.type !== 'object') throw new Error('Native BSON/precision-sensitive values require explicit conversion');
            if (field?.nativeTypes.length > 1) {
                for (const nativeType of field.nativeTypes) {
                    if (!mapping.examples.some(example => example.nativeTypes?.[inputIndex] === nativeType && example.inputs[inputIndex].state === 'value')) throw new Error('Every native variant requires a typed executable example');
                }
                if (mapping.operation === 'extended-json-string') throw new Error('Mixed native variants need a type-preserving envelope to avoid collisions');
            }
        }
    }
    if (expected.size) throw new Error('Conversion omits executable field mapping examples');
    const identities = new Map(models.flatMap(({ domainName, model }) => model.containers.flatMap(container =>
        container.entities.filter(entity => !entity.isEmbeddedOnly).map(entity => [JSON.stringify([domainName, container.name, entity.name]), entity]))));
    if (!Array.isArray(evidence.identityExamples)) throw new Error('Conversion requires executable identityExamples');
    for (const example of evidence.identityExamples) {
        const key = JSON.stringify([example.domain, example.container, example.entity]);
        const entity = identities.get(key);
        if (!entity || !Array.isArray(example.cases) || !example.cases.length) throw new Error('Missing or duplicate identity example');
        for (const test of example.cases) if (resolveItemId(entity, test.item) !== test.id) throw new Error('Executable identity example failed');
        identities.delete(key);
    }
    if (identities.size) throw new Error('Every standalone entity needs an identity example');
    validateDocumentMappings(inventory, models, evidence);
    const obligations = new Map(inventory.semantics.filter(semantic => semantic.datasets.some(id => owners.has(id))).map(semantic => [semantic.id, semantic]));
    if (!Array.isArray(evidence.behaviorDecisions)) throw new Error('Conversion requires behaviorDecisions');
    for (const decision of evidence.behaviorDecisions) {
        const semantic = obligations.get(decision.semantic);
        if (!semantic || !['preserve', 'replace', 'waive'].includes(decision.action) ||
            typeof decision.rationale !== 'string' || !decision.rationale.trim() ||
            typeof decision.implementation !== 'string' || !decision.implementation.trim()) throw new Error('Invalid behavior decision');
        if (decision.action !== 'preserve' || semantic.status === 'unresolved') {
            if (typeof decision.approval?.by !== 'string' || !decision.approval.by.trim() ||
                typeof decision.approval?.at !== 'string' || !Number.isFinite(Date.parse(decision.approval.at))) throw new Error('Changed or unresolved semantics need explicit recorded approval');
        }
        if (decision.action === 'preserve' && semantic.required) {
            const operation = { atomicity: 'partition-batch', expiration: 'ttl-relative' }[semantic.kind];
            if (!operation || !Array.isArray(decision.examples) || !decision.examples.length) throw new Error('Required preservation lacks executable evidence; obtain an explicit replacement/waiver decision rather than claim parity');
            if (semantic.kind === 'expiration') {
                validateExpirationExamples(semantic, decision.examples, models, evidence);
            } else {
                for (const example of decision.examples) {
                    const actual = executeBehaviorExample(example);
                    if (example.operation !== operation || !isDeepStrictEqual(actual, example.expected) ||
                        actual.supported === false) throw new Error('Required source behavior is not preserved');
                }
            }
        }
        obligations.delete(decision.semantic);
    }
    if (obligations.size) throw new Error('Unresolved source behavior obligations require explicit decisions');
}
