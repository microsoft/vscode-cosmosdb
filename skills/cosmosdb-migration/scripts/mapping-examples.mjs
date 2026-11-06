// Purpose: Execute bounded JSON mapping examples, not user code or source-engine operations.

import { isDeepStrictEqual } from 'node:util';
import { resolveItemId } from './identity-mapping.mjs';
import { sourceRefs, validateFieldPath } from './source-contract.mjs';

const missing = Object.freeze({ state: 'missing' });
const valueState = value => ({ state: 'value', value });

function assertJson(value) {
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('Mapping value would lose numeric precision');
    if (value === undefined || typeof value === 'bigint' || typeof value === 'function') throw new Error('Mapping result must be lossless JSON');
    if (value && typeof value === 'object') Object.values(value).forEach(assertJson);
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
    if (!['copy', 'tuple', 'constant', 'extended-json-string', 'json-string', 'array-envelope'].includes(operation)) throw new Error(`Unknown bounded mapping operation: ${operation}`);
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

export function executeBehaviorExample(example) {
    if (example.operation === 'partition-batch') {
        const keys = example.input?.partitionKeys;
        const bytes = example.input?.payloadBytes;
        if (!Array.isArray(keys) || !keys.length || keys.some(key => !Array.isArray(key) || !key.length || key.length > 3 ||
            key.some(component => !['string', 'number', 'boolean'].includes(typeof component))) ||
            !Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Partition batch example requires complete routing tuples and payloadBytes');
        assertJson(keys);
        return { supported: keys.every(key => isDeepStrictEqual(key, keys[0])) && keys.length <= 100 && bytes <= 2 * 1024 * 1024 };
    }
    if (example.operation === 'ttl-relative') {
        const { lastModifiedSeconds, ttl, sourceExpiresAtSeconds } = example.input ?? {};
        if (![lastModifiedSeconds, ttl, sourceExpiresAtSeconds].every(Number.isFinite) || ttl <= 0) throw new Error('TTL example requires positive TTL and numeric timestamps');
        const expiresAtSeconds = lastModifiedSeconds + ttl;
        return { expiresAtSeconds, equivalent: expiresAtSeconds === sourceExpiresAtSeconds };
    }
    throw new Error('Unsupported behavior example; this helper does not execute application hooks');
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
                !isDeepStrictEqual(executeMapping(mapping.operation, example.inputs, mapping.constant), example.output)) throw new Error('Executable field mapping example failed');
            const output = example.output;
            if (output.state === 'missing' && !attribute.optional) throw new Error('Mapping produces a missing required target field');
            if (output.state === 'value') {
                const value = output.value;
                const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
                if (!(value === null && attribute.nullable) && type !== attribute.type &&
                    !(attribute.type === 'integer' && Number.isSafeInteger(value))) throw new Error('Executable example does not produce the declared target type');
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
            for (const example of decision.examples) {
                const actual = executeBehaviorExample(example);
                if (example.operation !== operation || !isDeepStrictEqual(actual, example.expected) ||
                    actual.supported === false || actual.equivalent === false) throw new Error('Required source behavior is not preserved');
            }
        }
        obligations.delete(decision.semantic);
    }
    if (obligations.size) throw new Error('Unresolved source behavior obligations require explicit decisions');
}
